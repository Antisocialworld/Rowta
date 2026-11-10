// Phase 3 / Phase C: Team restore integration tests (PRD 4, 8.10; rules S6, S7, S8, S14, C3, V1).
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
  app = testApp('teams-restore');
});

afterAll(async () => {
  await shutdownAuthTest(worker);
});

describe('Team restore lifecycle and access control', () => {
  it('restores soft-deleted team, bringing back members, index rows, and activity', async () => {
    const aEmail = uniqueEmail('rst-owner-a');
    const aId = await createVerifiedUser(aEmail, 'PassOwnerA123#');
    const aAuth = { authorization: `Bearer ${await signAccessToken(aId)}` };

    const bEmail = uniqueEmail('rst-staff-b');
    const bId = await createVerifiedUser(bEmail, 'PassStaffB123#');
    const bAuth = { authorization: `Bearer ${await signAccessToken(bId)}` };

    // 1. Create team
    const teamName = 'Alpha Restore Team';
    const createRes = await post(
      app,
      '/teams',
      { name: teamName },
      { ...aAuth, 'idempotency-key': randomUUID() },
    );
    expect(createRes.status).toBe(201);
    const teamId = (await dataOf(createRes)).id as string;
    const shard = forTeam(teamId);

    // 2. Add colleague as staff
    const inviteRes = await post(app, `/teams/${teamId}/invites`, { email: bEmail, role: 'staff' }, aAuth);
    expect(inviteRes.status).toBe(200);
    const mail = await waitForMail(bEmail);
    const token = inviteTokenFromMail(mail);
    const acceptRes = await post(app, '/invites/accept', { token }, bAuth);
    expect(acceptRes.status).toBe(200);

    // Both A and B have user_team_index rows
    const db0 = globalDb();
    const initialIndex = await db0.user_team_index.findMany({ where: { team_id: teamId } });
    expect(initialIndex.length).toBe(2);

    // 3. Admin A deletes the team
    const deleteRes = await post(app, `/teams/${teamId}/delete`, { confirmName: teamName }, aAuth);
    expect(deleteRes.status).toBe(200);

    // Assert absent from GET /teams for both A and B
    const aTeamsAfterDel = await get(app, '/teams', aAuth);
    const aTeamsData = (await dataOf(aTeamsAfterDel)).teams as { id: string }[];
    expect(aTeamsData.some((t) => t.id === teamId)).toBe(false);

    const bTeamsAfterDel = await get(app, '/teams', bAuth);
    const bTeamsData = (await dataOf(bTeamsAfterDel)).teams as { id: string }[];
    expect(bTeamsData.some((t) => t.id === teamId)).toBe(false);

    // Assert present in GET /teams/deleted for Admin A
    const deletedRes = await get(app, '/teams/deleted', aAuth);
    expect(deletedRes.status).toBe(200);
    const deletedData = await dataOf(deletedRes);
    const deletedTeams = deletedData.teams as { id: string; name: string; deletedAt: string; restoreUntil: string }[];
    const entry = deletedTeams.find((t) => t.id === teamId);
    expect(entry).toBeDefined();
    expect(entry?.name).toBe(teamName);
    expect(new Date(entry!.restoreUntil).getTime()).toBeGreaterThan(new Date(entry!.deletedAt).getTime());

    // Assert user_team_index rows were removed
    const deletedIndex = await db0.user_team_index.findMany({ where: { team_id: teamId } });
    expect(deletedIndex.length).toBe(0);

    // 4. Admin A restores the team
    const restoreRes = await post(app, `/teams/${teamId}/restore`, {}, aAuth);
    expect(restoreRes.status).toBe(200);
    const restoreData = await dataOf(restoreRes);
    expect(restoreData.success).toBe(true);
    expect(restoreData.teamId).toBe(teamId);

    // Assert absent from GET /teams/deleted
    const deletedResAfter = await get(app, '/teams/deleted', aAuth);
    const deletedAfterData = (await dataOf(deletedResAfter)).teams as { id: string }[];
    expect(deletedAfterData.some((t) => t.id === teamId)).toBe(false);

    // Assert present in GET /teams for both A and B
    const aTeamsRestored = await get(app, '/teams', aAuth);
    const aRestoredList = (await dataOf(aTeamsRestored)).teams as { id: string; role: string }[];
    const aRestoredTeam = aRestoredList.find((t) => t.id === teamId);
    expect(aRestoredTeam?.role).toBe('owner');

    const bTeamsRestored = await get(app, '/teams', bAuth);
    const bRestoredList = (await dataOf(bTeamsRestored)).teams as { id: string; role: string }[];
    const bRestoredTeam = bRestoredList.find((t) => t.id === teamId);
    expect(bRestoredTeam?.role).toBe('staff');

    // Assert user_team_index rows rebuilt for both A and B
    const restoredIndex = await db0.user_team_index.findMany({ where: { team_id: teamId } });
    expect(restoredIndex.length).toBe(2);

    // Assert activity row team.restored recorded
    const events = await shard.activity_events.findMany({
      where: { team_id: teamId, kind: 'team.restored' },
    });
    expect(events.length).toBe(1);
    expect(events[0]?.actor_user_id).toBe(aId);
    expect(events[0]?.audience).toBe('managers');
    const evData = events[0]?.data as Record<string, unknown>;
    expect(evData.restoredBy).toBe(aId);
    expect(evData.restoredMemberCount).toBe(2);
    expect(evData).not.toHaveProperty('email');
    expect(evData).not.toHaveProperty('name');
  });

  it('rejects restore from Manager, Staff, or a different Admin with 404 (no existence leak)', async () => {
    const oEmail = uniqueEmail('rst-owner-leak');
    const oId = await createVerifiedUser(oEmail, 'PassOwnerLeak123#');
    const oAuth = { authorization: `Bearer ${await signAccessToken(oId)}` };

    const mEmail = uniqueEmail('rst-mgr-leak');
    const mId = await createVerifiedUser(mEmail, 'PassMgrLeak123#');
    const mAuth = { authorization: `Bearer ${await signAccessToken(mId)}` };

    const sEmail = uniqueEmail('rst-stf-leak');
    const sId = await createVerifiedUser(sEmail, 'PassStfLeak123#');
    const sAuth = { authorization: `Bearer ${await signAccessToken(sId)}` };

    const otherEmail = uniqueEmail('rst-other-leak');
    const otherId = await createVerifiedUser(otherEmail, 'PassOtherLeak123#');
    const otherAuth = { authorization: `Bearer ${await signAccessToken(otherId)}` };

    // Create team
    const teamName = 'Leak Test Team';
    const createRes = await post(app, '/teams', { name: teamName }, { ...oAuth, 'idempotency-key': randomUUID() });
    const teamId = (await dataOf(createRes)).id as string;

    // Add manager
    const mInv = await post(app, `/teams/${teamId}/invites`, { email: mEmail, role: 'manager' }, oAuth);
    expect(mInv.status).toBe(200);
    const mMail = await waitForMail(mEmail);
    const mToken = inviteTokenFromMail(mMail);
    await post(app, '/invites/accept', { token: mToken }, mAuth);

    // Add staff
    const sInv = await post(app, `/teams/${teamId}/invites`, { email: sEmail, role: 'staff' }, oAuth);
    expect(sInv.status).toBe(200);
    const sMail = await waitForMail(sEmail);
    const sToken = inviteTokenFromMail(sMail);
    await post(app, '/invites/accept', { token: sToken }, sAuth);

    // Delete team
    await post(app, `/teams/${teamId}/delete`, { confirmName: teamName }, oAuth);

    // 1. Staff gets 404
    const staffRes = await post(app, `/teams/${teamId}/restore`, {}, sAuth);
    expect(staffRes.status).toBe(404);
    const staffErr = await errorOf(staffRes);
    expect(staffErr.code).toBe('team.notFound');

    // 2. Manager gets 404
    const mgrRes = await post(app, `/teams/${teamId}/restore`, {}, mAuth);
    expect(mgrRes.status).toBe(404);
    const mgrErr = await errorOf(mgrRes);
    expect(mgrErr.code).toBe('team.notFound');

    // 3. Different Admin gets 404
    const otherRes = await post(app, `/teams/${teamId}/restore`, {}, otherAuth);
    expect(otherRes.status).toBe(404);
    const otherErr = await errorOf(otherRes);
    expect(otherErr.code).toBe('team.notFound');

    // 4. Other Admin deleted list does not show this team
    const otherListRes = await get(app, '/teams/deleted', otherAuth);
    const otherListData = (await dataOf(otherListRes)).teams as { id: string }[];
    expect(otherListData.some((t) => t.id === teamId)).toBe(false);
  });

  it('rejects restore with 410 team.restoreExpired when past the 30-day window', async () => {
    const oEmail = uniqueEmail('rst-expired');
    const oId = await createVerifiedUser(oEmail, 'PassExpired123#');
    const oAuth = { authorization: `Bearer ${await signAccessToken(oId)}` };

    const teamName = 'Expired Team';
    const createRes = await post(app, '/teams', { name: teamName }, { ...oAuth, 'idempotency-key': randomUUID() });
    const teamId = (await dataOf(createRes)).id as string;
    const shard = forTeam(teamId);

    // Delete team
    await post(app, `/teams/${teamId}/delete`, { confirmName: teamName }, oAuth);

    // Manually push deleted_at back 31 days
    const pastDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000);
    await shard.teams.update({
      where: { id: teamId },
      data: { deleted_at: pastDate },
    });

    // Attempt restore -> 410 team.restoreExpired
    const res = await post(app, `/teams/${teamId}/restore`, {}, oAuth);
    expect(res.status).toBe(410);
    const err = await errorOf(res);
    expect(err.code).toBe('team.restoreExpired');
  });

  it('returns 404 on retry after success (team is already active)', async () => {
    const oEmail = uniqueEmail('rst-retry');
    const oId = await createVerifiedUser(oEmail, 'PassRetry123#');
    const oAuth = { authorization: `Bearer ${await signAccessToken(oId)}` };

    const teamName = 'Retry Team';
    const createRes = await post(app, '/teams', { name: teamName }, { ...oAuth, 'idempotency-key': randomUUID() });
    const teamId = (await dataOf(createRes)).id as string;

    // Delete team
    await post(app, `/teams/${teamId}/delete`, { confirmName: teamName }, oAuth);

    // First restore succeeds
    const res1 = await post(app, `/teams/${teamId}/restore`, {}, oAuth);
    expect(res1.status).toBe(200);

    // Second restore (retry) gets 404
    const res2 = await post(app, `/teams/${teamId}/restore`, {}, oAuth);
    expect(res2.status).toBe(404);
    const err = await errorOf(res2);
    expect(err.code).toBe('team.notFound');
  });

  it('completes the full cycle: create, delete, restore, transfer', async () => {
    const aEmail = uniqueEmail('rst-cycle-a');
    const aId = await createVerifiedUser(aEmail, 'PassCycleA123#');
    const aAuth = { authorization: `Bearer ${await signAccessToken(aId)}` };

    const bEmail = uniqueEmail('rst-cycle-b');
    const bId = await createVerifiedUser(bEmail, 'PassCycleB123#');
    const bAuth = { authorization: `Bearer ${await signAccessToken(bId)}` };

    // 1. Create
    const teamName = 'Full Cycle Team';
    const createRes = await post(app, '/teams', { name: teamName }, { ...aAuth, 'idempotency-key': randomUUID() });
    const teamId = (await dataOf(createRes)).id as string;
    const shard = forTeam(teamId);

    // 2. Add colleague as staff
    await post(app, `/teams/${teamId}/invites`, { email: bEmail, role: 'staff' }, aAuth);
    const mail = await waitForMail(bEmail);
    const token = inviteTokenFromMail(mail);
    await post(app, '/invites/accept', { token }, bAuth);

    // 3. Delete
    const delRes = await post(app, `/teams/${teamId}/delete`, { confirmName: teamName }, aAuth);
    expect(delRes.status).toBe(200);

    // 4. Restore
    const rstRes = await post(app, `/teams/${teamId}/restore`, {}, aAuth);
    expect(rstRes.status).toBe(200);

    // 5. Transfer to B
    const tfRes = await post(app, `/teams/${teamId}/transfer`, { targetUserId: bId }, aAuth);
    expect(tfRes.status).toBe(200);
    const tfData = await dataOf(tfRes);
    expect(tfData.newOwnerId).toBe(bId);

    // 6. Assert swapped roles in DB
    const dbMembers = await shard.memberships.findMany({
      where: { team_id: teamId, removed_at: null },
    });
    const aMem = dbMembers.find((m) => m.user_id === aId);
    const bMem = dbMembers.find((m) => m.user_id === bId);
    expect(aMem?.role).toBe('manager');
    expect(bMem?.role).toBe('owner');
    expect(dbMembers.filter((m) => m.role === 'owner').length).toBe(1);
  });

  it('refuses invite acceptance for a deleted team with uniform link failure, and accepts fresh invite after restore', async () => {
    const oEmail = uniqueEmail('rst-inv-owner');
    const oId = await createVerifiedUser(oEmail, 'PassOwnerInv123#');
    const oAuth = { authorization: `Bearer ${await signAccessToken(oId)}` };

    const sEmail = uniqueEmail('rst-inv-staff');
    const sId = await createVerifiedUser(sEmail, 'PassStaffInv123#');
    const sAuth = { authorization: `Bearer ${await signAccessToken(sId)}` };

    // 1. Create team
    const teamName = 'Invite Deleted Test Team';
    const createRes = await post(app, '/teams', { name: teamName }, { ...oAuth, 'idempotency-key': randomUUID() });
    const teamId = (await dataOf(createRes)).id as string;

    // 2. Invite staff member
    const invRes1 = await post(app, `/teams/${teamId}/invites`, { email: sEmail, role: 'staff' }, oAuth);
    expect(invRes1.status).toBe(200);
    const mail1 = await waitForMail(sEmail);
    const token1 = inviteTokenFromMail(mail1);

    // 3. Delete team
    const delRes = await post(app, `/teams/${teamId}/delete`, { confirmName: teamName }, oAuth);
    expect(delRes.status).toBe(200);

    // 4. Accept invite while team is deleted -> 400 auth.link.invalid (uniform failure, no leak that team exists)
    const acceptDeletedRes = await post(app, '/invites/accept', { token: token1 }, sAuth);
    expect(acceptDeletedRes.status).toBe(400);
    const err = await errorOf(acceptDeletedRes);
    expect(err.code).toBe('auth.link.invalid');

    // 5. Restore the team
    const rstRes = await post(app, `/teams/${teamId}/restore`, {}, oAuth);
    expect(rstRes.status).toBe(200);

    // 6. Fresh invite after restore
    await mailCaptureClear();
    const invRes2 = await post(app, `/teams/${teamId}/invites`, { email: sEmail, role: 'staff' }, oAuth);
    expect(invRes2.status).toBe(200);
    const mail2 = await waitForMail(sEmail);
    const token2 = inviteTokenFromMail(mail2);

    // 7. Accept fresh invite -> 200 success
    const acceptRestoredRes = await post(app, '/invites/accept', { token: token2 }, sAuth);
    expect(acceptRestoredRes.status).toBe(200);
    const acceptData = await dataOf(acceptRestoredRes);
    expect(acceptData.teamId).toBe(teamId);
    expect(acceptData.role).toBe('staff');
  });
});

