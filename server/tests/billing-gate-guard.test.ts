// G4b-7 + G4c-5: REAL tests for the billing gate, resume route, removeMember/leaveTeam payer protection.
// Run from the repo root:  npm test --workspace @rowta/server -- billing-gate-guard
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { afterAll, beforeAll } from 'vitest';
import type { Hono } from 'hono';
import type { Job } from 'bullmq';
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
import { globalDb, forTeam } from '../src/db/clients.ts';
import { signAccessToken } from '../src/security/access-token.ts';
import { requireBillingNotRestricted } from '../src/billing/restricted-guard.ts';
import { accountWriteState } from '../src/billing/entitlements.ts';
import { processAccountTrialEnd } from '../src/billing/account-renewal-processor.ts';

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

async function seedAccount(
  userId: string,
  status: string = 'active',
  cancelAtPeriodEnd = false,
  periodEnd: Date | null = null,
  trialEndsAt: Date | null = null,
): Promise<void> {
  await globalDb().owner_accounts.upsert({
    where: { user_id: userId },
    create: {
      user_id: userId,
      plan: 'monthly',
      status,
      cancel_at_period_end: cancelAtPeriodEnd,
      period_end: periodEnd ?? null,
      trial_ends_at: trialEndsAt ?? null,
      trial_used: status === 'trialing',
      period_start: new Date(),
      currency: 'NGN',
    },
    update: {},
  });
}

async function seedRegistry(teamId: string, ownerUserId: string): Promise<void> {
  await globalDb().owner_team_registry.upsert({
    where: { team_id: teamId },
    create: { team_id: teamId, owner_user_id: ownerUserId, status: 'active', is_extra: false },
    update: {},
  });
}

async function addMemberDirect(teamId: string, userId: string, role: 'manager' | 'staff' | 'owner'): Promise<void> {
  await forTeam(teamId).memberships.create({ data: { team_id: teamId, user_id: userId, role } });
}

describe('billing gate guard (G4b)', () => {
  let ownerId: string;
  let ownerAuth: Record<string, string>;
  let teamId: string;

  beforeAll(async () => {
    await clearRateKeys();
    await ensureTestCountries();
    app = testApp('billing-gate-guard');

    ownerId = await createVerifiedUser(uniqueEmail('gg-owner'), 'OwnerPass123#');
    ownerAuth = { authorization: `Bearer ${await signAccessToken(ownerId)}` };

    teamId = await createTeamFor(ownerAuth, 'Gate Guard Team');

    await seedAccount(ownerId);
    await seedRegistry(teamId, ownerId);
  });

  afterAll(async () => {
    await shutdownAuthTest();
  });

  describe('accountWriteState helper', () => {
    it('returns blocked for cancelled account', () => {
      const s = accountWriteState({ status: 'cancelled', cancel_at_period_end: null, period_end: null, trialEndsAt: null });
      expect(s.blocked).toBe(true);
      expect(s.reason).toBe('plan_ended');
    });

    it('returns blocked when period ended with cancel_at_period_end', () => {
      const s = accountWriteState({
        status: 'active',
        cancel_at_period_end: true,
        period_end: new Date(Date.now() - 60_000), // 1 minute ago
        trialEndsAt: null,
      });
      expect(s.blocked).toBe(true);
      expect(s.reason).toBe('plan_ended');
    });

    it('returns blocked when trialing and trial ended', () => {
      const s = accountWriteState({
        status: 'trialing',
        cancel_at_period_end: false,
        period_end: null,
        trialEndsAt: new Date(Date.now() - 60_000), // 1 minute ago
      });
      expect(s.blocked).toBe(true);
      expect(s.reason).toBe('plan_ended');
    });

    it('returns blocked when account status is read_only (trial-end job)', () => {
      const s = accountWriteState({ status: 'read_only', cancel_at_period_end: false, period_end: null, trialEndsAt: null });
      expect(s.blocked).toBe(true);
      expect(s.reason).toBe('plan_ended');
    });

    it('returns not blocked for active account', () => {
      const s = accountWriteState({ status: 'active', cancel_at_period_end: false, period_end: null, trialEndsAt: null });
      expect(s.blocked).toBe(false);
      expect(s.reason).toBeUndefined();
    });

    it('returns not blocked when cancel_at_period_end but period not ended', () => {
      const s = accountWriteState({
        status: 'active',
        cancel_at_period_end: true,
        period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days future
        trialEndsAt: null,
      });
      expect(s.blocked).toBe(false);
      expect(s.reason).toBeUndefined();
    });
  });

  describe('requireBillingNotRestricted gate', () => {
    it('passes for an active account', async () => {
      await expect(requireBillingNotRestricted(teamId)).resolves.toBeUndefined();
    });

    it('throws 403 billing.account_inactive when account is cancelled', async () => {
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: { status: 'cancelled' },
      });
      await expect(requireBillingNotRestricted(teamId)).rejects.toMatchObject({
        status: 403,
        code: 'billing.account_inactive',
      });
      // Restore.
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: { status: 'active' },
      });
    });

    it('throws 403 billing.account_inactive when period ended with cancel_at_period_end', async () => {
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: {
          status: 'active',
          cancel_at_period_end: true,
          period_end: new Date(Date.now() - 60_000), // 1 minute ago
        },
      });
      await expect(requireBillingNotRestricted(teamId)).rejects.toMatchObject({
        status: 403,
        code: 'billing.account_inactive',
      });
      // Restore.
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: { status: 'active', cancel_at_period_end: false, period_end: null },
      });
    });

    it('throws 403 billing.account_inactive when trialing and trial ended', async () => {
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: {
          status: 'trialing',
          trial_ends_at: new Date(Date.now() - 60_000), // 1 minute ago
        },
      });
      await expect(requireBillingNotRestricted(teamId)).rejects.toMatchObject({
        status: 403,
        code: 'billing.account_inactive',
      });
      // Restore.
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: { status: 'active', trial_ends_at: null },
      });
    });

    it('keeps reads and leave allowed while the account is read-only', async () => {
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: { status: 'cancelled' },
      });
      try {
        // Reads stay allowed.
        const readRes = await app.request(`/teams/${teamId}`, { headers: ownerAuth });
        expect(readRes.status).toBe(200);

        // A non-payer member can still leave.
        const memberId = await createVerifiedUser(uniqueEmail('gg-leaver'), 'LeaverPass123#');
        await addMemberDirect(teamId, memberId, 'staff');
        const memberAuth = { authorization: `Bearer ${await signAccessToken(memberId)}` };
        const leaveRes = await postJson(`/teams/${teamId}/leave`, {}, memberAuth);
        expect(leaveRes.status).toBe(200);
      } finally {
        await globalDb().owner_accounts.update({
          where: { user_id: ownerId },
          data: { status: 'active' },
        });
      }
    });

    it('REGRESSION: a write stays 403 after processAccountTrialEnd sets status read_only', async () => {
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: {
          status: 'trialing',
          trial_ends_at: new Date(Date.now() - 60_000), // trial ended 1 minute ago
        },
      });
      await processAccountTrialEnd({ data: { ownerUserId: ownerId } } as unknown as Job<{ ownerUserId: string }>);

      const account = await globalDb().owner_accounts.findUnique({ where: { user_id: ownerId } });
      expect(account!.status).toBe('read_only');

      await expect(requireBillingNotRestricted(teamId)).rejects.toMatchObject({
        status: 403,
        code: 'billing.account_inactive',
      });
      const res = await postJson(
        `/teams/${teamId}/settings`,
        { managers_can_revoke_invites: false },
        ownerAuth,
      );
      expect(res.status).toBe(403);
      const err = await errorOf(res);
      expect(err.code).toBe('billing.account_inactive');

      // Restore for the resume tests.
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: { status: 'active', trial_ends_at: null },
      });
      await forTeam(teamId).teams.update({
        where: { id: teamId },
        data: { coverage_status: 'covered' },
      });
    });

    it('leaves a team with NO owner_accounts row unaffected', async () => {
      const noAccountOwnerId = await createVerifiedUser(uniqueEmail('gg-noaccount'), 'NoAccountPass123#');
      const noAccountTeamId = randomUUID();
      await forTeam(noAccountTeamId).teams.create({
        data: {
          id: noAccountTeamId,
          name: 'No Account Team',
          managers_can_revoke_invites: true,
          created_by: noAccountOwnerId,
          coverage_status: 'covered',
        },
      });
      await seedRegistry(noAccountTeamId, noAccountOwnerId);

      await expect(requireBillingNotRestricted(noAccountTeamId)).resolves.toBeUndefined();
    });
  });

  describe('POST /billing/account/resume', () => {
    it('resumes a cancelled-at-period-end account', async () => {
      // First cancel at period end.
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: {
          cancel_at_period_end: true,
          period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days future
        },
      });

      const idemKey = uniqueEmail('billing');
      const res = await postJson('/billing/account/resume', {}, { ...ownerAuth, 'idempotency-key': idemKey });
      expect(res.status).toBe(200);
      const body = await dataOf(res);
      expect(body.resumed).toBe(true);

      // Verify cancel_at_period_end cleared.
      const account = await globalDb().owner_accounts.findUnique({ where: { user_id: ownerId } });
      expect(account!.cancel_at_period_end).toBe(false);
    });

    it('is idempotent: replay with same Idempotency-Key returns resumed=true', async () => {
      // Ensure account is cancelled at period end first.
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: {
          cancel_at_period_end: true,
          period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      const idemKey = uniqueEmail('billing');
      await postJson('/billing/account/resume', {}, { ...ownerAuth, 'idempotency-key': idemKey });
      const res = await postJson('/billing/account/resume', {}, { ...ownerAuth, 'idempotency-key': idemKey });
      expect(res.status).toBe(200);
      const body = await dataOf(res);
      expect(body.resumed).toBe(true);
    });

    it('requires Idempotency-Key (400 without it)', async () => {
      const res = await app.request('/billing/account/resume', {
        method: 'POST',
        headers: { ...ownerAuth, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const err = await errorOf(res);
      expect(err.code).toBe('idempotency.missing');
    });

    it('returns 409 billing.cannot_resume after the period has ended', async () => {
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: {
          status: 'active',
          cancel_at_period_end: true,
          period_end: new Date(Date.now() - 60_000), // ended 1 minute ago
        },
      });
      const res = await postJson('/billing/account/resume', {}, ownerAuth);
      expect(res.status).toBe(409);
      const err = await errorOf(res);
      expect(err.code).toBe('billing.cannot_resume');

      // Restore.
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: { cancel_at_period_end: false, period_end: null },
      });
    });
  });

  describe('removeMember payer protection (G4-3)', () => {
    it('payer cannot be removed by another member', async () => {
      // The payer must be a non-owner membership (an owner target hits the
      // auth.deleteOwner.blocked check first). Seed a team whose registry payer is a manager.
      const payerManagerId = await createVerifiedUser(uniqueEmail('gg-payer-mgr'), 'PayerManager123#');
      const payerTeamId = randomUUID();
      await forTeam(payerTeamId).teams.create({
        data: {
          id: payerTeamId,
          name: 'Payer Protection Team',
          managers_can_revoke_invites: true,
          created_by: ownerId,
          coverage_status: 'covered',
        },
      });
      await addMemberDirect(payerTeamId, ownerId, 'owner');
      await addMemberDirect(payerTeamId, payerManagerId, 'manager');
      await seedRegistry(payerTeamId, payerManagerId);

      const res = await postJson(
        `/teams/${payerTeamId}/members/${payerManagerId}/remove`,
        {},
        ownerAuth,
      );
      expect(res.status).toBe(403);
      const err = await errorOf(res);
      expect(err.code).toBe('billing.payer_cannot_leave');
    });
  });

  describe('leaveTeam payer protection (G4-3)', () => {
    it('payer cannot leave their own team', async () => {
      const res = await postJson(`/teams/${teamId}/leave`, {}, ownerAuth);
      expect(res.status).toBe(403);
      const err = await errorOf(res);
      expect(err.code).toBe('billing.payer_cannot_leave_self');
    });
  });
});
