// Activity feed audience enforcement (Phase 1; rules S7, V1).
// Inserts activity_events rows directly and reads them back through the real HTTP
// activity endpoint as each role.
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { forTeam } from '../src/db/clients.ts';
import { signAccessToken } from '../src/security/access-token.ts';
import {
  clearRateKeys,
  createVerifiedUser,
  dataOf,
  ensureTestCountries,
  post,
  shutdownAuthTest,
  testApp,
  uniqueEmail,
} from './helpers/auth-test.ts';

let app: Hono;

async function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return app.request(path, { method: 'GET', headers });
}

interface Fixture {
  ownerId: string;
  managerId: string;
  staffId: string;
  ownerAuth: { authorization: string };
  managerAuth: { authorization: string };
  staffAuth: { authorization: string };
  teamId: string;
}

async function createTeamFor(ownerAuth: { authorization: string }, name: string): Promise<string> {
  const res = await post(app, '/teams', { name }, { ...ownerAuth, 'idempotency-key': randomUUID() });
  expect(res.status).toBe(201);
  return (await dataOf(res)).id as string;
}

async function addMember(teamId: string, userId: string, role: 'manager' | 'staff'): Promise<void> {
  await forTeam(teamId).memberships.create({ data: { team_id: teamId, user_id: userId, role } });
}

async function insertEvent(
  teamId: string,
  kind: string,
  audience: string,
  actor: string | null,
  label?: string,
): Promise<void> {
  await forTeam(teamId).activity_events.create({
    data: {
      team_id: teamId,
      kind,
      actor_user_id: actor,
      subject_id: randomUUID(),
      data: label ? { label } : {},
      audience,
    },
  });
}

describe('Activity feed audience enforcement', () => {
  let f: Fixture;

  beforeAll(async () => {
    await clearRateKeys();
    await ensureTestCountries();
    app = testApp('activity-audience');

    const ownerId = await createVerifiedUser(uniqueEmail('aa-owner'), 'OwnerPass123#');
    const managerId = await createVerifiedUser(uniqueEmail('aa-manager'), 'ManagerPass123#');
    const staffId = await createVerifiedUser(uniqueEmail('aa-staff'), 'StaffPass123#');

    const ownerAuth = { authorization: `Bearer ${await signAccessToken(ownerId)}` };
    const managerAuth = { authorization: `Bearer ${await signAccessToken(managerId)}` };
    const staffAuth = { authorization: `Bearer ${await signAccessToken(staffId)}` };

    const teamId = await createTeamFor(ownerAuth, 'Audience Test Team');
    await addMember(teamId, managerId, 'manager');
    await addMember(teamId, staffId, 'staff');

    f = { ownerId, managerId, staffId, ownerAuth, managerAuth, staffAuth, teamId };
  });

  afterAll(async () => {
    await shutdownAuthTest();
  });

  it('staff does not receive a managers event', async () => {
    await insertEvent(f.teamId, 'team.transferred', 'managers', f.ownerId, 'Transfer');
    const res = await get(`/teams/${f.teamId}/activity`, f.staffAuth);
    expect(res.status).toBe(200);
    const events = (await dataOf(res)).events as { kind: string }[];
    expect(events.some((e) => e.kind === 'team.transferred')).toBe(false);
  });

  it('staff does not receive an involved event caused by someone else', async () => {
    await insertEvent(f.teamId, 'shift.created', 'involved', f.ownerId, 'Not mine');
    const res = await get(`/teams/${f.teamId}/activity`, f.staffAuth);
    expect(res.status).toBe(200);
    const events = (await dataOf(res)).events as { kind: string; data?: { label?: string } }[];
    expect(
      events.some((e) => e.kind === 'shift.created' && e.data?.label === 'Not mine'),
    ).toBe(false);
  });

  it('staff receives an involved event they caused', async () => {
    await insertEvent(f.teamId, 'shift.created', 'involved', f.staffId, 'Mine');
    const res = await get(`/teams/${f.teamId}/activity`, f.staffAuth);
    expect(res.status).toBe(200);
    const events = (await dataOf(res)).events as { kind: string; data?: { label?: string } }[];
    expect(events.some((e) => e.kind === 'shift.created' && e.data?.label === 'Mine')).toBe(true);
  });

  it('staff receives team events', async () => {
    await insertEvent(f.teamId, 'shift.created', 'team', f.ownerId, 'Team event');
    const res = await get(`/teams/${f.teamId}/activity`, f.staffAuth);
    expect(res.status).toBe(200);
    const events = (await dataOf(res)).events as { kind: string; data?: { label?: string } }[];
    expect(events.some((e) => e.kind === 'shift.created' && e.data?.label === 'Team event')).toBe(
      true,
    );
  });

  it('manager and owner receive all three audiences', async () => {
    await insertEvent(f.teamId, 'team.transferred', 'managers', f.ownerId, 'Managers only');
    await insertEvent(f.teamId, 'shift.created', 'involved', f.staffId, 'Involved staff');
    await insertEvent(f.teamId, 'shift.deleted', 'team', f.ownerId, 'Team event');

    for (const auth of [f.ownerAuth, f.managerAuth]) {
      const res = await get(`/teams/${f.teamId}/activity`, auth);
      expect(res.status).toBe(200);
      const events = (await dataOf(res)).events as { kind: string; data?: { label?: string } }[];
      const labels = events.map((e) => e.data?.label);
      expect(labels).toContain('Managers only');
      expect(labels).toContain('Involved staff');
      expect(labels).toContain('Team event');
    }
  });

  it('staff pagination with mixed audiences and small limit', async () => {
    await insertEvent(f.teamId, 'shift.created', 'team', f.ownerId, 'team-1');
    await insertEvent(f.teamId, 'shift.created', 'managers', f.ownerId, 'managers-1');
    await insertEvent(f.teamId, 'shift.created', 'involved', f.staffId, 'involved-1');
    await insertEvent(f.teamId, 'shift.created', 'team', f.ownerId, 'team-2');
    await insertEvent(f.teamId, 'shift.created', 'involved', f.ownerId, 'involved-other');

    const seededLabels = ['team-1', 'involved-1', 'team-2'];
    const seenLabels: string[] = [];
    const seenIds: string[] = [];
    let cursor: string | null = null;
    do {
      const path = cursor === null
        ? `/teams/${f.teamId}/activity?limit=2`
        : `/teams/${f.teamId}/activity?limit=2&cursor=${encodeURIComponent(cursor)}`;
      const res = await get(path, f.staffAuth);
      expect(res.status).toBe(200);
      const body = await dataOf(res);
      const events = body.events as { id: string; data?: { label?: string } }[];
      for (const event of events) {
        seenIds.push(event.id);
        seenLabels.push(event.data?.label ?? '');
      }
      cursor = body.nextCursor as string | null;
    } while (cursor !== null);

    // No duplicate ids across pages (label uniqueness is not guaranteed across tests,
    // since test 4 and test 5 both seed an event labelled 'Team event').
    expect(new Set(seenIds).size).toBe(seenIds.length);

    // This test's seeded labels must appear exactly once each, newest first.
    // `insertEvent` does not set `created_at`, so it uses the column default `now()`
    // (server/prisma/sql/020-team.sql:111). If two inserts share the same `created_at`,
    // the query's `ORDER BY created_at DESC, id DESC` (service.ts:573) breaks ties
    // with random UUID ids, so seed order relies on distinct `created_at` values.
    const seededSeen = seenLabels.filter((label) => seededLabels.includes(label));
    expect(seededSeen).toEqual(['team-2', 'involved-1', 'team-1']);

    expect(seenLabels).toContain('team-1');
    expect(seenLabels).toContain('involved-1');
    expect(seenLabels).toContain('team-2');
    expect(seenLabels).not.toContain('managers-1');
    expect(seenLabels).not.toContain('involved-other');
  });

  it('search path applies the same audience rule', async () => {
    await insertEvent(f.teamId, 'shift.created', 'managers', f.ownerId, 'Hidden from staff');
    await insertEvent(f.teamId, 'shift.created', 'team', f.ownerId, 'Visible to staff');

    // Staff search should not surface the managers-only event
    const staffRes = await get(`/teams/${f.teamId}/search?q=Hidden`, f.staffAuth);
    expect(staffRes.status).toBe(200);
    const staffActivity = (await dataOf(staffRes)).activity as {
      kind: string;
      data?: { label?: string };
    }[];
    expect(
      staffActivity.some((e) => e.kind === 'shift.created' && e.data?.label === 'Hidden from staff'),
    ).toBe(false);

    // Staff search should surface the team event
    const staffVisible = await get(`/teams/${f.teamId}/search?q=Visible`, f.staffAuth);
    expect(staffVisible.status).toBe(200);
    const staffVisibleActivity = (await dataOf(staffVisible)).activity as {
      kind: string;
      data?: { label?: string };
    }[];
    expect(
      staffVisibleActivity.some(
        (e) => e.kind === 'shift.created' && e.data?.label === 'Visible to staff',
      ),
    ).toBe(true);

    // Manager search should surface both
    const managerRes = await get(`/teams/${f.teamId}/search?q=Hidden`, f.managerAuth);
    expect(managerRes.status).toBe(200);
    const managerActivity = (await dataOf(managerRes)).activity as {
      kind: string;
      data?: { label?: string };
    }[];
    expect(
      managerActivity.some((e) => e.kind === 'shift.created' && e.data?.label === 'Hidden from staff'),
    ).toBe(true);
  });

  describe('swap events audience', () => {
    async function insertSwapEvent(
      teamId: string,
      kind: string,
      audience: string,
      actor: string | null,
      requesterId: string,
      targetUserId: string | null,
      extraData?: Record<string, unknown>,
    ): Promise<void> {
      const shift = await forTeam(teamId).shifts.create({
        data: {
          team_id: teamId,
          assigned_user_id: requesterId,
          created_by: requesterId,
          starts_at: new Date(),
          ends_at: new Date(Date.now() + 3600000),
          label: 'Test Shift',
        },
      });
      const swap = await forTeam(teamId).swap_requests.create({
        data: {
          team_id: teamId,
          shift_id: shift.id,
          requested_by: requesterId,
          target_user_id: targetUserId,
          status: 'pending',
        },
      });
      await forTeam(teamId).activity_events.create({
        data: {
          team_id: teamId,
          kind,
          actor_user_id: actor,
          subject_id: swap.id,
          data: {
            swapId: swap.id,
            shiftId: shift.id,
            shiftLabel: 'Test Shift',
            ...extraData,
            ...(targetUserId ? { targetUserId } : {}),
            ...(kind === 'swap.approved'
              ? { previousAssigneeId: requesterId, newAssigneeId: targetUserId, decidedBy: actor }
              : {}),
            ...(kind === 'swap.rejected' ? { decidedBy: actor } : {}),
            ...(kind === 'swap.cancelled' ? { cancelledBy: actor } : {}),
          },
          audience,
        },
      });
    }

    it('requester sees their own swap events', async () => {
      await insertSwapEvent(f.teamId, 'swap.requested', 'involved', f.ownerId, f.ownerId, f.staffId);
      const res = await get(`/teams/${f.teamId}/activity`, f.ownerAuth);
      expect(res.status).toBe(200);
      const events = (await dataOf(res)).events as { kind: string }[];
      expect(events.some((e) => e.kind === 'swap.requested')).toBe(true);
    });

    it('target sees swap events about them', async () => {
      await insertSwapEvent(f.teamId, 'swap.requested', 'involved', f.ownerId, f.ownerId, f.staffId);
      const res = await get(`/teams/${f.teamId}/activity`, f.staffAuth);
      expect(res.status).toBe(200);
      const events = (await dataOf(res)).events as { kind: string }[];
      expect(events.some((e) => e.kind === 'swap.requested')).toBe(true);
    });

    it('unrelated Staff does not see swap events about others', async () => {
      const otherStaffId = await createVerifiedUser(uniqueEmail('aa-other'), 'OtherPass123#');
      const otherStaffAuth = { authorization: `Bearer ${await signAccessToken(otherStaffId)}` };
      await addMember(f.teamId, otherStaffId, 'staff');

      await insertSwapEvent(f.teamId, 'swap.requested', 'involved', f.ownerId, f.ownerId, f.staffId);
      const res = await get(`/teams/${f.teamId}/activity`, otherStaffAuth);
      expect(res.status).toBe(200);
      const events = (await dataOf(res)).events as { kind: string }[];
      expect(events.some((e) => e.kind === 'swap.requested')).toBe(false);
    });

    it('manager sees swap events', async () => {
      await insertSwapEvent(f.teamId, 'swap.requested', 'involved', f.ownerId, f.ownerId, f.staffId);
      const res = await get(`/teams/${f.teamId}/activity`, f.managerAuth);
      expect(res.status).toBe(200);
      const events = (await dataOf(res)).events as { kind: string }[];
      expect(events.some((e) => e.kind === 'swap.requested')).toBe(true);
    });

    it('swap target sees swap.approved about them', async () => {
      await insertSwapEvent(f.teamId, 'swap.approved', 'involved', f.ownerId, f.ownerId, f.staffId);
      const res = await get(`/teams/${f.teamId}/activity`, f.staffAuth);
      expect(res.status).toBe(200);
      const events = (await dataOf(res)).events as { kind: string }[];
      expect(events.some((e) => e.kind === 'swap.approved')).toBe(true);
    });

    it('swap in another team never matches', async () => {
      const otherTeamId = await createTeamFor(f.ownerAuth, 'Other Team');
      // The staff viewer must be a member of the other team so the swap's target_user_id FK is valid.
      await addMember(otherTeamId, f.staffId, 'staff');

      const shift = await forTeam(otherTeamId).shifts.create({
        data: {
          team_id: otherTeamId,
          assigned_user_id: f.ownerId,
          created_by: f.ownerId,
          starts_at: new Date(),
          ends_at: new Date(Date.now() + 3600000),
          label: 'Other Shift',
        },
      });
      const swap = await forTeam(otherTeamId).swap_requests.create({
        data: {
          team_id: otherTeamId,
          shift_id: shift.id,
          requested_by: f.ownerId,
          target_user_id: f.staffId,
          status: 'pending',
        },
      });

      // Activity event in f.teamId (the team being viewed) whose subject is a swap owned by the other team.
      // Without the swap_requests.team_id = activity_events.team_id guard in audience.ts the involved rule
      // would match (target_user_id = f.staffId = viewer). With the guard it is excluded.
      await forTeam(f.teamId).activity_events.create({
        data: {
          team_id: f.teamId,
          kind: 'swap.requested',
          actor_user_id: f.ownerId,
          subject_id: swap.id,
          data: { swapId: swap.id, shiftId: shift.id, shiftLabel: 'Other Shift' },
          audience: 'involved',
        },
      });

      const res = await get(`/teams/${f.teamId}/activity`, f.staffAuth);
      expect(res.status).toBe(200);
      const events = (await dataOf(res)).events as { kind: string }[];
      expect(events.some((e) => (e as { data?: { swapId?: string } }).data?.swapId === swap.id)).toBe(false);
    });

    it('same visible set from listActivity and search', async () => {
      const uniqueWord = 'aa-swap-search-unique';
      await insertSwapEvent(
        f.teamId,
        'swap.requested',
        'involved',
        f.ownerId,
        f.ownerId,
        f.staffId,
        { label: uniqueWord },
      );

      // Involved staff (the target) sees the event in both list and search.
      const listRes = await get(`/teams/${f.teamId}/activity`, f.staffAuth);
      expect(listRes.status).toBe(200);
      const listEvents = (await dataOf(listRes)).events as { kind: string }[];
      const listHasSwap = listEvents.some((e) => e.kind === 'swap.requested');

      const searchRes = await get(
        `/teams/${f.teamId}/search?q=${encodeURIComponent(uniqueWord)}`,
        f.staffAuth,
      );
      expect(searchRes.status).toBe(200);
      const searchActivity = (await dataOf(searchRes)).activity as { kind: string }[];
      const searchHasSwap = searchActivity.some((e) => e.kind === 'swap.requested');

      expect(listHasSwap).toBe(searchHasSwap);
      expect(listHasSwap).toBe(true);
      expect(searchHasSwap).toBe(true);

      // Unrelated staff sees the event in neither list nor search.
      const otherStaffId = await createVerifiedUser(uniqueEmail('aa-swap-other'), 'OtherPass123#');
      const otherStaffAuth = { authorization: `Bearer ${await signAccessToken(otherStaffId)}` };
      await addMember(f.teamId, otherStaffId, 'staff');

      const otherListRes = await get(`/teams/${f.teamId}/activity`, otherStaffAuth);
      const otherListEvents = (await dataOf(otherListRes)).events as { kind: string }[];
      const otherListHasSwap = otherListEvents.some((e) => e.kind === 'swap.requested');

      const otherSearchRes = await get(
        `/teams/${f.teamId}/search?q=${encodeURIComponent(uniqueWord)}`,
        otherStaffAuth,
      );
      const otherSearchActivity = (await dataOf(otherSearchRes)).activity as { kind: string }[];
      const otherSearchHasSwap = otherSearchActivity.some((e) => e.kind === 'swap.requested');

      expect(otherListHasSwap).toBe(otherSearchHasSwap);
      expect(otherListHasSwap).toBe(false);
      expect(otherSearchHasSwap).toBe(false);
    });
  });
});
