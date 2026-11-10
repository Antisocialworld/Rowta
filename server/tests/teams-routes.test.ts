// Teams, roles, invites, and settings integration tests (PRD 4, 8.2; rules S6, S7, S8, S14, C3, C4, A3, A6, A7).
import { Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import type { Worker } from 'bullmq';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CreateTeamInput } from '@rowta/shared';
import { env } from '../src/config/env.ts';
import { forTeam, globalDb } from '../src/db/clients.ts';
import { createApp } from '../src/index.ts';
import { buildLoggerOptions } from '../src/lib/logger.ts';
import { signAccessToken } from '../src/security/access-token.ts';
import { createTeam } from '../src/teams/service.ts';
import {
  clearRateKeys,
  createVerifiedUser,
  dataOf,
  ensureTestCountries,
  errorOf,
  mailCaptureClear,
  post,
  redis,
  shutdownAuthTest,
  startEmailWorker,
  testApp,
  uniqueEmail,
  waitForMail,
  inviteTokenFromMail,
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

    it('idempotency fingerprint allowlists only `name` (non-allowlisted fields do not change the fingerprint)', async () => {
      // Proven at the SERVICE level because createTeamSchema is .strict() over HTTP: an unknown
      // body field is rejected with 422 validation.unknown_field before idempotency runs.
      const idemKey = randomUUID();
      const first = await createTeam(ownerId, { name: 'Acme Cafe' }, idemKey);
      expect(first.name).toBe('Acme Cafe');
      expect(first.id).toMatch(/^[0-9a-f-]{36}$/);

      // Same key + same allowlisted field + an extra non-allowlisted property: treated as the
      // SAME request, the original team comes back (PRD 9.9 allowlist semantics).
      const widened = { name: 'Acme Cafe', futureField: 'ignored-by-the-fingerprint' } as CreateTeamInput;
      const replay = await createTeam(ownerId, widened, idemKey);
      expect(replay.id).toBe(first.id);

      // Over HTTP the same extra property is refused by the strict schema before idempotency.
      const httpRes = await post(
        app,
        '/teams',
        { name: 'Acme Cafe', futureField: 'x' },
        { ...ownerAuth, 'idempotency-key': randomUUID() },
      );
      expect(httpRes.status).toBe(422);
      const httpErr = await errorOf(httpRes);
      expect(httpErr.code).toBe('validation.invalid');
      expect(httpErr.fields?.futureField).toBe('validation.unknown_field');
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
      expect(mail.text).toContain('/invite/#');
      // Owner Decision 3 + G7: the email carries the canonical https invite link with token in fragment
      // <PUBLIC_WEB_URL>/invite/#<token>, never a bare path or the app custom scheme.
      const prefix = env.PUBLIC_WEB_URL.replace(/\/+$/, '');
      managerToken = inviteTokenFromMail(mail);
      expect(mail.text).toContain(`${prefix}/invite/#${managerToken}`);

      // Invite row in DB contains Argon2id hash, never raw verifier (Rule A3)
      const shardClient = forTeam(teamId);
      const invRow = await shardClient.invites.findFirst({
        where: { team_id: teamId, email: managerEmail, accepted_at: null },
      });
      expect(invRow).not.toBeNull();
      expect(invRow?.verifier_hash).toMatch(/^\$argon2id\$/);
      const rawVerifier = managerToken.split('.')[1]!;
      for (const [col, val] of Object.entries(invRow!)) {
        expect(String(val), `verifier appears in column ${col}`).not.toContain(rawVerifier);
      }
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

    it('legacy path-style routes return 404 (PRD 8.2; no token in URL path)', async () => {
      const resGet = await get(app, '/invites/fake-token-value');
      expect(resGet.status).toBe(404);

      const resPost = await post(app, '/invites/fake-token-value/accept', {}, ownerAuth);
      expect(resPost.status).toBe(404);
    });

    it('expired invite acceptance fails with identical uniform error', async () => {
      const expEmail = uniqueEmail('expired-target');
      const expId = await createVerifiedUser(expEmail, 'ExpiredPass123#');
      const expAuth = { authorization: `Bearer ${await signAccessToken(expId)}` };

      await mailCaptureClear();
      const invRes = await post(app, `/teams/${teamId}/invites`, { email: expEmail, role: 'staff' }, ownerAuth);
      expect(invRes.status).toBe(200);

      const mail = await waitForMail(expEmail);
      const token = inviteTokenFromMail(mail);

      // Expire the invite in the database
      const shardClient = forTeam(teamId);
      const [selector] = token.split('.');
      await shardClient.invites.update({
        where: { selector },
        data: { expires_at: new Date(Date.now() - 60_000) },
      });

      const res = await post(app, '/invites/accept', { token }, expAuth);
      expect(res.status).toBe(400);
      const err = await errorOf(res);
      expect(err.code).toBe('auth.link.invalid');
      expect(err.message).toBe('This link is invalid or has expired. Request a new one.');
    });

    it('revoked invite acceptance fails with identical uniform error', async () => {
      const revEmail = uniqueEmail('revoked-target');
      const revId = await createVerifiedUser(revEmail, 'RevokedPass123#');
      const revAuth = { authorization: `Bearer ${await signAccessToken(revId)}` };

      await mailCaptureClear();
      const invRes = await post(app, `/teams/${teamId}/invites`, { email: revEmail, role: 'staff' }, ownerAuth);
      expect(invRes.status).toBe(200);

      const mail = await waitForMail(revEmail);
      const token = inviteTokenFromMail(mail);

      // Revoke the invite in the database
      const shardClient = forTeam(teamId);
      const [selector] = token.split('.');
      await shardClient.invites.update({
        where: { selector },
        data: { revoked_at: new Date() },
      });

      const res = await post(app, '/invites/accept', { token }, revAuth);
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
      staffToken = inviteTokenFromMail(mail);
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
      const existingEmail = uniqueEmail('existing-acct');
      await createVerifiedUser(existingEmail, 'Existing123#');
      const nonExistentEmail = uniqueEmail('nobody-acct');

      const resExisting = await post(app, `/teams/${teamId}/invites`, { email: existingEmail, role: 'staff' }, ownerAuth);
      const resNonExistent = await post(app, `/teams/${teamId}/invites`, { email: nonExistentEmail, role: 'staff' }, ownerAuth);

      expect(resExisting.status).toBe(200);
      expect(resNonExistent.status).toBe(200);
      const textExisting = await resExisting.text();
      const textNonExistent = await resNonExistent.text();
      expect(textExisting).toBe(textNonExistent);
      const parsed = JSON.parse(textExisting) as { data: { message: string } };
      expect(parsed.data.message).toBe('Invitation sent.');
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

    it('invite token never reaches the request logs (Owner Decision 3, Rule S9)', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(String(chunk));
          callback();
        },
      });
      const log = pino(buildLoggerOptions('info'), stream);
      const watched = createApp({ log, redis });

      const logEmail = uniqueEmail('logwatch-invite');
      const logId = await createVerifiedUser(logEmail, 'LogInvitePass123#');
      const logAuth = { authorization: `Bearer ${await signAccessToken(logId)}` };

      // Seat math at this point: 2 active non-owner members (manager, staff) + 3 leftover open
      // invites from earlier tests = the Starter cap of 5. Revoke the leftovers so this invite
      // fits (the earlier tests already asserted their own behaviour).
      await forTeam(teamId).invites.updateMany({
        where: { team_id: teamId, accepted_at: null, revoked_at: null },
        data: { revoked_at: new Date() },
      });

      await mailCaptureClear();
      const createRes = await post(
        watched,
        `/teams/${teamId}/invites`,
        { email: logEmail, role: 'staff' },
        ownerAuth,
      );
      expect(createRes.status).toBe(200);
      const mail = await waitForMail(logEmail);
      const token = inviteTokenFromMail(mail);
      const rawVerifier = token.split('.')[1]!;

      // Accept through the same watched app so the token in a request body is also covered (success path).
      const acceptRes = await post(watched, '/invites/accept', { token }, logAuth);
      expect(acceptRes.status).toBe(200);

      // Also call with a wrong token so the failure path (400 auth.link.invalid) is covered.
      const wrongToken = 'WRONG_INVITE_TOKEN.verifier1234567890';
      const [wrongSelector, wrongVerifier] = wrongToken.split('.');
      const wrongRes = await post(watched, '/invites/accept', { token: wrongToken }, logAuth);
      expect(wrongRes.status).toBe(400);

      const text = chunks.join('');
      // Real traffic was captured...
      expect(text).toContain('"route"');
      // ...and neither the raw token nor its verifier ever reached the logs...
      expect(text).not.toContain(token);
      expect(text).not.toContain(rawVerifier);
      // ...the wrong token (neither selector nor verifier) never reached the logs...
      expect(text).not.toContain(wrongToken);
      expect(text).not.toContain(wrongSelector!);
      expect(text).not.toContain(wrongVerifier!);
      // ...and no Argon2 hash string appeared.
      expect(text).not.toContain('$argon2id$');

      // Fixture cleanup: this accepted member must not eat a Starter seat for section 5's
      // invite tests (5-seat boundary: active non-owner + open invites must stay at 4 here).
      const shardClient = forTeam(teamId);
      await shardClient.memberships.delete({
        where: { team_id_user_id: { team_id: teamId, user_id: logId } },
      });
      await globalDb().user_team_index.delete({
        where: { user_id_team_id: { user_id: logId, team_id: teamId } },
      });
    });
  });

  describe('4. Roles and Member Management (Rule S8)', () => {
    it('lists members for team (privacy: Owner and Manager see emails, Staff sees own email only)', async () => {
      // Owner sees full emails
      const ownerRes = await get(app, `/teams/${teamId}/members`, ownerAuth);
      expect(ownerRes.status).toBe(200);
      const ownerData = await dataOf(ownerRes);
      const ownerMembers = ownerData.members as { userId: string; role: string; email: string }[];
      expect(ownerMembers.some((m) => m.userId === ownerId && m.role === 'owner')).toBe(true);
      expect(ownerMembers.some((m) => m.userId === managerId && m.role === 'manager')).toBe(true);
      expect(ownerMembers.some((m) => m.userId === staffId && m.role === 'staff')).toBe(true);
      expect(ownerMembers.every((m) => m.email.length > 0)).toBe(true);

      // Manager also sees full emails
      const mgrRes = await get(app, `/teams/${teamId}/members`, managerAuth);
      expect(mgrRes.status).toBe(200);
      const mgrMembers = (await dataOf(mgrRes)).members as { userId: string; email: string }[];
      expect(mgrMembers.every((m) => m.email.length > 0)).toBe(true);

      // Staff sees own email, but empty string for other members
      const staffRes = await get(app, `/teams/${teamId}/members`, staffAuth);
      expect(staffRes.status).toBe(200);
      const staffMembers = (await dataOf(staffRes)).members as { userId: string; email: string }[];
      const selfMember = staffMembers.find((m) => m.userId === staffId);
      expect(selfMember?.email.length).toBeGreaterThan(0);
      const otherMembers = staffMembers.filter((m) => m.userId !== staffId);
      expect(otherMembers.length).toBeGreaterThan(0);
      expect(otherMembers.every((m) => m.email === '')).toBe(true);
    });

    it('Staff cannot see invites list (403), while Owner and Manager can (200)', async () => {
      // Staff gets 403 forbidden
      const staffInvRes = await get(app, `/teams/${teamId}/invites`, staffAuth);
      expect(staffInvRes.status).toBe(403);
      const staffInvErr = await errorOf(staffInvRes);
      expect(staffInvErr.code).toBe('team.forbidden');

      // Owner gets 200
      const ownerInvRes = await get(app, `/teams/${teamId}/invites`, ownerAuth);
      expect(ownerInvRes.status).toBe(200);

      // Manager gets 200
      const mgrInvRes = await get(app, `/teams/${teamId}/invites`, managerAuth);
      expect(mgrInvRes.status).toBe(200);
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

    it('Owner who is billing payer cannot leave the team (billing.payer_cannot_leave_self)', async () => {
      const res = await post(app, `/teams/${teamId}/leave`, {}, ownerAuth);
      expect(res.status).toBe(403);
      const err = await errorOf(res);
      expect(err.code).toBe('billing.payer_cannot_leave_self');
      expect(err.message).toBe('You pay for this team. Move billing first.');
    });

    it('Owner who is NOT the billing payer cannot leave the team (auth.deleteOwner.blocked)', async () => {
      const founderEmail = uniqueEmail('np-founder');
      const founderId = await createVerifiedUser(founderEmail, 'FounderPass123#');
      const founderAuth = { authorization: `Bearer ${await signAccessToken(founderId)}` };

      const newOwnerEmail = uniqueEmail('np-newowner');
      const newOwnerId = await createVerifiedUser(newOwnerEmail, 'NewOwnerPass123#');
      const newOwnerAuth = { authorization: `Bearer ${await signAccessToken(newOwnerId)}` };

      const createRes = await post(
        app,
        '/teams',
        { name: 'Non-Payer Owner Team' },
        { ...founderAuth, 'idempotency-key': randomUUID() },
      );
      expect(createRes.status).toBe(201);
      const testTeamId = (await dataOf(createRes)).id as string;

      await mailCaptureClear();
      const inviteRes = await post(app, `/teams/${testTeamId}/invites`, { email: newOwnerEmail, role: 'manager' }, founderAuth);
      expect(inviteRes.status).toBe(200);
      const mail = await waitForMail(newOwnerEmail);
      const token = inviteTokenFromMail(mail);
      const acceptRes = await post(app, '/invites/accept', { token }, newOwnerAuth);
      expect(acceptRes.status).toBe(200);

      const transferRes = await post(app, `/teams/${testTeamId}/transfer`, { targetUserId: newOwnerId }, founderAuth);
      expect(transferRes.status).toBe(200);

      // New owner (not the billing payer) attempts to leave -> 400 auth.deleteOwner.blocked
      const leaveRes = await post(app, `/teams/${testTeamId}/leave`, {}, newOwnerAuth);
      expect(leaveRes.status).toBe(400);
      const err = await errorOf(leaveRes);
      expect(err.code).toBe('auth.deleteOwner.blocked');
      expect(err.message).toBe('Transfer or delete your team first.');
    });

    it('Manager cannot remove another Manager (403 team.forbidden)', async () => {
      // Second manager added directly (PRD 4: remove_member is staff-only for Manager).
      const mgr2Email = uniqueEmail('mgr2-target');
      const mgr2Id = await createVerifiedUser(mgr2Email, 'Mgr2Pass123#');
      const shardClient = forTeam(teamId);
      await shardClient.memberships.create({
        data: { team_id: teamId, user_id: mgr2Id, role: 'manager' },
      });
      await globalDb().user_team_index.create({
        data: { user_id: mgr2Id, team_id: teamId },
      });

      const res = await post(app, `/teams/${teamId}/members/${mgr2Id}/remove`, {}, managerAuth);
      expect(res.status).toBe(403);
      const err = await errorOf(res);
      expect(err.code).toBe('team.forbidden');

      // Cleanup fixture
      await shardClient.memberships.delete({
        where: { team_id_user_id: { team_id: teamId, user_id: mgr2Id } },
      });
      await globalDb().user_team_index.delete({
        where: { user_id_team_id: { user_id: mgr2Id, team_id: teamId } },
      });
    });

    it('Manager cannot remove the Owner (400 auth.deleteOwner.blocked, owner guard before can())', async () => {
      const res = await post(app, `/teams/${teamId}/members/${ownerId}/remove`, {}, managerAuth);
      expect(res.status).toBe(400);
      const err = await errorOf(res);
      expect(err.code).toBe('auth.deleteOwner.blocked');
      expect(err.message).toBe('Transfer or delete your team first.');
    });

    it('Staff cannot change any member role (403 team.forbidden; change_role is owner-only)', async () => {
      const res = await post(app, `/teams/${teamId}/members/${managerId}/role`, { role: 'staff' }, staffAuth);
      expect(res.status).toBe(403);
      const err = await errorOf(res);
      expect(err.code).toBe('team.forbidden');
    });

    it('Staff cannot remove any member (403 team.forbidden; remove_member is owner/manager only)', async () => {
      const res = await post(app, `/teams/${teamId}/members/${managerId}/remove`, {}, staffAuth);
      expect(res.status).toBe(403);
      const err = await errorOf(res);
      expect(err.code).toBe('team.forbidden');
    });

    it('Staff cannot transfer team ownership (403 team.forbidden; transfer_ownership is owner-only)', async () => {
      const res = await post(app, `/teams/${teamId}/transfer`, { targetUserId: managerId }, staffAuth);
      expect(res.status).toBe(403);
      const err = await errorOf(res);
      expect(err.code).toBe('team.forbidden');
    });

    it('Staff cannot create invitations (403 team.forbidden; invite_member is owner/manager only)', async () => {
      const res = await post(app, `/teams/${teamId}/invites`, { email: uniqueEmail('staff-invite-attempt'), role: 'staff' }, staffAuth);
      expect(res.status).toBe(403);
      const err = await errorOf(res);
      expect(err.code).toBe('team.forbidden');
    });

    it('Staff cannot revoke invitations (403 team.forbidden; revoke_invite is owner/manager only)', async () => {
      const openInvEmail = uniqueEmail('staff-revoke-target');
      await post(app, `/teams/${teamId}/invites`, { email: openInvEmail, role: 'staff' }, ownerAuth);
      const inv = await forTeam(teamId).invites.findFirst({
        where: { team_id: teamId, email: openInvEmail, revoked_at: null },
      });
      expect(inv).not.toBeNull();

      const res = await post(app, `/teams/${teamId}/invites/${inv!.id}/revoke`, {}, staffAuth);
      expect(res.status).toBe(403);
      const err = await errorOf(res);
      expect(err.code).toBe('team.forbidden');
    });

    it('Staff cannot toggle team settings (403 team.forbidden; manage_settings is owner-only)', async () => {
      const res = await post(app, `/teams/${teamId}/settings`, { managers_can_revoke_invites: false }, staffAuth);
      expect(res.status).toBe(403);
      const err = await errorOf(res);
      expect(err.code).toBe('team.forbidden');
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

    it('Manager cannot revoke a manager invite (forbidden 403)', async () => {
      // Re-enable managers_can_revoke_invites to true first
      await post(app, `/teams/${teamId}/settings`, { managers_can_revoke_invites: true }, ownerAuth);

      const mgrInvEmail = uniqueEmail('mgr-inv-target');
      await post(app, `/teams/${teamId}/invites`, { email: mgrInvEmail, role: 'manager' }, ownerAuth);

      const shardClient = forTeam(teamId);
      const inv = await shardClient.invites.findFirst({
        where: { team_id: teamId, email: mgrInvEmail, role: 'manager', revoked_at: null },
      });
      expect(inv).not.toBeNull();

      // Manager tries to revoke a manager invite -> 403
      const res = await post(app, `/teams/${teamId}/invites/${inv!.id}/revoke`, {}, managerAuth);
      expect(res.status).toBe(403);
      const err = await errorOf(res);
      expect(err.code).toBe('team.forbidden');

      // Only Owner can revoke manager invites
      const ownerRevokeRes = await post(app, `/teams/${teamId}/invites/${inv!.id}/revoke`, {}, ownerAuth);
      expect(ownerRevokeRes.status).toBe(200);
    });
  });

  describe('Phase C: Team soft deletion and ownership transfer (ADR 0018)', () => {
    it('enforces owner-only permission and confirmation name on team deletion', async () => {
      const oEmail = uniqueEmail('del-owner');
      const oId = await createVerifiedUser(oEmail, 'OwnerPass123#');
      const oAuth = { authorization: `Bearer ${await signAccessToken(oId)}` };

      const mEmail = uniqueEmail('del-manager');
      const mId = await createVerifiedUser(mEmail, 'ManagerPass123#');
      const mAuth = { authorization: `Bearer ${await signAccessToken(mId)}` };

      // Create a team
      const createRes = await post(
        app,
        '/teams',
        { name: 'Delete Test Team' },
        { ...oAuth, 'idempotency-key': randomUUID() },
      );
      expect(createRes.status).toBe(201);
      const delTeamId = (await dataOf(createRes)).id as string;

      // Add manager
      const inviteRes = await post(app, `/teams/${delTeamId}/invites`, { email: mEmail, role: 'manager' }, oAuth);
      expect(inviteRes.status).toBe(200);
      const mail = await waitForMail(mEmail);
      const token = inviteTokenFromMail(mail);
      const acceptRes = await post(app, '/invites/accept', { token }, mAuth);
      expect(acceptRes.status).toBe(200);
      const acceptData = await dataOf(acceptRes);
      expect(acceptData.role).toBe('manager');

      // 1. Manager tries to delete -> 403
      const mgrDelRes = await post(app, `/teams/${delTeamId}/delete`, { confirmName: 'Delete Test Team' }, mAuth);
      expect(mgrDelRes.status).toBe(403);
      const mgrDelErr = await errorOf(mgrDelRes);
      expect(mgrDelErr.code).toBe('team.forbidden');

      // 2. Owner with mismatched name -> 422 team.nameMismatch
      const wrongNameRes = await post(app, `/teams/${delTeamId}/delete`, { confirmName: 'Wrong Name' }, oAuth);
      expect(wrongNameRes.status).toBe(422);
      const wrongNameErr = await errorOf(wrongNameRes);
      expect(wrongNameErr.code).toBe('team.nameMismatch');

      // 3. Owner with correct name -> 200 soft delete
      const delRes = await post(app, `/teams/${delTeamId}/delete`, { confirmName: ' Delete Test Team ' }, oAuth);
      expect(delRes.status).toBe(200);
      const delData = await dataOf(delRes);
      expect(delData.success).toBe(true);
      expect(delData.teamId).toBe(delTeamId);

      // 4. Subsequent queries for deleted team return 404 team.notFound
      const getRes = await get(app, `/teams/${delTeamId}`, oAuth);
      expect(getRes.status).toBe(404);
      const getErr = await errorOf(getRes);
      expect(getErr.code).toBe('team.notFound');

      const membersRes = await get(app, `/teams/${delTeamId}/members`, oAuth);
      expect(membersRes.status).toBe(404);
    });

    it('transfers ownership, swaps roles, and preserves created_by', async () => {
      const oEmail = uniqueEmail('tf-owner');
      const oId = await createVerifiedUser(oEmail, 'OwnerPass123#');
      const oAuth = { authorization: `Bearer ${await signAccessToken(oId)}` };

      const cEmail = uniqueEmail('tf-colleague');
      const cId = await createVerifiedUser(cEmail, 'ColleaguePass123#');
      const cAuth = { authorization: `Bearer ${await signAccessToken(cId)}` };

      const outEmail = uniqueEmail('tf-outsider');
      const outId = await createVerifiedUser(outEmail, 'OutsiderPass123#');

      // Create team
      const createRes = await post(
        app,
        '/teams',
        { name: 'Transfer Test Team' },
        { ...oAuth, 'idempotency-key': randomUUID() },
      );
      expect(createRes.status).toBe(201);
      const tfTeamId = (await dataOf(createRes)).id as string;

      // Add colleague as staff
      const inviteRes = await post(app, `/teams/${tfTeamId}/invites`, { email: cEmail, role: 'staff' }, oAuth);
      expect(inviteRes.status).toBe(200);
      const mail = await waitForMail(cEmail);
      const token = inviteTokenFromMail(mail);
      const acceptRes = await post(app, '/invites/accept', { token }, cAuth);
      expect(acceptRes.status).toBe(200);
      const acceptData = await dataOf(acceptRes);
      expect(acceptData.role).toBe('staff');

      // 1. Staff tries to transfer -> 403
      const staffTransferRes = await post(app, `/teams/${tfTeamId}/transfer`, { targetUserId: oId }, cAuth);
      expect(staffTransferRes.status).toBe(403);

      // 2. Self-transfer -> 422
      const selfTransferRes = await post(app, `/teams/${tfTeamId}/transfer`, { targetUserId: oId }, oAuth);
      expect(selfTransferRes.status).toBe(422);
      const selfErr = await errorOf(selfTransferRes);
      expect(selfErr.code).toBe('team.transferTargetInvalid');

      // 3. Transfer to non-member outsider -> 422
      const outsiderTransferRes = await post(app, `/teams/${tfTeamId}/transfer`, { targetUserId: outId }, oAuth);
      expect(outsiderTransferRes.status).toBe(422);
      const outsiderErr = await errorOf(outsiderTransferRes);
      expect(outsiderErr.code).toBe('team.transferTargetInvalid');

      // 4. Successful transfer to colleague
      const transferRes = await post(app, `/teams/${tfTeamId}/transfer`, { targetUserId: cId }, oAuth);
      expect(transferRes.status).toBe(200);
      const transferData = await dataOf(transferRes);
      expect(transferData.success).toBe(true);
      expect(transferData.teamId).toBe(tfTeamId);
      expect(transferData.newOwnerId).toBe(cId);

      // 5. Verify roles swapped: colleague is owner, original owner is manager
      const membersRes = await get(app, `/teams/${tfTeamId}/members`, cAuth);
      expect(membersRes.status).toBe(200);
      const membersData = await dataOf(membersRes);
      const members = membersData.members as { userId: string; role: string }[];
      const formerOwnerMem = members.find((m) => m.userId === oId);
      const newOwnerMem = members.find((m) => m.userId === cId);
      expect(formerOwnerMem?.role).toBe('manager');
      expect(newOwnerMem?.role).toBe('owner');

      // 6. Verify createdBy still points to original founder (owner)
      const teamRes = await get(app, `/teams/${tfTeamId}`, cAuth);
      expect(teamRes.status).toBe(200);
      const teamData = await dataOf(teamRes);
      const createdBy = teamData.createdBy as { userId: string; displayName: string } | null;
      expect(createdBy?.userId).toBe(oId);

      // 7. Verify directly in the DB: old Admin is manager, colleague is owner, exactly one active owner exists
      const shard = forTeam(tfTeamId);
      const dbMembers = await shard.memberships.findMany({
        where: { team_id: tfTeamId, removed_at: null },
      });
      const dbOldAdmin = dbMembers.find((m) => m.user_id === oId);
      const dbNewOwner = dbMembers.find((m) => m.user_id === cId);
      expect(dbOldAdmin?.role).toBe('manager');
      expect(dbNewOwner?.role).toBe('owner');
      const activeOwners = dbMembers.filter((m) => m.role === 'owner');
      expect(activeOwners.length).toBe(1);
    });
  });
});
