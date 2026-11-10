// Phase 3 / Phase C: Team transfer roundtrip verification (ADR 0018, ADR 0019; rules S6, S7, S8, V8, S9).
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
  app = testApp('teams-transfer-roundtrip');
});

afterAll(async () => {
  await shutdownAuthTest(worker);
});

describe('Phase C: Team transfer round-trip verification', () => {
  it('executes full round trip A -> B -> A -> B -> A with activity, seats, shifts and swaps', async () => {
    // -------------------------------------------------------------------------------------------
    // Step 0: Setup User A and User B
    // -------------------------------------------------------------------------------------------
    const aEmail = uniqueEmail('rt-owner-a');
    const aId = await createVerifiedUser(aEmail, 'PassOwnerA123#');
    const aAuth = { authorization: `Bearer ${await signAccessToken(aId)}` };

    const bEmail = uniqueEmail('rt-colleague-b');
    const bId = await createVerifiedUser(bEmail, 'PassColleagueB123#');
    const bAuth = { authorization: `Bearer ${await signAccessToken(bId)}` };

    // User A creates the team
    const teamName = 'Roundtrip Team';
    const createRes = await post(
      app,
      '/teams',
      { name: teamName },
      { ...aAuth, 'idempotency-key': randomUUID() },
    );
    expect(createRes.status).toBe(201);
    const teamId = (await dataOf(createRes)).id as string;
    const shard = forTeam(teamId);

    // User A invites User B as staff
    const inviteRes = await post(
      app,
      `/teams/${teamId}/invites`,
      { email: bEmail, role: 'staff' },
      aAuth,
    );
    expect(inviteRes.status).toBe(200);

    const bMail = await waitForMail(bEmail);
    const bToken = inviteTokenFromMail(bMail);

    const acceptRes = await post(app, '/invites/accept', { token: bToken }, bAuth);
    expect(acceptRes.status).toBe(200);
    const acceptData = await dataOf(acceptRes);
    expect(acceptData.role).toBe('staff');

    // Helper to query active non-owner count directly from memberships
    async function getActiveNonOwnerSeatCount(): Promise<number> {
      const res = await shard.$queryRaw<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM memberships
        WHERE team_id = ${teamId}::uuid AND role != 'owner' AND removed_at IS NULL
      `;
      return res[0]?.count ?? 0;
    }

    // Helper to verify exactly one active owner
    async function assertExactlyOneActiveOwner(): Promise<void> {
      const activeOwners = await shard.memberships.findMany({
        where: { team_id: teamId, role: 'owner', removed_at: null },
      });
      expect(activeOwners.length).toBe(1);
    }

    // -------------------------------------------------------------------------------------------
    // Step 1: Hop 1 (A -> B transfer)
    // -------------------------------------------------------------------------------------------
    const hop1Res = await post(app, `/teams/${teamId}/transfer`, { targetUserId: bId }, aAuth);
    expect(hop1Res.status).toBe(200);
    const hop1Data = await dataOf(hop1Res);
    expect(hop1Data.success).toBe(true);
    expect(hop1Data.newOwnerId).toBe(bId);

    // Assert in DB
    const mems1 = await shard.memberships.findMany({
      where: { team_id: teamId, removed_at: null },
    });
    const memA1 = mems1.find((m) => m.user_id === aId);
    const memB1 = mems1.find((m) => m.user_id === bId);
    expect(memA1?.role).toBe('manager');
    expect(memB1?.role).toBe('owner');
    await assertExactlyOneActiveOwner();

    // Assert created_by in teams remains User A
    const teamDb1 = await shard.teams.findUnique({ where: { id: teamId } });
    expect(teamDb1?.created_by).toBe(aId);

    // A's transfer and delete attempts must return 403 team.forbidden
    const aTransferRes1 = await post(app, `/teams/${teamId}/transfer`, { targetUserId: bId }, aAuth);
    expect(aTransferRes1.status).toBe(403);
    const aTransferErr1 = await errorOf(aTransferRes1);
    expect(aTransferErr1.code).toBe('team.forbidden');

    const aDeleteRes1 = await post(app, `/teams/${teamId}/delete`, { confirmName: teamName }, aAuth);
    expect(aDeleteRes1.status).toBe(403);
    const aDeleteErr1 = await errorOf(aDeleteRes1);
    expect(aDeleteErr1.code).toBe('team.forbidden');

    // B's delete check passes: wrong name returns 422 team.nameMismatch (permission allowed)
    const bDeleteCheck1 = await post(app, `/teams/${teamId}/delete`, { confirmName: 'Mismatch Name' }, bAuth);
    expect(bDeleteCheck1.status).toBe(422);
    const bDeleteErr1 = await errorOf(bDeleteCheck1);
    expect(bDeleteErr1.code).toBe('team.nameMismatch');

    // GET /teams matches
    const aTeamsRes1 = await get(app, '/teams', aAuth);
    expect(aTeamsRes1.status).toBe(200);
    const aTeamsData1 = (await dataOf(aTeamsRes1)).teams as { id: string; role: string }[];
    expect(aTeamsData1.find((t) => t.id === teamId)?.role).toBe('manager');

    const bTeamsRes1 = await get(app, '/teams', bAuth);
    expect(bTeamsRes1.status).toBe(200);
    const bTeamsData1 = (await dataOf(bTeamsRes1)).teams as { id: string; role: string }[];
    expect(bTeamsData1.find((t) => t.id === teamId)?.role).toBe('owner');

    // GET /teams/:teamId/members matches for both
    const membersRes1 = await get(app, `/teams/${teamId}/members`, bAuth);
    expect(membersRes1.status).toBe(200);
    const membersData1 = (await dataOf(membersRes1)).members as { userId: string; role: string }[];
    expect(membersData1.find((m) => m.userId === aId)?.role).toBe('manager');
    expect(membersData1.find((m) => m.userId === bId)?.role).toBe('owner');

    // GET /teams/:teamId/invites returns 200 for both (both are managers/owners)
    const aInvitesRes1 = await get(app, `/teams/${teamId}/invites`, aAuth);
    expect(aInvitesRes1.status).toBe(200);
    const bInvitesRes1 = await get(app, `/teams/${teamId}/invites`, bAuth);
    expect(bInvitesRes1.status).toBe(200);

    // Seat count after Hop 1
    const seatsHop1 = await getActiveNonOwnerSeatCount();
    expect(seatsHop1).toBe(1);

    // -------------------------------------------------------------------------------------------
    // Step 2: Hop 2 (B -> A transfer back)
    // -------------------------------------------------------------------------------------------
    const hop2Res = await post(app, `/teams/${teamId}/transfer`, { targetUserId: aId }, bAuth);
    expect(hop2Res.status).toBe(200);
    const hop2Data = await dataOf(hop2Res);
    expect(hop2Data.success).toBe(true);
    expect(hop2Data.newOwnerId).toBe(aId);

    // Assert in DB: roles swapped back
    const mems2 = await shard.memberships.findMany({
      where: { team_id: teamId, removed_at: null },
    });
    const memA2 = mems2.find((m) => m.user_id === aId);
    const memB2 = mems2.find((m) => m.user_id === bId);
    expect(memA2?.role).toBe('owner');
    expect(memB2?.role).toBe('manager');
    await assertExactlyOneActiveOwner();

    // Assert created_by remains User A
    const teamDb2 = await shard.teams.findUnique({ where: { id: teamId } });
    expect(teamDb2?.created_by).toBe(aId);

    // B's transfer and delete attempts now return 403 team.forbidden
    const bTransferRes2 = await post(app, `/teams/${teamId}/transfer`, { targetUserId: aId }, bAuth);
    expect(bTransferRes2.status).toBe(403);
    const bTransferErr2 = await errorOf(bTransferRes2);
    expect(bTransferErr2.code).toBe('team.forbidden');

    const bDeleteRes2 = await post(app, `/teams/${teamId}/delete`, { confirmName: teamName }, bAuth);
    expect(bDeleteRes2.status).toBe(403);
    const bDeleteErr2 = await errorOf(bDeleteRes2);
    expect(bDeleteErr2.code).toBe('team.forbidden');

    // GET /teams matches
    const aTeamsRes2 = await get(app, '/teams', aAuth);
    expect(aTeamsRes2.status).toBe(200);
    const aTeamsData2 = (await dataOf(aTeamsRes2)).teams as { id: string; role: string }[];
    expect(aTeamsData2.find((t) => t.id === teamId)?.role).toBe('owner');

    const bTeamsRes2 = await get(app, '/teams', bAuth);
    expect(bTeamsRes2.status).toBe(200);
    const bTeamsData2 = (await dataOf(bTeamsRes2)).teams as { id: string; role: string }[];
    expect(bTeamsData2.find((t) => t.id === teamId)?.role).toBe('manager');

    // Seat count after Hop 2
    const seatsHop2 = await getActiveNonOwnerSeatCount();
    expect(seatsHop2).toBe(1);

    // -------------------------------------------------------------------------------------------
    // Step 3: Second round (Hop 3: A -> B, Hop 4: B -> A)
    // -------------------------------------------------------------------------------------------
    // Hop 3 (A -> B)
    const hop3Res = await post(app, `/teams/${teamId}/transfer`, { targetUserId: bId }, aAuth);
    expect(hop3Res.status).toBe(200);
    await assertExactlyOneActiveOwner();
    const mems3 = await shard.memberships.findMany({ where: { team_id: teamId, removed_at: null } });
    expect(mems3.find((m) => m.user_id === aId)?.role).toBe('manager');
    expect(mems3.find((m) => m.user_id === bId)?.role).toBe('owner');

    const seatsHop3 = await getActiveNonOwnerSeatCount();
    expect(seatsHop3).toBe(1);

    // Hop 4 (B -> A)
    const hop4Res = await post(app, `/teams/${teamId}/transfer`, { targetUserId: aId }, bAuth);
    expect(hop4Res.status).toBe(200);
    await assertExactlyOneActiveOwner();
    const mems4 = await shard.memberships.findMany({ where: { team_id: teamId, removed_at: null } });
    expect(mems4.find((m) => m.user_id === aId)?.role).toBe('owner');
    expect(mems4.find((m) => m.user_id === bId)?.role).toBe('manager');

    const seatsHop4 = await getActiveNonOwnerSeatCount();
    expect(seatsHop4).toBe(1);

    // -------------------------------------------------------------------------------------------
    // Step 4: Activity events verification
    // -------------------------------------------------------------------------------------------
    const events = await shard.activity_events.findMany({
      where: { team_id: teamId, kind: 'team.transferred' },
      orderBy: { created_at: 'asc' },
    });

    expect(events.length).toBe(4);

    const expectedHops = [
      { actor: aId, target: bId, prev: aId, next: bId },
      { actor: bId, target: aId, prev: bId, next: aId },
      { actor: aId, target: bId, prev: aId, next: bId },
      { actor: bId, target: aId, prev: bId, next: aId },
    ];

    for (let i = 0; i < 4; i++) {
      const ev = events[i]!;
      const exp = expectedHops[i]!;
      expect(ev.actor_user_id).toBe(exp.actor);
      expect(ev.subject_id).toBe(exp.target);
      expect(ev.audience).toBe('managers');

      const data = ev.data as Record<string, unknown>;
      expect(data.previousOwnerId).toBe(exp.prev);
      expect(data.newOwnerId).toBe(exp.next);

      // Rule V8, S9: no names, emails or display names in activity_events.data
      expect(data).not.toHaveProperty('email');
      expect(data).not.toHaveProperty('name');
      expect(data).not.toHaveProperty('displayName');
    }

    // -------------------------------------------------------------------------------------------
    // Step 5: Seats verification
    // -------------------------------------------------------------------------------------------
    // Across all 4 hops, seat count remained exactly 1 (1 non-owner member), well under Starter 5 cap
    expect([seatsHop1, seatsHop2, seatsHop3, seatsHop4]).toEqual([1, 1, 1, 1]);

    // -------------------------------------------------------------------------------------------
    // Step 6: Shifts & Swaps lifecycle after round trip
    // -------------------------------------------------------------------------------------------
    // User C (staff) is invited and joins
    const cEmail = uniqueEmail('rt-staff-c');
    const cId = await createVerifiedUser(cEmail, 'PassStaffC123#');
    const cAuth = { authorization: `Bearer ${await signAccessToken(cId)}` };

    const cInviteRes = await post(app, `/teams/${teamId}/invites`, { email: cEmail, role: 'staff' }, aAuth);
    expect(cInviteRes.status).toBe(200);

    const cMail = await waitForMail(cEmail);
    const cToken = inviteTokenFromMail(cMail);

    const cAcceptRes = await post(app, '/invites/accept', { token: cToken }, cAuth);
    expect(cAcceptRes.status).toBe(200);

    // Current Admin (A) creates a shift assigned to C
    const startsAt = new Date(Date.now() + 48 * 60 * 60 * 1_000);
    const endsAt = new Date(startsAt.getTime() + 8 * 60 * 60 * 1_000);
    const shiftRes = await post(
      app,
      `/teams/${teamId}/shifts`,
      {
        assignedUserId: cId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        label: 'Post-Roundtrip Shift',
        notes: 'Testing shift and swap permissions',
      },
      { ...aAuth, 'idempotency-key': randomUUID() },
    );
    expect(shiftRes.status).toBe(201);
    const shiftId = (await dataOf(shiftRes)).id as string;

    // Staff C requests a swap with target User B (the manager)
    const swapRes = await post(
      app,
      `/teams/${teamId}/swaps`,
      { shiftId, targetUserId: bId },
      { ...cAuth, 'idempotency-key': randomUUID() },
    );
    expect(swapRes.status).toBe(201);
    const swapId = (await dataOf(swapRes)).id as string;

    // Staff C attempts to decide/approve swap -> 403 team.forbidden
    const staffDecideRes = await post(
      app,
      `/teams/${teamId}/swaps/${swapId}/decide`,
      { status: 'approved' },
      cAuth,
    );
    expect(staffDecideRes.status).toBe(403);
    const staffDecideErr = await errorOf(staffDecideRes);
    expect(staffDecideErr.code).toBe('team.forbidden');

    // Manager B (formerly owner, now manager) approves swap -> 200 approved
    const mgrDecideRes = await post(
      app,
      `/teams/${teamId}/swaps/${swapId}/decide`,
      { status: 'approved' },
      bAuth,
    );
    expect(mgrDecideRes.status).toBe(200);
    const mgrDecideData = await dataOf(mgrDecideRes);
    expect(mgrDecideData.status).toBe('approved');
    expect(mgrDecideData.decidedBy).toBe(bId);

    // Verify shift was reassigned to User B
    const updatedShift = await shard.shifts.findUnique({ where: { id: shiftId } });
    expect(updatedShift?.assigned_user_id).toBe(bId);

    // -------------------------------------------------------------------------------------------
    // Step 7: Database schema audit across tables
    // -------------------------------------------------------------------------------------------
    // 1. teams.created_by remains original founder (A), never mutated by transfer
    const finalTeam = await shard.teams.findUnique({ where: { id: teamId } });
    expect(finalTeam?.created_by).toBe(aId);

    // 2. user_team_index: records membership index without any role column
    const global = globalDb();
    const indexRows = await global.user_team_index.findMany({
      where: { team_id: teamId },
    });
    expect(indexRows.length).toBe(3); // A, B, C
    for (const row of indexRows) {
      expect(row.user_id).toBeDefined();
      expect(row.team_id).toBe(teamId);
      expect((row as Record<string, unknown>).role).toBeUndefined();
    }

    // 3. subscriptions: scoped by team_id; no owner column exists
    const subColumns = await shard.$queryRaw<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'subscriptions'
    `;
    const subColNames = subColumns.map((c) => c.column_name);
    expect(subColNames).toContain('team_id');
    expect(subColNames).not.toContain('owner_id');
    expect(subColNames).not.toContain('user_id');

    // 4. ledger_entries: scoped by team_id; no owner column exists
    const ledgerColumns = await shard.$queryRaw<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'ledger_entries'
    `;
    const ledgerColNames = ledgerColumns.map((c) => c.column_name);
    expect(ledgerColNames).toContain('team_id');
    expect(ledgerColNames).not.toContain('owner_id');
    expect(ledgerColNames).not.toContain('user_id');
  });
});

