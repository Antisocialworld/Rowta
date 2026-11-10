// Phase 4 server tests: shifts, calendar, activity feed, search (PRD 8.3, 8.4, 12; rules S7, S14, C4, D4).
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { forTeam, globalDb, teamTransaction } from '../src/db/clients.ts';
import { signAccessToken } from '../src/security/access-token.ts';
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

function shiftBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const startsAt = new Date(Date.now() + 60 * 60 * 1_000);
  const endsAt = new Date(startsAt.getTime() + 4 * 60 * 60 * 1_000);
  return {
    assignedUserId: overrides.assignedUserId,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    label: 'Opening shift',
    notes: 'Unlock the front door',
    ...overrides,
  };
}

async function createTeamFor(ownerAuth: { authorization: string }, name: string): Promise<string> {
  const res = await post(app, '/teams', { name }, { ...ownerAuth, 'idempotency-key': randomUUID() });
  expect(res.status).toBe(201);
  return (await dataOf(res)).id as string;
}

async function addMember(teamId: string, userId: string, role: 'manager' | 'staff'): Promise<void> {
  await forTeam(teamId).memberships.create({ data: { team_id: teamId, user_id: userId, role } });
}

async function createShift(
  f: Fixture,
  overrides: Record<string, unknown> = {},
  key = randomUUID(),
): Promise<{ shiftId: string; body: Record<string, unknown> }> {
  const res = await post(
    app,
    `/teams/${f.teamId}/shifts`,
    shiftBody({ assignedUserId: f.staffId, ...overrides }),
    { ...f.ownerAuth, 'idempotency-key': key },
  );
  expect(res.status).toBe(201);
  const body = await dataOf(res);
  return { shiftId: body.id as string, body };
}

describe('Phase 4 shifts, calendar, activity feed and search', () => {
  let f: Fixture;
  let outsiderAuth: { authorization: string };
  let outsiderId: string;
  let otherTeamId: string;

  beforeAll(async () => {
    await clearRateKeys();
    await ensureTestCountries();
    app = testApp('shifts-activity');

    const ownerEmail = uniqueEmail('shift-owner');
    const managerEmail = uniqueEmail('shift-manager');
    const staffEmail = uniqueEmail('shift-staff');
    const outsiderEmail = uniqueEmail('shift-outsider');

    const ownerId = await createVerifiedUser(ownerEmail, 'OwnerPass123#');
    const managerId = await createVerifiedUser(managerEmail, 'ManagerPass123#');
    const staffId = await createVerifiedUser(staffEmail, 'StaffPass123#');
    outsiderId = await createVerifiedUser(outsiderEmail, 'OutsiderPass123#');

    const db = globalDb();
    await db.users.update({ where: { id: ownerId }, data: { display_name: 'Zara Owner' } });
    await db.users.update({ where: { id: managerId }, data: { display_name: 'Mo Manager' } });
    await db.users.update({ where: { id: staffId }, data: { display_name: 'Sam Staff' } });
    await db.users.update({ where: { id: outsiderId }, data: { display_name: 'Olga Outsider' } });

    const ownerAuth = { authorization: `Bearer ${await signAccessToken(ownerId)}` };
    const managerAuth = { authorization: `Bearer ${await signAccessToken(managerId)}` };
    const staffAuth = { authorization: `Bearer ${await signAccessToken(staffId)}` };
    const outsider = { authorization: `Bearer ${await signAccessToken(outsiderId)}` };

    const teamId = await createTeamFor(ownerAuth, 'Shift Cafe');
    await addMember(teamId, managerId, 'manager');
    await addMember(teamId, staffId, 'staff');

    f = { ownerId, managerId, staffId, ownerAuth, managerAuth, staffAuth, teamId };
    outsiderAuth = outsider;
    otherTeamId = await createTeamFor(outsider, 'Other Cafe');
  });

  afterAll(async () => {
    await shutdownAuthTest();
  });

  describe('create (idempotency, permission, atomic activity)', () => {
    it('requires an Idempotency-Key header', async () => {
      const res = await post(app, `/teams/${f.teamId}/shifts`, shiftBody({ assignedUserId: f.staffId }), f.ownerAuth);
      expect(res.status).toBe(400);
      expect((await errorOf(res)).code).toBe('idempotency.missing');
    });

    it('creates a shift and writes shift.created in the same transaction', async () => {
      const key = randomUUID();
      const payload = shiftBody({ assignedUserId: f.staffId });
      const res = await post(app, `/teams/${f.teamId}/shifts`, payload, {
        ...f.ownerAuth,
        'idempotency-key': key,
      });
      expect(res.status).toBe(201);
      const body = await dataOf(res);
      const shiftId = body.id as string;
      expect(body.label).toBe('Opening shift');
      expect(body.teamId).toBe(f.teamId);
      expect(body.assignedUserId).toBe(f.staffId);

      const events = await forTeam(f.teamId).activity_events.findMany({
        where: { team_id: f.teamId, kind: 'shift.created', subject_id: shiftId },
      });
      expect(events).toHaveLength(1);
      expect(events[0]?.actor_user_id).toBe(f.ownerId);
      expect((events[0]?.data as { label?: string }).label).toBe('Opening shift');

      const replay = await post(app, `/teams/${f.teamId}/shifts`, payload, {
        ...f.ownerAuth,
        'idempotency-key': key,
      });
      expect(replay.status).toBe(201);
      expect((await dataOf(replay)).id).toBe(shiftId);

      const conflict = await post(
        app,
        `/teams/${f.teamId}/shifts`,
        { ...payload, label: 'Different label' },
        { ...f.ownerAuth, 'idempotency-key': key },
      );
      expect(conflict.status).toBe(422);
      expect((await errorOf(conflict)).code).toBe('idempotency.fingerprint_mismatch');
    });

    it('lets a Manager create but refuses Staff with 403 team.forbidden', async () => {
      const okRes = await post(
        app,
        `/teams/${f.teamId}/shifts`,
        shiftBody({ assignedUserId: f.staffId, label: 'Manager shift' }),
        { ...f.managerAuth, 'idempotency-key': randomUUID() },
      );
      expect(okRes.status).toBe(201);

      const denied = await post(
        app,
        `/teams/${f.teamId}/shifts`,
        shiftBody({ assignedUserId: f.staffId, label: 'Staff shift' }),
        { ...f.staffAuth, 'idempotency-key': randomUUID() },
      );
      expect(denied.status).toBe(403);
      expect((await errorOf(denied)).code).toBe('team.forbidden');
    });

    it('refuses an assignee who is not an active member of the same team', async () => {
      const res = await post(
        app,
        `/teams/${f.teamId}/shifts`,
        shiftBody({ assignedUserId: randomUUID() }),
        { ...f.ownerAuth, 'idempotency-key': randomUUID() },
      );
      expect(res.status).toBe(422);
      const body = await errorOf(res);
      expect(body.fields?.assignedUserId).toBe('shift.assignee.invalid');
    });

    it('rejects unknown fields and end <= start', async () => {
      const unknown = await post(
        app,
        `/teams/${f.teamId}/shifts`,
        { ...shiftBody({ assignedUserId: f.staffId }), surprise: true },
        { ...f.ownerAuth, 'idempotency-key': randomUUID() },
      );
      expect(unknown.status).toBe(422);
      expect((await errorOf(unknown)).fields?.surprise).toBe('validation.unknown_field');

      const startsAt = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
      const badTime = await post(
        app,
        `/teams/${f.teamId}/shifts`,
        shiftBody({ assignedUserId: f.staffId, startsAt, endsAt: startsAt }),
        { ...f.ownerAuth, 'idempotency-key': randomUUID() },
      );
      expect(badTime.status).toBe(422);
      expect((await errorOf(badTime)).fields?.endsAt).toBe('shift.timeOrder');
    });

    it('refuses a caller from another team with 404 (never 403)', async () => {
      const res = await post(
        app,
        `/teams/${f.teamId}/shifts`,
        shiftBody({ assignedUserId: f.staffId }),
        { ...outsiderAuth, 'idempotency-key': randomUUID() },
      );
      expect(res.status).toBe(404);
      expect((await errorOf(res)).code).toBe('team.notFound');
    });
  });

  describe('read: detail, calendar, visibility of soft-deleted rows', () => {
    let shiftId: string;

    beforeAll(async () => {
      shiftId = (await createShift(f, { label: 'Detail shift' })).shiftId;
    });

    it('returns detail to every role with the assignee display name', async () => {
      const res = await get(`/teams/${f.teamId}/shifts/${shiftId}`, f.staffAuth);
      expect(res.status).toBe(200);
      const body = await dataOf(res);
      expect(body.id).toBe(shiftId);
      expect((body.assignee as { displayName: string }).displayName).toBe('Sam Staff');
      const createdBy = body.createdBy as { userId: string; displayName: string; role: string | null };
      expect(createdBy).toBeDefined();
      expect(createdBy.displayName).toBe('Zara Owner');
      expect(createdBy.role).toBe('owner');
      expect((createdBy as Record<string, unknown>).email).toBeUndefined();
    });

    it('returns createdBy with display name and null role when creator is removed from the team', async () => {
      const email = uniqueEmail('shift-temp-creator');
      const creatorId = await createVerifiedUser(email, 'TempCreatorPass123#');
      await globalDb().users.update({ where: { id: creatorId }, data: { display_name: 'Terry Temp' } });
      await addMember(f.teamId, creatorId, 'manager');
      const creatorAuth = { authorization: `Bearer ${await signAccessToken(creatorId)}` };

      const resCreate = await post(
        app,
        `/teams/${f.teamId}/shifts`,
        shiftBody({ assignedUserId: f.staffId, label: 'Temp creator shift' }),
        { ...creatorAuth, 'idempotency-key': randomUUID() },
      );
      expect(resCreate.status).toBe(201);
      const tempShiftId = (await dataOf(resCreate)).id as string;

      // Soft-delete membership: creator is removed from the team
      await forTeam(f.teamId).memberships.update({
        where: { team_id_user_id: { team_id: f.teamId, user_id: creatorId } },
        data: { removed_at: new Date() },
      });

      const resDetail = await get(`/teams/${f.teamId}/shifts/${tempShiftId}`, f.staffAuth);
      expect(resDetail.status).toBe(200);
      const body = await dataOf(resDetail);
      const createdBy = body.createdBy as { userId: string; displayName: string; role: string | null };
      expect(createdBy).toBeDefined();
      expect(createdBy.displayName).toBe('Terry Temp');
      expect(createdBy.role).toBeNull();
      expect((createdBy as Record<string, unknown>).email).toBeUndefined();
    });

    it('returns the calendar range, including a shift that starts before it and ends inside', async () => {
      const overnight = await createShift(f, {
        label: 'Overnight',
        startsAt: new Date(Date.now() - 2 * 60 * 60 * 1_000).toISOString(),
        endsAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      });
      const from = new Date(Date.now() - 30 * 60 * 1_000).toISOString();
      const to = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
      const res = await get(
        `/teams/${f.teamId}/shifts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        f.staffAuth,
      );
      expect(res.status).toBe(200);
      const ids = ((await dataOf(res)).shifts as { id: string }[]).map((s) => s.id);
      expect(ids).toContain(overnight.shiftId);
      expect(ids).toContain(shiftId);
    });

    it('enforces the maximum range and a valid order', async () => {
      const from = new Date(Date.now()).toISOString();
      const tooLong = new Date(Date.now() + 43 * 24 * 60 * 60 * 1_000).toISOString();
      const res = await get(
        `/teams/${f.teamId}/shifts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(tooLong)}`,
        f.staffAuth,
      );
      expect(res.status).toBe(422);
      expect((await errorOf(res)).fields?.to).toBe('shift.range.tooLong');

      const backwards = await get(
        `/teams/${f.teamId}/shifts?from=${encodeURIComponent(tooLong)}&to=${encodeURIComponent(from)}`,
        f.staffAuth,
      );
      expect(backwards.status).toBe(422);
      expect((await errorOf(backwards)).fields?.to).toBe('shift.range.invalid');
    });

    it('hides a soft-deleted shift from detail, calendar and search but keeps the feed event', async () => {
      const created = await createShift(f, { label: 'Delete me shift' });
      const del = await post(app, `/teams/${f.teamId}/shifts/${created.shiftId}/delete`, undefined, f.ownerAuth);
      expect(del.status).toBe(200);

      const detail = await get(`/teams/${f.teamId}/shifts/${created.shiftId}`, f.staffAuth);
      expect(detail.status).toBe(404);
      expect((await errorOf(detail)).code).toBe('shift.notFound');

      const from = new Date(Date.now() - 60 * 60 * 1_000).toISOString();
      const to = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
      const calendar = await get(
        `/teams/${f.teamId}/shifts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        f.staffAuth,
      );
      const ids = ((await dataOf(calendar)).shifts as { id: string }[]).map((s) => s.id);
      expect(ids).not.toContain(created.shiftId);

      const search = await get(`/teams/${f.teamId}/search?q=Delete`, f.staffAuth);
      const shiftIds = ((await dataOf(search)).shifts as { id: string }[]).map((s) => s.id);
      expect(shiftIds).not.toContain(created.shiftId);

      const feed = await get(`/teams/${f.teamId}/activity?limit=50`, f.staffAuth);
      const events = (await dataOf(feed)).events as { kind: string; subjectId: string }[];
      expect(events.some((e) => e.kind === 'shift.deleted' && e.subjectId === created.shiftId)).toBe(true);

      const updateDeleted = await post(
        app,
        `/teams/${f.teamId}/shifts/${created.shiftId}/update`,
        shiftBody({ assignedUserId: f.staffId }),
        f.ownerAuth,
      );
      expect(updateDeleted.status).toBe(404);
    });

    it('returns 404 for a shift of another team and for a non-member on every read route', async () => {
      const foreign = await post(
        app,
        `/teams/${otherTeamId}/shifts`,
        shiftBody({ assignedUserId: outsiderId }),
        { ...outsiderAuth, 'idempotency-key': randomUUID() },
      );
      expect(foreign.status).toBe(201);
      const foreignId = (await dataOf(foreign)).id as string;

      const crossTeam = await get(`/teams/${f.teamId}/shifts/${foreignId}`, f.staffAuth);
      expect(crossTeam.status).toBe(404);
      expect((await errorOf(crossTeam)).code).toBe('shift.notFound');

      const detail = await get(`/teams/${f.teamId}/shifts/${shiftId}`, outsiderAuth);
      expect(detail.status).toBe(404);
      const range = await get(
        `/teams/${f.teamId}/shifts?from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(
          new Date(Date.now() + 86_400_000).toISOString(),
        )}`,
        outsiderAuth,
      );
      expect(range.status).toBe(404);
      const feed = await get(`/teams/${f.teamId}/activity`, outsiderAuth);
      expect(feed.status).toBe(404);
      const search = await get(`/teams/${f.teamId}/search?q=Opening`, outsiderAuth);
      expect(search.status).toBe(404);
    });
  });

  describe('update and delete', () => {
    it('updates a shift and writes shift.updated atomically; Staff is refused', async () => {
      const created = await createShift(f, { label: 'Before update' });
      const denied = await post(
        app,
        `/teams/${f.teamId}/shifts/${created.shiftId}/update`,
        shiftBody({ assignedUserId: f.staffId, label: 'Staff tries' }),
        f.staffAuth,
      );
      expect(denied.status).toBe(403);

      const res = await post(
        app,
        `/teams/${f.teamId}/shifts/${created.shiftId}/update`,
        shiftBody({ assignedUserId: f.managerId, label: 'After update' }),
        f.managerAuth,
      );
      expect(res.status).toBe(200);
      expect((await dataOf(res)).label).toBe('After update');

      const events = await forTeam(f.teamId).activity_events.findMany({
        where: { team_id: f.teamId, kind: 'shift.updated', subject_id: created.shiftId },
      });
      expect(events).toHaveLength(1);
      expect(events[0]?.actor_user_id).toBe(f.managerId);
    });

    it('rolls the shift change back when the activity insert fails (one transaction)', async () => {
      const created = await createShift(f, { label: 'Atomic shift' });
      const before = await forTeam(f.teamId).shifts.findUnique({ where: { id: created.shiftId } });

      await expect(
        teamTransaction(f.teamId, async (tx) => {
          await tx.shifts.update({ where: { id: created.shiftId }, data: { label: 'Must roll back' } });
          await tx.activity_events.create({
            data: {
              team_id: randomUUID(),
              kind: 'shift.updated',
              subject_id: created.shiftId,
              data: { label: 'Must roll back' },
            },
          });
        }),
      ).rejects.toThrow();

      const after = await forTeam(f.teamId).shifts.findUnique({ where: { id: created.shiftId } });
      expect(after?.label).toBe(before?.label);
      const events = await forTeam(f.teamId).activity_events.findMany({
        where: { team_id: f.teamId, subject_id: created.shiftId, kind: 'shift.updated' },
      });
      expect(events).toHaveLength(0);
    });

    it('soft-deletes: the row survives with deleted_at and deleted_by set', async () => {
      const created = await createShift(f, { label: 'Soft delete proof' });
      const res = await post(app, `/teams/${f.teamId}/shifts/${created.shiftId}/delete`, undefined, f.ownerAuth);
      expect(res.status).toBe(200);

      const row = await forTeam(f.teamId).shifts.findUnique({ where: { id: created.shiftId } });
      expect(row).not.toBeNull();
      expect(row?.deleted_at).not.toBeNull();
      expect(row?.deleted_by).toBe(f.ownerId);
    });
  });

  describe('activity feed cursor pagination', () => {
    it('pagination is stable when five events share one timestamp across page boundaries', async () => {
      const sameTime = new Date(Date.now() - 60 * 60 * 1_000);
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) {
    const row = await forTeam(f.teamId).activity_events.create({
      data: {
        team_id: f.teamId,
        kind: 'shift.updated',
        actor_user_id: f.ownerId,
        subject_id: randomUUID(),
        data: { label: `same-timestamp-${i}`, marker: 'straddle' },
        audience: 'team',
        created_at: sameTime,
      },
    });
        ids.push(row.id);
      }

      const seen = new Set<string>();
      let cursor: string | null = null;
      let pages = 0;
      do {
        const path: string = cursor === null
          ? `/teams/${f.teamId}/activity?limit=2`
          : `/teams/${f.teamId}/activity?limit=2&cursor=${encodeURIComponent(cursor)}`;
        const res = await get(path, f.staffAuth);
        expect(res.status).toBe(200);
        const body = await dataOf(res);
        const events = body.events as { id: string }[];
        for (const event of events) {
          expect(seen.has(event.id)).toBe(false);
          seen.add(event.id);
        }
        cursor = (body.nextCursor as string | null) ?? null;
        pages += 1;
        expect(pages).toBeLessThan(200);
      } while (cursor !== null);

      for (const id of ids) expect(seen.has(id)).toBe(true);
    });

    it('rejects a malformed cursor with 400', async () => {
      const res = await get(`/teams/${f.teamId}/activity?cursor=not-a-cursor`, f.staffAuth);
      expect(res.status).toBe(400);
      expect((await errorOf(res)).code).toBe('activity.cursor.invalid');
    });
  });

  describe('search', () => {
    it('finds roster names, shift labels/notes and activity, team-scoped', async () => {
      await createShift(f, { label: 'Stocktake shift', notes: 'Count every bean' });
      const members = await dataOf(await get(`/teams/${f.teamId}/search?q=Zara`, f.staffAuth));
      expect((members.members as { displayName: string }[]).map((m) => m.displayName)).toContain('Zara Owner');

      const shifts = await dataOf(await get(`/teams/${f.teamId}/search?q=Stocktake`, f.staffAuth));
      expect((shifts.shifts as { label: string }[]).some((s) => s.label === 'Stocktake shift')).toBe(true);

      const notes = await dataOf(await get(`/teams/${f.teamId}/search?q=bean`, f.staffAuth));
      expect((notes.shifts as { label: string }[]).some((s) => s.label === 'Stocktake shift')).toBe(true);

      const activity = await dataOf(await get(`/teams/${f.teamId}/search?q=Stocktake`, f.staffAuth));
      expect((activity.activity as { data: { label?: string } }[]).length).toBeGreaterThan(0);
    });

    it('enforces the minimum query length and team isolation', async () => {
      const short = await get(`/teams/${f.teamId}/search?q=Z`, f.staffAuth);
      expect(short.status).toBe(422);
      expect((await errorOf(short)).fields?.q).toBe('search.query.tooShort');

      const isolated = await get(`/teams/${f.teamId}/search?q=Zara`, outsiderAuth);
      expect(isolated.status).toBe(404);
      expect((await errorOf(isolated)).code).toBe('team.notFound');
    });
  });
});
