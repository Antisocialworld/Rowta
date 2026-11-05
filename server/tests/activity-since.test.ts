// Activity feed `since` filter (Task 2).
// Inserts activity_events rows directly and reads them back through the real HTTP
// activity endpoint with `since` set and unset.
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
  staffId: string;
  ownerAuth: { authorization: string };
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
  createdAt?: Date,
): Promise<void> {
  await forTeam(teamId).activity_events.create({
    data: {
      team_id: teamId,
      kind,
      actor_user_id: actor,
      subject_id: randomUUID(),
      data: label ? { label } : {},
      audience,
      ...(createdAt !== undefined ? { created_at: createdAt } : {}),
    },
  });
}

describe('Activity feed since filter', () => {
  let f: Fixture;

  beforeAll(async () => {
    await clearRateKeys();
    await ensureTestCountries();
    app = testApp('activity-since');

    const ownerId = await createVerifiedUser(uniqueEmail('si-owner'), 'OwnerPass123#');
    const staffId = await createVerifiedUser(uniqueEmail('si-staff'), 'StaffPass123#');

    const ownerAuth = { authorization: `Bearer ${await signAccessToken(ownerId)}` };
    const staffAuth = { authorization: `Bearer ${await signAccessToken(staffId)}` };

    const teamId = await createTeamFor(ownerAuth, 'Since Test Team');
    await addMember(teamId, staffId, 'staff');

    f = { ownerId, staffId, ownerAuth, staffAuth, teamId };
  });

  afterAll(async () => {
    await shutdownAuthTest();
  });

  it('excludes events at or before since, includes events after since', async () => {
    const old = new Date('2026-01-01T10:00:00.000Z');
    const boundary = new Date('2026-01-01T12:00:00.000Z');
    const newer = new Date('2026-01-01T14:00:00.000Z');

    await insertEvent(f.teamId, 'shift.created', 'team', f.ownerId, 'old event', old);
    await insertEvent(f.teamId, 'shift.created', 'team', f.ownerId, 'boundary event', boundary);
    await insertEvent(f.teamId, 'shift.created', 'team', f.ownerId, 'newer event', newer);

    const since = boundary.toISOString();
    const res = await get(`/teams/${f.teamId}/activity?since=${encodeURIComponent(since)}`, f.ownerAuth);
    expect(res.status).toBe(200);
    const events = (await dataOf(res)).events as { kind: string; data?: { label?: string } }[];
    const labels = events.map((e) => e.data?.label);
    expect(labels).not.toContain('old event');
    expect(labels).not.toContain('boundary event');
    expect(labels).toContain('newer event');
  });

  it('the exact-boundary event (created_at equal to since in ms) is EXCLUDED', async () => {
    const boundary = new Date('2026-01-01T12:00:00.000Z');
    await insertEvent(f.teamId, 'shift.created', 'team', f.ownerId, 'at boundary', boundary);

    const since = boundary.toISOString();
    const res = await get(`/teams/${f.teamId}/activity?since=${encodeURIComponent(since)}`, f.ownerAuth);
    expect(res.status).toBe(200);
    const events = (await dataOf(res)).events as { kind: string; data?: { label?: string } }[];
    const labels = events.map((e) => e.data?.label);
    expect(labels).not.toContain('at boundary');
  });

  it('works without since (behaves exactly as today)', async () => {
    await insertEvent(f.teamId, 'shift.created', 'team', f.ownerId, 'visible without since');
    const res = await get(`/teams/${f.teamId}/activity`, f.ownerAuth);
    expect(res.status).toBe(200);
    const events = (await dataOf(res)).events as { kind: string; data?: { label?: string } }[];
    const labels = events.map((e) => e.data?.label);
    expect(labels).toContain('visible without since');
  });

  it('works with cursor pagination combined with since', async () => {
    // Dedicated team so no other test's events interfere.
    const cursorTeamId = await createTeamFor(f.ownerAuth, 'Since Cursor Team');

    const c1 = new Date('2026-01-01T10:00:00.000Z');
    const c2 = new Date('2026-01-01T11:00:00.000Z');
    const c3 = new Date('2026-01-01T13:00:00.000Z');
    const c4 = new Date('2026-01-01T14:00:00.000Z');
    const c5 = new Date('2026-01-01T15:00:00.000Z');

    await insertEvent(cursorTeamId, 'shift.created', 'team', f.ownerId, 'cursor-1', c1);
    await insertEvent(cursorTeamId, 'shift.created', 'team', f.ownerId, 'cursor-2', c2);
    await insertEvent(cursorTeamId, 'shift.created', 'team', f.ownerId, 'cursor-3', c3);
    await insertEvent(cursorTeamId, 'shift.created', 'team', f.ownerId, 'cursor-4', c4);
    await insertEvent(cursorTeamId, 'shift.created', 'team', f.ownerId, 'cursor-5', c5);

    const since = new Date('2026-01-01T12:00:00.000Z').toISOString();
    const base = `/teams/${cursorTeamId}/activity?since=${encodeURIComponent(since)}&limit=1`;

    // Page 1: newest event after since.
    const page1 = await get(`${base}`, f.ownerAuth);
    expect(page1.status).toBe(200);
    const body1 = await dataOf(page1);
    const events1 = body1.events as { kind: string; data?: { label?: string } }[];
    expect(events1.length).toBe(1);
    expect(events1[0]?.data?.label).toBe('cursor-5');
    const cursor1 = body1.nextCursor as string | null;
    expect(cursor1).not.toBeNull();

    // Page 2: continue from page 1's cursor.
    const page2 = await get(
      `${base}&cursor=${encodeURIComponent(cursor1 ?? '')}`,
      f.ownerAuth,
    );
    expect(page2.status).toBe(200);
    const body2 = await dataOf(page2);
    const events2 = body2.events as { kind: string; data?: { label?: string } }[];
    expect(events2.length).toBe(1);
    expect(events2[0]?.data?.label).toBe('cursor-4');
    const cursor2 = body2.nextCursor as string | null;
    expect(cursor2).not.toBeNull();

    // Page 3: continue from page 2's cursor; no more pages.
    const page3 = await get(
      `${base}&cursor=${encodeURIComponent(cursor2 ?? '')}`,
      f.ownerAuth,
    );
    expect(page3.status).toBe(200);
    const body3 = await dataOf(page3);
    const events3 = body3.events as { kind: string; data?: { label?: string } }[];
    expect(events3.length).toBe(1);
    expect(events3[0]?.data?.label).toBe('cursor-3');
    const cursor3 = body3.nextCursor as string | null;
    expect(cursor3).toBeNull();

    // Across all three pages, cursor-1 and cursor-2 never appear.
    const allLabels = [...events1, ...events2, ...events3].map((e) => e.data?.label);
    expect(allLabels).not.toContain('cursor-1');
    expect(allLabels).not.toContain('cursor-2');
  });

  it('staff cannot see manager-only events even after since', async () => {
    const boundary = new Date('2026-01-01T12:00:00.000Z');
    await insertEvent(f.teamId, 'team.transferred', 'managers', f.ownerId, 'managers only', boundary);
    await insertEvent(f.teamId, 'shift.created', 'team', f.ownerId, 'team event', new Date('2026-01-01T13:00:00.000Z'));

    const since = boundary.toISOString();
    const res = await get(`/teams/${f.teamId}/activity?since=${encodeURIComponent(since)}`, f.staffAuth);
    expect(res.status).toBe(200);
    const events = (await dataOf(res)).events as { kind: string; data?: { label?: string } }[];
    const labels = events.map((e) => e.data?.label);
    expect(labels).not.toContain('managers only');
    expect(labels).toContain('team event');
  });

  it('invalid since returns 422', async () => {
    const res = await get(`/teams/${f.teamId}/activity?since=not-a-date`, f.ownerAuth);
    expect(res.status).toBe(422);
  });

  it('since before all events returns everything', async () => {
    const wayBack = new Date('2020-01-01T00:00:00.000Z');
    await insertEvent(f.teamId, 'shift.created', 'team', f.ownerId, 'old but after wayback', new Date('2026-01-01T10:00:00.000Z'));

    const since = wayBack.toISOString();
    const res = await get(`/teams/${f.teamId}/activity?since=${encodeURIComponent(since)}`, f.ownerAuth);
    expect(res.status).toBe(200);
    const events = (await dataOf(res)).events as { kind: string; data?: { label?: string } }[];
    const labels = events.map((e) => e.data?.label);
    expect(labels).toContain('old but after wayback');
  });
});
