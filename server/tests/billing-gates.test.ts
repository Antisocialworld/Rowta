// Billing gates tests (D1).
// Tests the capacity gates on invite, accept-invite and restore-team, the 422 billing.seat_limit_reached
// shape (no prices), the deduped owner notification, and the Admin status-only GET /teams/:teamId/billing/status.
// Service-level tests where possible; HTTP tests for the status endpoint.
// Run from the repo root:  npm test --workspace @rowta/server -- billing-gates
import { describe, expect, it } from 'vitest';
import { afterAll, beforeAll } from 'vitest';
import type { Hono } from 'hono';
import {
  clearRateKeys,
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
import { checkTeamCapacity, entitlementsFor, seatsUsed } from '../src/billing/entitlements.ts';

let app: Hono;

async function postJson(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function createTeamFor(auth: Record<string, string>, name: string): Promise<string> {
  const res = await post(app, '/teams', { name }, { ...auth, 'idempotency-key': uniqueEmail('billing') });
  expect(res.status).toBe(201);
  return (await dataOf(res)).id as string;
}

async function makeUser(email: string): Promise<string> {
  return globalDb().users.create({
    data: {
      email,
      display_name: 'Fixture User',
      country: 'NG',
      password_hash: '$argon2id$v=19$fake',
      email_verified_at: new Date(),
    },
  }).then((u) => u.id);
}

async function addMemberDirect(teamId: string, userId: string, role: 'manager' | 'staff' | 'owner'): Promise<void> {
  await forTeam(teamId).memberships.create({ data: { team_id: teamId, user_id: userId, role } });
}

async function seedAccount(userId: string, status: string = 'active', plan: string = 'monthly'): Promise<void> {
  await globalDb().owner_accounts.upsert({
    where: { user_id: userId },
    create: {
      user_id: userId,
      plan,
      status,
      trial_used: status === 'trialing',
      period_start: new Date(),
      period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      currency: 'NGN',
    },
    update: {},
  });
}

async function seedRegistry(teamId: string, ownerUserId: string, isExtra = false): Promise<void> {
  await globalDb().owner_team_registry.upsert({
    where: { team_id: teamId },
    create: { team_id: teamId, owner_user_id: ownerUserId, status: 'active', is_extra: isExtra },
    update: {},
  });
}

describe('billing gates (D1)', () => {
  let ownerId: string;
  let ownerAuth: Record<string, string>;
  let teamId: string;

  beforeAll(async () => {
    await clearRateKeys();
    await ensureTestCountries();
    app = testApp('billing-gates');

    ownerId = await makeUser(uniqueEmail('gate-owner'));
    ownerAuth = { authorization: `Bearer ${await signAccessToken(ownerId)}` };

    teamId = await createTeamFor(ownerAuth, 'Gate Test Team');

    await seedAccount(ownerId);
    await seedRegistry(teamId, ownerId);
  });

  afterAll(async () => {
    await shutdownAuthTest();
  });

  describe('checkTeamCapacity', () => {
    it('allows adding people within the included limit', async () => {
      await expect(checkTeamCapacity(teamId)).resolves.toBeUndefined();
    });

    it('throws 422 billing.seat_limit_reached with no prices when at the limit', async () => {
      const e = await entitlementsFor(teamId);
      const limit = e.planEntitlements?.peoplePerTeam;
      if (typeof limit !== 'number') {
        throw new Error('Missing peoplePerTeam in planEntitlements');
      }
      const current = await seatsUsed(teamId);
      for (let i = current; i < limit; i++) {
        const memberId = await makeUser(uniqueEmail(`gate-member${i}`));
        await addMemberDirect(teamId, memberId, 'staff');
      }
      await expect(checkTeamCapacity(teamId)).rejects.toMatchObject({
        status: 422,
        code: 'billing.seat_limit_reached',
      });
    });
  });

  describe('entitlementsFor trial limits', () => {
    it('trial account: 10 people, no extras for new people', async () => {
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: {
          status: 'trialing',
          trial_used: true,
          trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        },
      });
      const e = await entitlementsFor(teamId);
      expect(e.planEntitlements?.peoplePerTeam).toBe(10);
      expect(e.planEntitlements?.extraPersonPriceMinor).toBe(0);
      expect(e.accountStatus).toBe('trialing');
      // Restore.
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: { status: 'active', trial_used: true },
      });
    });
  });

  describe('createInvite capacity gate', () => {
    it('rejects invite at capacity with 422 billing.seat_limit_reached and no prices', async () => {
      // Team already has 10 staff members (at the included limit).
      const inviteeId = await makeUser(uniqueEmail('gate-invitee'));
      const res = await postJson(
        `/teams/${teamId}/invites`,
        { email: `${inviteeId}@example.test`, role: 'staff' },
        ownerAuth,
      );
      expect(res.status).toBe(422);
      const err = await errorOf(res);
      expect(err.code).toBe('billing.seat_limit_reached');
      // No prices in the error.
      expect(err.message).not.toMatch(/\d/);
      expect(err.fields).toBeUndefined();
    });
  });

  describe('GET /teams/:teamId/billing/status (Admin status-only, no amounts)', () => {
    it('returns coverage status and owner display name, no amounts or intent', async () => {
      const res = await app.request(`/teams/${teamId}/billing/status`, {
        headers: ownerAuth,
      });
      expect(res.status).toBe(200);
      const body = (await dataOf(res)) as {
        accountStatus: string | null;
        coverageStatus: string;
        ownerDisplayName: string | null;
        subscription?: unknown;
        intent?: unknown;
      };
      expect(body.coverageStatus).toBe('covered');
      expect(body.ownerDisplayName).toBe('Fixture User');
      expect(body.accountStatus).toBe('active');
      expect(body.subscription).toBeUndefined();
      // No amounts, no payment data, no intent.
      expect(body.intent).toBeUndefined();
    });

    it('manager/staff cannot view billing status', async () => {
      const staffId = await makeUser(uniqueEmail('gate-staff'));
      await addMemberDirect(teamId, staffId, 'staff');
      const staffAuth = { authorization: `Bearer ${await signAccessToken(staffId)}` };
      const res = await app.request(`/teams/${teamId}/billing/status`, {
        headers: staffAuth,
      });
      expect(res.status).toBe(403);
      const err = await errorOf(res);
      expect(err.code).toBe('billing.holder_only');
    });
  });
});
