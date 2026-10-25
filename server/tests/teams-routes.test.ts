// Teams, roles, invites, and settings integration tests (PRD 4, 8.2; rules S6, S7, S8, S14, C3, C4, A3, A6, A7).
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import type { Worker } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { forTeam, globalDb } from '../src/db/clients.ts';
import { signAccessToken } from '../src/security/access-token.ts';
import {
  clearRateKeys,
  createVerifiedUser,
  dataOf,
  ensureTestCountries,
  errorOf,
  mailCaptureClear,
  post,
  shutdownAuthTest,
  startEmailWorker,
  testApp,
  uniqueEmail,
  waitForMail,
} from './helpers/auth-test.ts';

let app: Hono;
let worker: Worker;

async function get(app: Hono, path: string, headers: Record<string, string> = {}): Promise<Response> {
  return app.request(path, { method: 'GET', headers });
}

beforeAll(async () => {
  await clearRateKeys();
  await ensureTestCountries();
  await mailCaptureClear();
  worker = await startEmailWorker();
  app = testApp('teams-routes');
});

afterAll(async () => {
  await shutdownAuthTest(worker);
});

describe('Phase 3 Teams, roles, invites, seat skeleton routes', () => {
  let ownerId: string;
  let ownerEmail: string;
  let ownerAuth: { authorization: string };

  let managerId: string;
  let managerEmail: string;
  let managerAuth: { authorization: string };

  let staffId: string;
  let staffEmail: string;
  let staffAuth: { authorization: string };

  let teamId: string;

  beforeAll(async () => {
    ownerEmail = uniqueEmail('owner');
    ownerId = await createVerifiedUser(ownerEmail, 'OwnerPass123#');
    ownerAuth = { authorization: `Bearer ${await signAccessToken(ownerId)}` };

    managerEmail = uniqueEmail('manager');
    managerId = await createVerifiedUser(managerEmail, 'ManagerPass123#');
    managerAuth = { authorization: `Bearer ${await signAccessToken(managerId)}` };

    staffEmail = uniqueEmail('staff');
    staffId = await createVerifiedUser(staffEmail, 'StaffPass123#');
    staffAuth = { authorization: `Bearer ${await signAccessToken(staffId)}` };
  });

  describe('1. Create team (Idempotency, shard & global directory)', () => {
    it('requires Idempotency-Key header', async () => {
      const res = await post(app, '/teams', { name: 'Acme Cafe' }, ownerAuth);
      expect(res.status).toBe(400);
      const err = await errorOf(res);
      expect(err.code).toBe('idempotency.missing');
    });

    it('creates team and owner membership with valid Idempotency-Key', async () => {
      const idemKey = randomUUID();
      const res = await post(app, '/teams', { name: 'Acme Cafe' }, { ...ownerAuth, 'idempotency-key': idemKey });
      expect(res.status).toBe(201);
      const data = await dataOf(res);

      expect(data.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(data.name).toBe('Acme Cafe');
      expect(data.role).toBe('owner');
      expect(data.managersCanRevokeInvites).toBe(true);

      teamId = data.id as string;

      // Same key + same body returns the original cached result
      const replayRes = await post(app, '/teams', { name: 'Acme Cafe' }, { ...ownerAuth, 'idempotency-key': idemKey });
      expect(replayRes.status).toBe(201);
      const replayData = await dataOf(replayRes);
      expect(replayData.id).toBe(teamId);

      // Same key + different body is refused with 422
      const conflictRes = await post(app, '/teams', { name: 'Different Cafe' }, { ...ownerAuth, 'idempotency-key': idemKey });
      expect(conflictRes.status).toBe(422);
      const conflictErr = await errorOf(conflictRes);
      expect(conflictErr.code).toBe('idempotency.fingerprint_mismatch');
    });

    it('verifies owner membership on shard and indexes in DB0', async () => {
      const shardClient = forTeam(teamId);
      const membership = await shardClient.memberships.findUnique({
        where: { team_id_user_id: { team_id: teamId, user_id: ownerId } },
      });
      expect(membership).not.toBeNull();
      expect(membership?.role).toBe('owner');

      const db0 = globalDb();
      const dir = await db0.team_directory.findUnique({ where: { team_id: teamId } });
      expect(dir).not.toBeNull();

      const userIndex = await db0.user_team_index.findUnique({
        where: { user_id_team_id: { user_id: ownerId, team_id: teamId } },
      });
      expect(userIndex).not.toBeNull();
    });
  });

  describe('2. List and Get teams', () => {
    it('returns team list including role for owner', async () => {
      const res = await get(app, '/teams', ownerAuth);
      expect(res.status).toBe(200);
      const data = await dataOf(res);
      const teams = data.teams as { id: string; name: string; role: string }[];
      expect(teams.some((t) => t.id === teamId && t.role === 'owner')).toBe(true);
    });

    it('gets team details for member', async () => {
      const res = await get(app, `/teams/${teamId}`, ownerAuth);
      expect(res.status).toBe(200);
      const data = await dataOf(res);
      expect(data.id).toBe(teamId);
      expect(data.name).toBe('Acme Cafe');
      expect(data.role).toBe('owner');
    });
  });

  describe('3. Inviting members', () => {
    let managerToken: string;
    let staffToken: string;

    it('raw HTTP call as Staff to invite endpoint returns 403 (PRD Section 4 gate)', async () => {
      // Temporarily add staff to team so team 404 does not shadow 403
      const shardClient = forTeam(teamId);
      await shardClient.memberships.create({
        data: { team_id: teamId, user_id: staffId, role: 'staff' },
      });
      await globalDb().user_team_index.create({
        data: { user_id: staffId, team_id: teamId },
      });

      const res = await post(app, `/teams/${teamId}/invites`, { email: uniqueEmail('test'), role: 'staff' }, staffAuth);
      expect(res.status).toBe(403);
      const err = await errorOf(res);
      expect(err.code).toBe('team.forbidden');

      // Clean up temporary membership
      await shardClient.memberships.delete({
        where: { team_id_user_id: { team_id: teamId, user_id: staffId } },
      });
      await globalDb().user_team_index.delete({
        where: { user_id_team_id: { user_id: staffId, team_id: teamId } },
      });
    });

    it('Owner invites Manager; returns uniform message and enqueues email', async () => {
      await mailCaptureClear();
      const res = await post(app, `/teams/${teamId}/invites`, { email: managerEmail, role: 'manager' }, ownerAuth);
      expect(res.status).toBe(200);
      const data = await dataOf(res);
      expect(data.message).toBe('Invitation sent.');

      const mail = await waitForMail(managerEmail);
      expect(mail.subject).toContain('Acme Cafe');
      expect(mail.text).toContain('/invite/');
      const match = /\/invite\/([A-Za-z0-9_.~-]+)/.exec(mail.text);
      expect(match).not.toBeNull();
      managerToken = match![1]!;

      // Invite row in DB contains Argon2id hash, never raw verifier (Rule A3)
      const shardClient = forTeam(teamId);
      const invRow = await shardClient.invites.findFirst({
        where: { team_id: teamId, email: managerEmail, accepted_at: null },
      });
      expect(invRow).not.toBeNull();
      expect(invRow?.verifier_hash).toMatch(/^\$argon2id\$/);
      expect(invRow?.verifier_hash).not.toContain(managerToken.split('.')[1]!);
    });

    it('Manager accepts invite: lands in team with manager role', async () => {
      const res = await post(app, '/invites/accept', { token: managerToken }, managerAuth);
      expect(res.status).toBe(200);
      const data = await dataOf(res);
      expect(data.teamId).toBe(teamId);
      expect(data.role).toBe('manager');

      // Verify membership
      const shardClient = forTeam(teamId);
      const m = await shardClient.memberships.findUnique({
        where: { team_id_user_id: { team_id: teamId, user_id: managerId } },
      });
      expect(m?.role).toBe('manager');
      expect(m?.removed_at).toBeNull();
    });

    it('reusing already accepted invite token fails with uniform error', async () => {
      const res = await post(app, '/invites/accept', { token: managerToken }, managerAuth);
      expect(res.status).toBe(400);
      const err = await errorOf(res);
      expect(err.code).toBe('auth.link.invalid');
      expect(err.message).toBe('This link is invalid or has expired. Request a new one.');
    });

    it('Manager cannot invite another Manager (forbidden 403)', async () => {
      const res = await post(app, `/teams/${teamId}/invites`, { email: uniqueEmail('mgr2'), role: 'manager' }, managerAuth);
      expect(res.status).toBe(403);
      const err = await errorOf(res);
      expect(err.code).toBe('team.forbidden');
    });

    it('Manager can invite Staff (PRD Section 4 decision)', async () => {
      await mailCaptureClear();
      const res = await post(app, `/teams/${teamId}/invites`, { email: staffEmail, role: 'staff' }, managerAuth);
      expect(res.status).toBe(200);
      const data = await dataOf(res);
      expect(data.message).toBe('Invitation sent.');

      const mail = await waitForMail(staffEmail);
      const match = /\/invite\/([A-Za-z0-9_.~-]+)/.exec(mail.text);
      expect(match).not.toBeNull();
      staffToken = match![1]!;
    });

    it('accepting invite with wrong email returns identical error (Owner Decision 2)', async () => {
      const otherEmail = uniqueEmail('other');
      const otherId = await createVerifiedUser(otherEmail, 'OtherPass123#');
      const otherAuth = { authorization: `Bearer ${await signAccessToken(otherId)}` };

      const res = await post(app, '/invites/accept', { token: staffToken }, otherAuth);
      expect(res.status).toBe(400);
      const err = await errorOf(res);
      expect(err.code).toBe('auth.link.invalid');
      expect(err.message).toBe('This link is invalid or has expired. Request a new one.');
    });

    it('accepting invite with wrong verifier returns identical error (Rule A7)', async () => {
      const [selector] = staffToken.split('.');
      const bogusToken = `${selector}.0000000000000000000000000000000000000000000000000000000000000000`;
      const res = await post(app, '/invites/accept', { token: bogusToken }, staffAuth);
      expect(res.status).toBe(400);
      const err = await errorOf(res);
      expect(err.code).toBe('auth.link.invalid');
      expect(err.message).toBe('This link is invalid or has expired. Request a new one.');
    });

    it('Staff accepts invite: lands in team with staff role', async () => {
      const res = await post(app, '/invites/accept', { token: staffToken }, staffAuth);
      expect(res.status).toBe(200);
      const data = await dataOf(res);
      expect(data.teamId).toBe(teamId);
      expect(data.role).toBe('staff');
    });

    it('invite creation returns identical response whether email exists or not (Rule A6)', async () => {
      const nonExistentEmail = uniqueEmail('nobody');
      const res = await post(app, `/teams/${teamId}/invites`, { email: nonExistentEmail, role: 'staff' }, ownerAuth);
      expect(res.status).toBe(200);
      const data = await dataOf(res);
      expect(data.message).toBe('Invitation sent.');
    });

    it('resending to the same email replaces the open invite (invites_one_open_idx)', async () => {
      const testEmail = uniqueEmail('resend-target');
      const res1 = await post(app, `/teams/${teamId}/invites`, { email: testEmail, role: 'staff' }, ownerAuth);
      expect(res1.status).toBe(200);

      // Resend replaces without constraint violation
      const res2 = await post(app, `/teams/${teamId}/invites`, { email: testEmail, role: 'staff' }, ownerAuth);
      expect(res2.status).toBe(200);

      // Shard contains only one open unrevoked invite for testEmail
      const shardClient = forTeam(teamId);
      const openInvites = await shardClient.invites.findMany({
        where: { team_id: teamId, email: testEmail, accepted_at: null, revoked_at: null },
      });
      expect(openInvites).toHaveLength(1);
    });
  });

  describe('4. Roles and Member Management (Rule S8)', () => {
    it('lists members for team', async () => {
      const res = await get(app, `/teams/${teamId}/members`, ownerAuth);
      expect(res.status).toBe(200);
      const data = await dataOf(res);
      const members = data.members as { userId: string; role: string; email: string }[];
      expect(members.some((m) => m.userId === ownerId && m.role === 'owner')).toBe(true);
      expect(members.some((m) => m.userId === managerId && m.role === 'manager')).toBe(true);
      expect(members.some((m) => m.userId === staffId && m.role === 'staff')).toBe(true);
    });

    it('Owner can change staff role to manager', async () => {
      const res = await post(app, `/teams/${teamId}/members/${staffId}/role`, { role: 'manager' }, ownerAuth);
      expect(res.status).toBe(200);
      const data = await dataOf(res);
      expect(data.role).toBe('manager');

      // Demote back to staff
      const demoteRes = await post(app, `/teams/${teamId}/members/${staffId}/role`, { role: 'staff' }, ownerAuth);
      expect(demoteRes.status).toBe(200);
    });

    it('demotion takes effect on the very next request (Rule S8)', async () => {
      // staff was demoted; attempting an action reserved for managers (e.g. invite) is immediately rejected
      const res = await post(app, `/teams/${teamId}/invites`, { email: uniqueEmail('fail'), role: 'staff' }, staffAuth);
      expect(res.status).toBe(403);
    });

    it('Manager and Staff cannot change roles (403)', async () => {
      const res = await post(app, `/teams/${teamId}/members/${staffId}/role`, { role: 'manager' }, managerAuth);
      expect(res.status).toBe(403);
    });

    it('Owner role cannot be changed (single owner rule)', async () => {
      const res = await post(app, `/teams/${teamId}/members/${ownerId}/role`, { role: 'staff' }, ownerAuth);
      expect(res.status).toBe(403);
    });

    it('Owner cannot be removed by anyone (auth.deleteOwner.blocked)', async () => {
      const res = await post(app, `/teams/${teamId}/members/${ownerId}/remove`, {}, ownerAuth);
      expect(res.status).toBe(400);
      const err = await errorOf(res);
      expect(err.code).toBe('auth.deleteOwner.blocked');
      expect(err.message).toBe('Transfer or delete your team first.');
    });

    it('Owner cannot leave the team (auth.deleteOwner.blocked)', async () => {
      const res = await post(app, `/teams/${teamId}/leave`, {}, ownerAuth);
      expect(res.status).toBe(400);
      const err = await errorOf(res);
      expect(err.code).toBe('auth.deleteOwner.blocked');
    });

    it('Staff can leave the team and loses access immediately', async () => {
      const res = await post(app, `/teams/${teamId}/leave`, {}, staffAuth);
      expect(res.status).toBe(200);

      // Now staff gets 404 when querying team (Rule S7)
      const checkRes = await get(app, `/teams/${teamId}`, staffAuth);
      expect(checkRes.status).toBe(404);
    });
  });

  describe('5. Team settings and Invite Revocation (Owner Decision 4)', () => {
    let inviteToRevokeId: string;

    beforeAll(async () => {
      // Owner invites a fresh staff member to test revocation
      const invEmail = uniqueEmail('revokee');
      await post(app, `/teams/${teamId}/invites`, { email: invEmail, role: 'staff' }, ownerAuth);

      const shardClient = forTeam(teamId);
      const inv = await shardClient.invites.findFirst({
        where: { team_id: teamId, email: invEmail, accepted_at: null, revoked_at: null },
      });
      inviteToRevokeId = inv!.id;
    });

    it('Manager can revoke staff invite while managers_can_revoke_invites is true', async () => {
      const res = await post(app, `/teams/${teamId}/invites/${inviteToRevokeId}/revoke`, {}, managerAuth);
      expect(res.status).toBe(200);
      const data = await dataOf(res);
      expect(data.revoked).toBe(true);

      const shardClient = forTeam(teamId);
      const inv = await shardClient.invites.findUnique({ where: { id: inviteToRevokeId } });
      expect(inv?.revoked_at).not.toBeNull();
    });

    it('Owner toggles managers_can_revoke_invites to false', async () => {
      const res = await post(app, `/teams/${teamId}/settings`, { managers_can_revoke_invites: false }, ownerAuth);
      expect(res.status).toBe(200);
      const data = await dataOf(res);
      expect(data.managersCanRevokeInvites).toBe(false);
    });

    it('Manager cannot toggle team settings (403)', async () => {
      const res = await post(app, `/teams/${teamId}/settings`, { managers_can_revoke_invites: true }, managerAuth);
      expect(res.status).toBe(403);
    });

    it('Manager cannot revoke staff invite when managers_can_revoke_invites is false (403)', async () => {
      const invEmail = uniqueEmail('revokee2');
      await post(app, `/teams/${teamId}/invites`, { email: invEmail, role: 'staff' }, ownerAuth);
      const shardClient = forTeam(teamId);
      const inv = await shardClient.invites.findFirst({
        where: { team_id: teamId, email: invEmail, accepted_at: null, revoked_at: null },
      });

      const res = await post(app, `/teams/${teamId}/invites/${inv!.id}/revoke`, {}, managerAuth);
      expect(res.status).toBe(403);

      // Owner can still revoke it
      const ownerRevokeRes = await post(app, `/teams/${teamId}/invites/${inv!.id}/revoke`, {}, ownerAuth);
      expect(ownerRevokeRes.status).toBe(200);
    });
  });
});
