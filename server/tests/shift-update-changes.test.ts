// Shift update records what changed (Phase 2; rules V1).
// Creates a shift, updates it, and asserts the shift.updated activity event's `changes` object.
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
  shutdownAuthTest,
  testApp,
  uniqueEmail,
} from './helpers/auth-test.ts';

let app: Hono;

async function post(
  app: Hono,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
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

async function lastUpdatedEvent(f: Fixture, shiftId: string) {
  const events = await forTeam(f.teamId).activity_events.findMany({
    where: { team_id: f.teamId, kind: 'shift.updated', subject_id: shiftId },
    orderBy: { created_at: 'desc' },
    take: 1,
  });
  return events[0];
}

describe('Shift update records what changed', () => {
  let f: Fixture;

  beforeAll(async () => {
    await clearRateKeys();
    await ensureTestCountries();
    app = testApp('shift-update-changes');

    const ownerId = await createVerifiedUser(uniqueEmail('su-owner'), 'OwnerPass123#');
    const managerId = await createVerifiedUser(uniqueEmail('su-manager'), 'ManagerPass123#');
    const staffId = await createVerifiedUser(uniqueEmail('su-staff'), 'StaffPass123#');

    const ownerAuth = { authorization: `Bearer ${await signAccessToken(ownerId)}` };
    const managerAuth = { authorization: `Bearer ${await signAccessToken(managerId)}` };
    const staffAuth = { authorization: `Bearer ${await signAccessToken(staffId)}` };

    const teamId = await createTeamFor(ownerAuth, 'Shift Update Test Team');
    await addMember(teamId, managerId, 'manager');
    await addMember(teamId, staffId, 'staff');

    f = { ownerId, managerId, staffId, ownerAuth, managerAuth, staffAuth, teamId };
  });

  afterAll(async () => {
    await shutdownAuthTest();
  });

  it('records label change with from/to', async () => {
    const { shiftId } = await createShift(f, { label: 'Before' });
    const res = await post(
      app,
      `/teams/${f.teamId}/shifts/${shiftId}/update`,
      shiftBody({ assignedUserId: f.staffId, label: 'After' }),
      { ...f.managerAuth, 'idempotency-key': randomUUID() },
    );
    expect(res.status).toBe(200);

    const event = await lastUpdatedEvent(f, shiftId);
    if (!event) {
      throw new Error(`Expected shift.updated activity event for shift ${shiftId} but none was found`);
    }
    const data = event.data as { changes?: { label?: { from: string; to: string } } };
    expect(data.changes?.label).toEqual({ from: 'Before', to: 'After' });
  });

  it('records startsAt and endsAt change', async () => {
    const { shiftId } = await createShift(f);
    const newStarts = new Date(Date.now() + 2 * 60 * 60 * 1_000).toISOString();
    const newEnds = new Date(Date.now() + 6 * 60 * 60 * 1_000).toISOString();
    const res = await post(
      app,
      `/teams/${f.teamId}/shifts/${shiftId}/update`,
      shiftBody({ assignedUserId: f.staffId, startsAt: newStarts, endsAt: newEnds }),
      { ...f.managerAuth, 'idempotency-key': randomUUID() },
    );
    expect(res.status).toBe(200);

    const event = await lastUpdatedEvent(f, shiftId);
    if (!event) {
      throw new Error(`Expected shift.updated activity event for shift ${shiftId} but none was found`);
    }
    const data = event.data as {
      changes?: { startsAt?: { from: string; to: string }; endsAt?: { from: string; to: string } };
    };
    expect(data.changes?.startsAt).toEqual({ from: expect.any(String), to: newStarts });
    expect(data.changes?.endsAt).toEqual({ from: expect.any(String), to: newEnds });
  });

  it('records assignee change with from/to ids', async () => {
    const { shiftId } = await createShift(f, { assignedUserId: f.staffId });
    const res = await post(
      app,
      `/teams/${f.teamId}/shifts/${shiftId}/update`,
      shiftBody({ assignedUserId: f.managerId }),
      { ...f.ownerAuth, 'idempotency-key': randomUUID() },
    );
    expect(res.status).toBe(200);

    const event = await lastUpdatedEvent(f, shiftId);
    if (!event) {
      throw new Error(`Expected shift.updated activity event for shift ${shiftId} but none was found`);
    }
    const data = event.data as { changes?: { assignedUserId?: { from: string; to: string } } };
    expect(data.changes?.assignedUserId).toEqual({ from: f.staffId, to: f.managerId });
  });

  it('records notesChanged true but never stores notes text', async () => {
    const { shiftId } = await createShift(f, { notes: 'Original notes' });
    const res = await post(
      app,
      `/teams/${f.teamId}/shifts/${shiftId}/update`,
      shiftBody({ assignedUserId: f.staffId, notes: 'Updated notes' }),
      { ...f.managerAuth, 'idempotency-key': randomUUID() },
    );
    expect(res.status).toBe(200);

    const event = await lastUpdatedEvent(f, shiftId);
    if (!event) {
      throw new Error(`Expected shift.updated activity event for shift ${shiftId} but none was found`);
    }
    const data = event.data as { changes?: { notesChanged?: boolean; notes?: string } };
    expect(data.changes?.notesChanged).toBe(true);
    expect(data.changes?.notes).toBeUndefined();
    const changesJson = JSON.stringify(data.changes);
    expect(changesJson).not.toContain('Original notes');
    expect(changesJson).not.toContain('Updated notes');
  });

  it('records empty changes when nothing changed', async () => {
    const created = await createShift(f, { label: 'Same' });
    const res = await post(
      app,
      `/teams/${f.teamId}/shifts/${created.shiftId}/update`,
      shiftBody({
        assignedUserId: f.staffId,
        label: created.body.label,
        startsAt: created.body.startsAt,
        endsAt: created.body.endsAt,
      }),
      { ...f.managerAuth, 'idempotency-key': randomUUID() },
    );
    expect(res.status).toBe(200);

    const event = await lastUpdatedEvent(f, created.shiftId);
    if (!event) {
      throw new Error(`Expected shift.updated activity event for shift ${created.shiftId} but none was found`);
    }
    const data = event.data as { changes?: Record<string, unknown> };
    expect(data.changes).toEqual({});
  });

  it('keeps existing keys label, startsAt, endsAt in data', async () => {
    const { shiftId } = await createShift(f, { label: 'Keep keys' });
    const res = await post(
      app,
      `/teams/${f.teamId}/shifts/${shiftId}/update`,
      shiftBody({ assignedUserId: f.staffId, label: 'Keep keys too' }),
      { ...f.managerAuth, 'idempotency-key': randomUUID() },
    );
    expect(res.status).toBe(200);

    const event = await lastUpdatedEvent(f, shiftId);
    if (!event) {
      throw new Error(`Expected shift.updated activity event for shift ${shiftId} but none was found`);
    }
    const data = event.data as { label?: string; startsAt?: string; endsAt?: string; changes?: unknown };
    expect(data.label).toBe('Keep keys too');
    expect(typeof data.startsAt).toBe('string');
    expect(typeof data.endsAt).toBe('string');
  });
});
