// Billing renewal tests (Task 7).
// Tests for renewal, grace, restricted state, and the restricted guard.
// Imports from server/src/billing/* only (plus test helpers).
// Run from the repo root:  npm test --workspace @rowta/server -- billing-renewal
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { requireBillingNotRestricted } from '../src/billing/restricted-guard.ts';
import { periodPrice, type PlanId } from '../src/billing/proration.ts';
import { processWebhookJob } from '../src/jobs/webhook-processor.ts';
import type { Job } from 'bullmq';
import type { WebhookJobData } from '../src/jobs/webhook-processor.ts';
import { randomUUID } from 'node:crypto';
import {
  clearRateKeys,
  createVerifiedUser,
  dataOf,
  errorOf,
  ensureTestCountries,
  post,
  shutdownAuthTest,
  testApp,
  uniqueEmail,
} from './helpers/auth-test.ts';
import { forTeam, globalDb } from '../src/db/clients.ts';
import { signAccessToken } from '../src/security/access-token.ts';

let app: Hono;

async function postJson(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': uniqueEmail('billing'), ...headers },
    body: JSON.stringify(body),
  });
}

async function createTeamFor(auth: Record<string, string>, name: string): Promise<string> {
  const res = await post(app, '/teams', { name }, { ...auth, 'idempotency-key': uniqueEmail('billing') });
  expect(res.status).toBe(201);
  return (await dataOf(res)).id as string;
}

const PLAN_LIMITS: Record<PlanId, { includedSeats: number; maxSeats: number }> = {
  starter: { includedSeats: 5, maxSeats: 5 },
  team: { includedSeats: 15, maxSeats: 200 },
  business: { includedSeats: 40, maxSeats: 200 },
};

const USD_PRICES: Record<PlanId, { baseMinor: number; extraSeatMinor: number | null }> = {
  starter: { baseMinor: 2000, extraSeatMinor: null },
  team: { baseMinor: 5000, extraSeatMinor: 300 },
  business: { baseMinor: 12000, extraSeatMinor: 200 },
};

/**
 * Put a team into the restricted (pending_payment) state.
 * entitlementsFor reads the SHARD cache (teams.coverage_status), so the shard row is the
 * authoritative fixture; the registry row is updated too so the account-level view agrees.
 * A legacy per-team subscription is created on the same shard for realism.
 */
async function makePendingPaymentTeam(teamId: string, ownerId: string): Promise<void> {
  await globalDb().owner_team_registry.update({
    where: { team_id: teamId },
    data: { status: 'pending_payment', is_extra: true },
  });
  await forTeam(teamId).teams.update({
    where: { id: teamId },
    data: { coverage_status: 'pending_payment', is_extra: true, coverage_updated_at: new Date() },
  });
  await forTeam(teamId).subscriptions.create({
    data: {
      id: randomUUID(),
      team_id: teamId,
      plan: 'team',
      seats: 0,
      status: 'active',
      currency: 'NGN',
      period_start: new Date(),
      period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      billing_user_id: ownerId,
      interval: 'month',
    },
  });
}

describe('billing renewal (Task 7)', () => {
  let ownerId: string;
  let ownerAuth: Record<string, string>;
  let teamId: string;

  beforeAll(async () => {
    await clearRateKeys();
    await ensureTestCountries();
    app = testApp('billing-renewal');

    ownerId = await createVerifiedUser(uniqueEmail('renewal-owner'), 'RenewalPass123#');
    ownerAuth = { authorization: `Bearer ${await signAccessToken(ownerId)}` };
    teamId = await createTeamFor(ownerAuth, 'Renewal Team');

    await globalDb().plan_entitlements.upsert({
      where: { interval: 'monthly' },
      create: {
        interval: 'monthly',
        base_price_minor: BigInt(650000),
        free_teams: 2,
        extra_team_price_minor: BigInt(200000),
        people_per_team: 10,
        extra_person_price_minor: BigInt(20000),
        max_teams: 20,
        max_people_per_team: 50,
        trial_days: 14,
        trial_teams: 1,
        trial_people: 10,
        min_addon_charge_minor: BigInt(50000),
      },
      update: {},
    });

    await globalDb().owner_accounts.upsert({
      where: { user_id: ownerId },
      create: {
        user_id: ownerId,
        plan: 'monthly',
        status: 'active',
        trial_used: true,
        currency: 'NGN',
      },
      update: {},
    });

    await globalDb().owner_team_registry.upsert({
      where: { team_id: teamId },
      create: { team_id: teamId, owner_user_id: ownerId, status: 'active', is_extra: false },
      update: {},
    });
  });

  afterAll(async () => {
    await shutdownAuthTest();
  });

  describe('restricted guard (Task 7)', () => {
    it('is a function that can be imported', () => {
      expect(typeof requireBillingNotRestricted).toBe('function');
    });
  });

  describe('renewal price computation (Task 7)', () => {
    it('monthly renewal: Team(15) = 5000', () => {
      expect(periodPrice('team', 15, USD_PRICES.team, PLAN_LIMITS.team, 'month')).toBe(5000);
    });
    it('monthly renewal: Team(18) = 5000 + 300*3 = 5900', () => {
      expect(periodPrice('team', 18, USD_PRICES.team, PLAN_LIMITS.team, 'month')).toBe(5900);
    });
    it('yearly renewal: Team(15) = 5000 * 12 = 60000', () => {
      expect(periodPrice('team', 15, USD_PRICES.team, PLAN_LIMITS.team, 'year')).toBe(60000);
    });
    it('Starter(6) rejected at renewal', () => {
      expect(periodPrice('starter', 6, USD_PRICES.starter, PLAN_LIMITS.starter, 'month')).toBe(null);
    });
    it('Team(201) rejected at renewal (ceiling 200)', () => {
      expect(periodPrice('team', 201, USD_PRICES.team, PLAN_LIMITS.team, 'month')).toBe(null);
    });
  });

  describe('webhook: expired intent', () => {
    it('successful payment for expired intent changes nothing and marks event ignored', async () => {
      const txRef = `expired-${uniqueEmail('webhook')}`;
      await globalDb().payment_intents.create({
        data: {
          id: randomUUID(),
          team_id: teamId,
          tx_ref: txRef,
          purpose: 'renewal',
          amount_minor: BigInt(650000),
          currency: 'NGN',
          status: 'expired',
          // intents_done_has_time: non-pending intents must record when they ended.
          completed_at: new Date(),
          idempotency_key: `expired-${uniqueEmail('idem')}`,
          created_by: ownerId,
          plan: 'monthly',
          seats: 1,
          interval: 'month',
          kind: 'renewal',
        },
      });
      await globalDb().webhook_events.create({
        data: {
          provider: 'flutterwave',
          provider_event_id: `expired-${uniqueEmail('evt')}`,
          event_type: 'charge.completed',
          tx_ref: txRef,
          status: 'received',
        },
      });

      const job = { data: { txRef, eventType: 'charge.completed' } } as Job<WebhookJobData>;
      await processWebhookJob(job);

      const intent = await globalDb().payment_intents.findUnique({ where: { tx_ref: txRef } });
      expect(intent?.status).toBe('expired');

      const events = await globalDb().webhook_events.findMany({ where: { tx_ref: txRef } });
      expect(events[0]?.status).toBe('ignored');
    });
  });

  describe('restricted gate: pending_payment team', () => {
    it('write on pending_payment team returns 403 billing.team_restricted', async () => {
      const pendingTeamId = await createTeamFor(ownerAuth, 'Pending Team');
      await makePendingPaymentTeam(pendingTeamId, ownerId);

      const res = await postJson(
        `/teams/${pendingTeamId}/shifts`,
        { label: 'Test Shift', starts_at: '2026-12-01 09:00', ends_at: '2026-12-01 10:00' },
        ownerAuth,
      );
      expect(res.status).toBe(403);
      const err = await errorOf(res);
      expect(err.code).toBe('billing.team_restricted');
    });

    it('read on pending_payment team still works', async () => {
      const pendingTeamId = await createTeamFor(ownerAuth, 'Pending Read Team');
      await makePendingPaymentTeam(pendingTeamId, ownerId);

      const res = await app.request(
        `/teams/${pendingTeamId}/shifts?from=2026-12-01T00:00:00.000Z&to=2026-12-02T00:00:00.000Z`,
        { headers: ownerAuth },
      );
      expect(res.status).toBe(200);
    });
  });
});
