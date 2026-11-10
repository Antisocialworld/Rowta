// Account deletion and restoration tests (Task D2; rules S1, S5, S6, S7, S14, A5, A6, A7, A11, D2).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { AUTH_MESSAGES } from '@rowta/shared';
import { globalDb, writeDb } from '../src/db/clients.ts';
import { shardFor } from '../src/db/shard.ts';
import { signAccessToken } from '../src/security/access-token.ts';
import { hashSecret } from '../src/security/argon2.ts';
import { createTokenParts, formatToken } from '../src/security/tokens.ts';
import { __setRefusalRedisForTests, markUserRefused } from '../src/auth/deletion-cache.ts';
import {
  clearRateKeys,
  createVerifiedUser,
  dataOf,
  ensureTestCountries,
  errorOf,
  post,
  shutdownAuthTest,
  testApp,
  uniqueEmail,
} from './helpers/auth-test.ts';

let app: Hono;

beforeAll(async () => {
  await clearRateKeys();
  await ensureTestCountries();
  app = testApp('account-deletion');
});

afterAll(async () => {
  await shutdownAuthTest();
});

beforeEach(async () => {
  await clearRateKeys();
});

describe('Account deletion: request (POST /account/delete)', () => {
  it('happy path: cancels subscription, sets pending_deletion, revokes sessions, deletes devices', async () => {
    const email = uniqueEmail('delete-happy');
    const password = 'Delete-Happy-Password-1';
    const userId = await createVerifiedUser(email, password);
    const token = await signAccessToken(userId);
    const authHeader = { authorization: `Bearer ${token}` };

    const db0 = globalDb();

    // 1. Create a push device row
    await db0.devices.create({
      data: {
        user_id: userId,
        device_id: 'test-device-delete-1',
        platform: 'android',
        push_token: 'ExponentPushToken[delete-1]',
      },
    });

    // 2. Create an owner account subscription
    await db0.owner_accounts.create({
      data: {
        user_id: userId,
        plan: 'monthly',
        status: 'active',
        currency: 'NGN',
        provider_authorization_ref: 'AUTH_SECRET_REF_123',
      },
    });

    // 3. Create a refresh token session
    const parts = createTokenParts();
    await db0.refresh_tokens.create({
      data: {
        selector: parts.selector,
        verifier_hash: await hashSecret(parts.verifier),
        family_id: randomUUID(),
        user_id: userId,
        expires_at: new Date(Date.now() + 30 * 86400 * 1000),
      },
    });

    // 4. Request account deletion
    const res = await post(app, '/account/delete', { password }, authHeader);
    expect(res.status).toBe(200);
    const data = await dataOf(res);
    expect(data.deleted).toBe(true);

    // Verify DB states:
    const user = await db0.users.findUnique({ where: { id: userId } });
    expect(user?.status).toBe('pending_deletion');
    expect(user?.deletion_requested_at).not.toBeNull();

    // Devices deleted
    const devices = await db0.devices.findMany({ where: { user_id: userId } });
    expect(devices).toHaveLength(0);

    // Owner account cancelled and authorization ref cleared
    const ownerAccount = await db0.owner_accounts.findUnique({ where: { user_id: userId } });
    expect(ownerAccount?.status).toBe('cancelled');
    expect(ownerAccount?.cancel_at_period_end).toBe(true);
    expect(ownerAccount?.provider_authorization_ref).toBeNull();

    // Refresh tokens revoked
    const refreshTokens = await db0.refresh_tokens.findMany({ where: { user_id: userId } });
    expect(refreshTokens.length).toBeGreaterThan(0);
    for (const rt of refreshTokens) {
      expect(rt.revoked_at).not.toBeNull();
    }
  });

  it('wrong password returns 401 generic failure and does not change user status', async () => {
    const email = uniqueEmail('delete-wrong-pw');
    const password = 'Correct-Password-1';
    const userId = await createVerifiedUser(email, password);
    const token = await signAccessToken(userId);
    const authHeader = { authorization: `Bearer ${token}` };

    const res = await post(app, '/account/delete', { password: 'Wrong-Password-1' }, authHeader);
    expect(res.status).toBe(401);
    const error = await errorOf(res);
    expect(error.code).toBe('auth.failed');
    expect(error.message).toBe(AUTH_MESSAGES['auth.signIn.failed']);

    const user = await globalDb().users.findUnique({ where: { id: userId } });
    expect(user?.status).toBe('active');
    expect(user?.deletion_requested_at).toBeNull();
  });

  it('block rule: Admin of active team with other members is refused with 409 auth.deleteOwner.blocked', async () => {
    const adminEmail = uniqueEmail('admin-blocked');
    const adminPassword = 'Admin-Password-1';
    const adminId = await createVerifiedUser(adminEmail, adminPassword);
    const adminToken = await signAccessToken(adminId);
    const adminHeader = { authorization: `Bearer ${adminToken}` };

    const memberEmail = uniqueEmail('member-other');
    const memberId = await createVerifiedUser(memberEmail, 'Member-Password-1');

    // Create an active team on shard
    const teamId = randomUUID();
    const shard = shardFor(teamId);
    const client = writeDb(shard);

    await client.teams.create({
      data: { id: teamId, name: 'Blocked Admin Team' },
    });
    await client.memberships.create({
      data: { team_id: teamId, user_id: adminId, role: 'owner' },
    });
    await client.memberships.create({
      data: { team_id: teamId, user_id: memberId, role: 'staff' },
    });

    const db0 = globalDb();
    await db0.user_team_index.create({ data: { user_id: adminId, team_id: teamId } });
    await db0.user_team_index.create({ data: { user_id: memberId, team_id: teamId } });

    // Request deletion
    const res = await post(app, '/account/delete', { password: adminPassword }, adminHeader);
    expect(res.status).toBe(409);
    const error = await errorOf(res);
    expect(error.code).toBe('auth.deleteOwner.blocked');
    expect(error.message).toBe(AUTH_MESSAGES['auth.deleteOwner.blocked']);

    // Admin user status unchanged
    const adminUser = await db0.users.findUnique({ where: { id: adminId } });
    expect(adminUser?.status).toBe('active');
  });

  it('sole-member Admin is allowed to delete account', async () => {
    const soleEmail = uniqueEmail('admin-sole');
    const solePassword = 'Sole-Password-1';
    const soleId = await createVerifiedUser(soleEmail, solePassword);
    const soleToken = await signAccessToken(soleId);
    const soleHeader = { authorization: `Bearer ${soleToken}` };

    // Create team with sole owner
    const teamId = randomUUID();
    const shard = shardFor(teamId);
    const client = writeDb(shard);

    await client.teams.create({
      data: { id: teamId, name: 'Sole Member Team' },
    });
    await client.memberships.create({
      data: { team_id: teamId, user_id: soleId, role: 'owner' },
    });

    const db0 = globalDb();
    await db0.user_team_index.create({ data: { user_id: soleId, team_id: teamId } });

    // Request deletion
    const res = await post(app, '/account/delete', { password: solePassword }, soleHeader);
    expect(res.status).toBe(200);
    const data = await dataOf(res);
    expect(data.deleted).toBe(true);

    const user = await db0.users.findUnique({ where: { id: soleId } });
    expect(user?.status).toBe('pending_deletion');
  });
});

describe('Account deletion preview (GET /account/delete-preview)', () => {
  it('correctly calculates admin teams with others, sole member teams, and subscription presence', async () => {
    const email = uniqueEmail('preview-user');
    const password = 'Preview-Password-1';
    const userId = await createVerifiedUser(email, password);
    const token = await signAccessToken(userId);
    const authHeader = { authorization: `Bearer ${token}` };

    const db0 = globalDb();
    await db0.owner_accounts.create({
      data: {
        user_id: userId,
        plan: 'monthly',
        status: 'active',
        currency: 'NGN',
      },
    });

    // Team 1: Sole member
    const team1Id = randomUUID();
    const shard1 = shardFor(team1Id);
    await writeDb(shard1).teams.create({ data: { id: team1Id, name: 'Team One' } });
    await writeDb(shard1).memberships.create({ data: { team_id: team1Id, user_id: userId, role: 'owner' } });
    await db0.user_team_index.create({ data: { user_id: userId, team_id: team1Id } });

    // Team 2: Admin with other member
    const memberId = await createVerifiedUser(uniqueEmail('preview-other'), 'Password-1');
    const team2Id = randomUUID();
    const shard2 = shardFor(team2Id);
    await writeDb(shard2).teams.create({ data: { id: team2Id, name: 'Team Two' } });
    await writeDb(shard2).memberships.create({ data: { team_id: team2Id, user_id: userId, role: 'owner' } });
    await writeDb(shard2).memberships.create({ data: { team_id: team2Id, user_id: memberId, role: 'staff' } });
    await db0.user_team_index.create({ data: { user_id: userId, team_id: team2Id } });
    await db0.user_team_index.create({ data: { user_id: memberId, team_id: team2Id } });

    // Registry: pays for 2 teams
    await db0.owner_team_registry.create({ data: { team_id: team1Id, owner_user_id: userId, status: 'active' } });
    await db0.owner_team_registry.create({ data: { team_id: team2Id, owner_user_id: userId, status: 'active' } });

    const res = await app.request('/account/delete-preview', { method: 'GET', headers: authHeader });
    expect(res.status).toBe(200);
    const data = await dataOf(res);

    expect(data.hasActiveSubscription).toBe(true);
    expect(data.soleMemberTeams).toBe(1);
    expect(data.paysForTeams).toBe(2);
    expect(data.adminTeamsWithOthers).toEqual([
      { id: team2Id, name: 'Team Two', otherMembers: 1 },
    ]);

    // When subscription is scheduled to cancel at period end, hasActiveSubscription is false
    await db0.owner_accounts.update({
      where: { user_id: userId },
      data: { cancel_at_period_end: true },
    });
    const resCancelled = await app.request('/account/delete-preview', { method: 'GET', headers: authHeader });
    expect(resCancelled.status).toBe(200);
    const dataCancelled = await dataOf(resCancelled);
    expect(dataCancelled.hasActiveSubscription).toBe(false);
  });
});

describe('Token paths audit: pending_deletion user gets NO tokens', () => {
  it('signIn refuses pending_deletion user with 403 auth.account_pending_deletion (no tokens)', async () => {
    const email = uniqueEmail('signin-pending');
    const password = 'SignIn-Password-1';
    await createVerifiedUser(email, password, { status: 'pending_deletion' });

    const res = await post(app, '/auth/signin', { email, password });
    expect(res.status).toBe(403);
    const error = await errorOf(res);
    expect(error.code).toBe('auth.account_pending_deletion');
    expect(error.message).toBe(AUTH_MESSAGES['auth.account_pending_deletion']);
  });

  it('refresh refuses pending_deletion user with 401 auth.refresh_invalid', async () => {
    const email = uniqueEmail('refresh-pending');
    const password = 'Refresh-Password-1';
    const userId = await createVerifiedUser(email, password, { status: 'pending_deletion' });

    const db0 = globalDb();
    const parts = createTokenParts();
    await db0.refresh_tokens.create({
      data: {
        selector: parts.selector,
        verifier_hash: await hashSecret(parts.verifier),
        family_id: randomUUID(),
        user_id: userId,
        expires_at: new Date(Date.now() + 30 * 86400 * 1000),
      },
    });

    const res = await post(app, '/auth/refresh', { refreshToken: formatToken(parts) });
    expect(res.status).toBe(401);
    const error = await errorOf(res);
    expect(error.code).toBe('auth.refresh_invalid');
  });

  it('magic link consume refuses pending_deletion user with 401 auth.link_invalid', async () => {
    const email = uniqueEmail('magic-pending');
    const password = 'Magic-Password-1';
    const userId = await createVerifiedUser(email, password, { status: 'pending_deletion' });

    const db0 = globalDb();
    const parts = createTokenParts();
    await db0.magic_tokens.create({
      data: {
        selector: parts.selector,
        verifier_hash: await hashSecret(parts.verifier),
        user_id: userId,
        expires_at: new Date(Date.now() + 900 * 1000),
      },
    });

    const res = await post(app, '/auth/magic/consume', { token: formatToken(parts) });
    expect(res.status).toBe(401);
    const error = await errorOf(res);
    expect(error.code).toBe('auth.link_invalid');
  });

  it('resetNewPassword refuses pending_deletion user with 401 auth.link_invalid', async () => {
    const email = uniqueEmail('reset-pending');
    const password = 'Reset-Password-1';
    const userId = await createVerifiedUser(email, password, { status: 'pending_deletion' });

    const db0 = globalDb();
    const grantParts = createTokenParts();
    await db0.password_resets.create({
      data: {
        user_id: userId,
        code_hash: await hashSecret('123456'),
        expires_at: new Date(Date.now() + 300 * 1000),
        consumed_at: new Date(),
        grant_selector: grantParts.selector,
        grant_verifier_hash: await hashSecret(grantParts.verifier),
        grant_expires_at: new Date(Date.now() + 600 * 1000),
      },
    });

    const res = await post(app, '/auth/reset', {
      grant: formatToken(grantParts),
      newPassword: 'NewPassword123!',
      confirm: 'NewPassword123!',
    });
    expect(res.status).toBe(401);
    const error = await errorOf(res);
    expect(error.code).toBe('auth.link_invalid');
  });

  it('GET /auth/me refuses pending_deletion user with 401 auth.not_authenticated', async () => {
    const email = uniqueEmail('me-pending');
    const password = 'Me-Password-1';
    const userId = await createVerifiedUser(email, password, { status: 'pending_deletion' });
    const token = await signAccessToken(userId);

    const res = await app.request('/auth/me', {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
    const error = await errorOf(res);
    expect(error.code).toBe('auth.not_authenticated');
  });
});

describe('Restore account (POST /auth/restore-account)', () => {
  it('happy path: restores status active, clears deletion_requested_at, issues NO tokens', async () => {
    const email = uniqueEmail('restore-happy');
    const password = 'Restore-Happy-Password-1';
    const userId = await createVerifiedUser(email, password, { status: 'pending_deletion' });

    const res = await post(app, '/auth/restore-account', { email, password });
    expect(res.status).toBe(200);
    const data = await dataOf(res);
    expect(data.message).toBe(AUTH_MESSAGES['auth.account_restored']);
    expect(data.accessToken).toBeUndefined();
    expect(data.refreshToken).toBeUndefined();

    const user = await globalDb().users.findUnique({ where: { id: userId } });
    expect(user?.status).toBe('active');
    expect(user?.deletion_requested_at).toBeNull();

    // Now normal sign in succeeds and issues tokens
    const signInRes = await post(app, '/auth/signin', { email, password });
    expect(signInRes.status).toBe(200);
    const signInData = await dataOf(signInRes);
    expect(signInData.accessToken).toBeDefined();
    expect(signInData.refreshToken).toBeDefined();
  });

  it('wrong password returns 401 generic failure', async () => {
    const email = uniqueEmail('restore-wrong-pw');
    const password = 'Correct-Password-1';
    await createVerifiedUser(email, password, { status: 'pending_deletion' });

    const res = await post(app, '/auth/restore-account', { email, password: 'Wrong-Password-1' });
    expect(res.status).toBe(401);
    const error = await errorOf(res);
    expect(error.code).toBe('auth.failed');
    expect(error.message).toBe(AUTH_MESSAGES['auth.signIn.failed']);
  });

  it('expired window (>30 days) returns 401 generic failure and does not restore', async () => {
    const email = uniqueEmail('restore-expired');
    const password = 'Restore-Password-1';
    const userId = await createVerifiedUser(email, password, { status: 'pending_deletion' });

    // Backdate deletion_requested_at to 31 days ago
    const past = new Date(Date.now() - 31 * 86400 * 1000);
    await globalDb().users.update({
      where: { id: userId },
      data: { deletion_requested_at: past },
    });

    const res = await post(app, '/auth/restore-account', { email, password });
    expect(res.status).toBe(401);
    const error = await errorOf(res);
    expect(error.code).toBe('auth.failed');
    expect(error.message).toBe(AUTH_MESSAGES['auth.signIn.failed']);

    const user = await globalDb().users.findUnique({ where: { id: userId } });
    expect(user?.status).toBe('pending_deletion');
  });

  it('account not in pending_deletion status returns 401 generic failure', async () => {
    const email = uniqueEmail('restore-not-pending');
    const password = 'Restore-Password-1';
    await createVerifiedUser(email, password, { status: 'active' });

    const res = await post(app, '/auth/restore-account', { email, password });
    expect(res.status).toBe(401);
    const error = await errorOf(res);
    expect(error.code).toBe('auth.failed');
    expect(error.message).toBe(AUTH_MESSAGES['auth.signIn.failed']);
  });
});

describe('Refusal of pending-deletion users on authenticated routes (Task D2b)', () => {
  it('an access token issued before deletion is refused after deletion, accepted again after restore', async () => {
    const email = uniqueEmail('d2b-refusal');
    const password = 'D2b-Refusal-Password-1';
    const userId = await createVerifiedUser(email, password);
    const token = await signAccessToken(userId);
    const authHeader = { authorization: `Bearer ${token}` };

    // 1. Before deletion: access token works normally on authenticated routes
    const beforeRes = await app.request('/account/delete-preview', {
      method: 'GET',
      headers: authHeader,
    });
    expect(beforeRes.status).toBe(200);

    // 2. Request account deletion
    const delRes = await post(app, '/account/delete', { password }, authHeader);
    expect(delRes.status).toBe(200);

    // 3. After deletion: same access token is immediately refused by auth middleware with 401 auth.not_authenticated
    const afterPreview = await app.request('/account/delete-preview', {
      method: 'GET',
      headers: authHeader,
    });
    expect(afterPreview.status).toBe(401);
    const afterErr = await errorOf(afterPreview);
    expect(afterErr.code).toBe('auth.not_authenticated');

    // Also check another authenticated route (GET /auth/me) to verify refusal on EVERY authenticated route
    const afterMe = await app.request('/auth/me', {
      method: 'GET',
      headers: authHeader,
    });
    expect(afterMe.status).toBe(401);
    const meErr = await errorOf(afterMe);
    expect(meErr.code).toBe('auth.not_authenticated');

    // 4. Restore account
    const restoreRes = await post(app, '/auth/restore-account', { email, password });
    expect(restoreRes.status).toBe(200);

    // 5. After restore: access token (still within its 5-minute lifetime) is accepted again
    const restoredRes = await app.request('/account/delete-preview', {
      method: 'GET',
      headers: authHeader,
    });
    expect(restoredRes.status).toBe(200);

    const restoredMe = await app.request('/auth/me', {
      method: 'GET',
      headers: authHeader,
    });
    expect(restoredMe.status).toBe(200);
  });

  it('fail-open: with refusal lookup forced to throw, an otherwise valid token is still accepted (200), and normal refusal still returns 401', async () => {
    const email = uniqueEmail('d2b-fail-open');
    const password = 'D2b-FailOpen-Password-1';
    const userId = await createVerifiedUser(email, password);
    const token = await signAccessToken(userId);
    const authHeader = { authorization: `Bearer ${token}` };

    // 1. Force the refusal lookup in Redis to throw
    const throwingRedis = {
      exists: async () => {
        throw new Error('Redis connection failed');
      },
    };
    __setRefusalRedisForTests(throwingRedis);

    try {
      // 2. An otherwise valid token is still accepted (200) under fail-open
      const resWhenThrowing = await app.request('/auth/me', {
        method: 'GET',
        headers: authHeader,
      });
      expect(resWhenThrowing.status).toBe(200);
    } finally {
      // Restore normal Redis client
      __setRefusalRedisForTests(null);
    }

    // 3. Mark user refused normally, confirm it still returns 401
    await markUserRefused(userId);
    const resRefused = await app.request('/auth/me', {
      method: 'GET',
      headers: authHeader,
    });
    expect(resRefused.status).toBe(401);
    const err = await errorOf(resRefused);
    expect(err.code).toBe('auth.not_authenticated');
  });
});

describe('Rate limiting on deletion and restore (S14)', () => {
  it('enforces rate limit on POST /account/delete (account.delete, max 5)', async () => {
    const email = uniqueEmail('rl-delete');
    const password = 'Rl-Password-1';
    const userId = await createVerifiedUser(email, password);
    const token = await signAccessToken(userId);
    const authHeader = { authorization: `Bearer ${token}` };

    for (let i = 0; i < 5; i++) {
      const res = await post(app, '/account/delete', { password: 'wrong' }, authHeader);
      expect(res.status).toBe(401);
    }

    const blocked = await post(app, '/account/delete', { password: 'wrong' }, authHeader);
    expect(blocked.status).toBe(429);
    const error = await errorOf(blocked);
    expect(error.code).toBe('rate.limited');
  });

  it('enforces rate limit on POST /auth/restore-account (restore.email, max 10)', async () => {
    const email = uniqueEmail('rl-restore');
    const password = 'Rl-Password-1';
    await createVerifiedUser(email, password, { status: 'pending_deletion' });

    for (let i = 0; i < 10; i++) {
      const res = await post(app, '/auth/restore-account', { email, password: 'wrong' });
      expect(res.status).toBe(401);
    }

    const blocked = await post(app, '/auth/restore-account', { email, password: 'wrong' });
    expect(blocked.status).toBe(429);
    const error = await errorOf(blocked);
    expect(error.code).toBe('rate.limited');
  });
});

