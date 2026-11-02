// Phase 5 server tests: swaps lifecycle, permissions, concurrency, isolation, atomicity (PRD 8.5, 9.9, 12).
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { forTeam, globalDb } from '../src/db/clients.ts';
import { signAccessToken } from '../src/security/access-token.ts';
import { fingerprint } from '../src/security/fingerprint.ts';
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
  staff1Id: string;
  staff2Id: string;
  ownerAuth: { authorization: string };
  managerAuth: { authorization: string };
  staff1Auth: { authorization: string };
  staff2Auth: { authorization: string };
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

async function createShift(
  f: Fixture,
  assigneeId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1_000);
  const endsAt = new Date(startsAt.getTime() + 4 * 60 * 60 * 1_000);
  const res = await post(
    app,
    `/teams/${f.teamId}/shifts`,
    {
      assignedUserId: assigneeId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      label: 'Regular Shift',
      notes: 'Standard duties',
      ...overrides,
    },
    { ...f.ownerAuth, 'idempotency-key': randomUUID() },
  );
  expect(res.status).toBe(201);
  return (await dataOf(res)).id as string;
}

describe('Phase 5 swaps lifecycle, permissions and constraints', () => {
  let f: Fixture;
  let outsiderAuth: { authorization: string };
  let outsiderId: string;

  beforeAll(async () => {
    await clearRateKeys();
    await ensureTestCountries();
    app = testApp('swaps-routes');

    const ownerEmail = uniqueEmail('swap-owner');
    const managerEmail = uniqueEmail('swap-manager');
    const staff1Email = uniqueEmail('swap-staff1');
    const staff2Email = uniqueEmail('swap-staff2');
    const outsiderEmail = uniqueEmail('swap-outsider');

    const ownerId = await createVerifiedUser(ownerEmail, 'OwnerPass123#');
    const managerId = await createVerifiedUser(managerEmail, 'ManagerPass123#');
    const staff1Id = await createVerifiedUser(staff1Email, 'StaffPass123#');
    const staff2Id = await createVerifiedUser(staff2Email, 'StaffPass123#');
    outsiderId = await createVerifiedUser(outsiderEmail, 'OutsiderPass123#');

    const db = globalDb();
    await db.users.update({ where: { id: ownerId }, data: { display_name: 'Owner User' } });
    await db.users.update({ where: { id: managerId }, data: { display_name: 'Manager User' } });
    await db.users.update({ where: { id: staff1Id }, data: { display_name: 'Staff One' } });
    await db.users.update({ where: { id: staff2Id }, data: { display_name: 'Staff Two' } });
    await db.users.update({ where: { id: outsiderId }, data: { display_name: 'Outsider User' } });

    const ownerToken = await signAccessToken(ownerId);
    const managerToken = await signAccessToken(managerId);
    const staff1Token = await signAccessToken(staff1Id);
    const staff2Token = await signAccessToken(staff2Id);
    const outsiderToken = await signAccessToken(outsiderId);

    const ownerAuth = { authorization: `Bearer ${ownerToken}` };
    const managerAuth = { authorization: `Bearer ${managerToken}` };
    const staff1Auth = { authorization: `Bearer ${staff1Token}` };
    const staff2Auth = { authorization: `Bearer ${staff2Token}` };
    outsiderAuth = { authorization: `Bearer ${outsiderToken}` };

    const teamId = await createTeamFor(ownerAuth, 'Swaps Test Team');
    await addMember(teamId, managerId, 'manager');
    await addMember(teamId, staff1Id, 'staff');
    await addMember(teamId, staff2Id, 'staff');

    f = {
      ownerId,
      managerId,
      staff1Id,
      staff2Id,
      ownerAuth,
      managerAuth,
      staff1Auth,
      staff2Auth,
      teamId,
    };
  });

  afterAll(async () => {
    await shutdownAuthTest();
  });

  it('requires Idempotency-Key header on swap request', async () => {
    const shiftId = await createShift(f, f.staff1Id);
    const res = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId },
      f.staff1Auth,
    );
    expect(res.status).toBe(400);
    const err = await errorOf(res);
    expect(err.code).toBe('idempotency.missing');
  });

  it('allows shift assignee (Staff 1) to request a swap with a target colleague (Staff 2)', async () => {
    const shiftId = await createShift(f, f.staff1Id);
    const key = randomUUID();
    const res = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId, targetUserId: f.staff2Id },
      { ...f.staff1Auth, 'idempotency-key': key },
    );
    expect(res.status).toBe(201);
    const swap = await dataOf(res);
    expect(swap.status).toBe('pending');
    expect(swap.shiftId).toBe(shiftId);
    expect(swap.requestedBy).toBe(f.staff1Id);
    expect(swap.targetUserId).toBe(f.staff2Id);

    // Verify activity event was written
    const events = await forTeam(f.teamId).activity_events.findMany({
      where: { team_id: f.teamId, kind: 'swap.requested', subject_id: swap.id as string },
    });
    expect(events.length).toBe(1);
    expect(events[0]?.actor_user_id).toBe(f.staff1Id);
  });

  it('replays identical swap request on duplicate idempotency key', async () => {
    const shiftId = await createShift(f, f.staff1Id);
    const key = randomUUID();
    const res1 = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId, targetUserId: f.staff2Id },
      { ...f.staff1Auth, 'idempotency-key': key },
    );
    expect(res1.status).toBe(201);
    const swap1 = await dataOf(res1);

    const res2 = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId, targetUserId: f.staff2Id },
      { ...f.staff1Auth, 'idempotency-key': key },
    );
    expect(res2.status).toBe(201);
    const swap2 = await dataOf(res2);
    expect(swap2.id).toBe(swap1.id);
  });

  it('returns 409 when an idempotency key is currently in_flight', async () => {
    const shiftId = await createShift(f, f.staff1Id);
    const key = randomUUID();
    const scope = `request_swap:${f.teamId}:${f.staff1Id}`;
    const fp = fingerprint(JSON.stringify({ shiftId, targetUserId: null, note: null }));

    await forTeam(f.teamId).idempotency_keys.create({
      data: {
        scope,
        key,
        request_fingerprint: fp,
        state: 'in_flight',
      },
    });

    const res = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId },
      { ...f.staff1Auth, 'idempotency-key': key },
    );
    expect(res.status).toBe(409);
    const err = await errorOf(res);
    expect(err.code).toBe('idempotency.in_flight');

    await forTeam(f.teamId).idempotency_keys.delete({
      where: { scope_key: { scope, key } },
    });
  });

  it('handles simultaneous duplicate swap requests without 500 (returns 201 or 409 in_flight)', async () => {
    const shiftId = await createShift(f, f.staff1Id);
    const key = randomUUID();
    const payload = { shiftId, targetUserId: f.staff2Id };

    const [resA, resB] = await Promise.all([
      post(app, `/teams/${f.teamId}/swaps`, payload, { ...f.staff1Auth, 'idempotency-key': key }),
      post(app, `/teams/${f.teamId}/swaps`, payload, { ...f.staff1Auth, 'idempotency-key': key }),
    ]);

    expect(resA.status).not.toBe(500);
    expect(resB.status).not.toBe(500);

    const statuses = [resA.status, resB.status].sort();
    expect([[201, 201], [201, 409]]).toContainEqual(statuses);

    const swaps = await forTeam(f.teamId).swap_requests.findMany({
      where: { shift_id: shiftId },
    });
    expect(swaps).toHaveLength(1);
  });

  it('rejects idempotency key reuse with mismatched payload', async () => {
    const shiftId = await createShift(f, f.staff1Id);
    const key = randomUUID();
    const res1 = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId },
      { ...f.staff1Auth, 'idempotency-key': key },
    );
    expect(res1.status).toBe(201);

    const res2 = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId, targetUserId: f.staff2Id },
      { ...f.staff1Auth, 'idempotency-key': key },
    );
    expect(res2.status).toBe(422);
    const err = await errorOf(res2);
    expect(err.code).toBe('idempotency.fingerprint_mismatch');
  });

  it('enforces one-pending-swap constraint at database level (swaps_one_pending_idx)', async () => {
    const shiftId = await createShift(f, f.staff1Id);
    const res1 = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    expect(res1.status).toBe(201);

    // Second request with different key must fail with 409
    const res2 = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId, targetUserId: f.staff2Id },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    expect(res2.status).toBe(409);
    const err = await errorOf(res2);
    expect(err.code).toBe('swap.already_pending');
  });

  it('refuses swap request from a user who is not the assignee', async () => {
    const shiftId = await createShift(f, f.staff1Id);
    const res = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId },
      { ...f.staff2Auth, 'idempotency-key': randomUUID() },
    );
    expect(res.status).toBe(403);
  });

  it('refuses swap request naming an invalid or cross-team target', async () => {
    const shiftId = await createShift(f, f.staff1Id);
    const res = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId, targetUserId: outsiderId },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    expect(res.status).toBe(422);
    const err = await errorOf(res);
    expect(err.code).toBe('swap.target_invalid');
  });

  it('refuses self-swap request', async () => {
    const shiftId = await createShift(f, f.staff1Id);
    const res = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId, targetUserId: f.staff1Id },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    expect(res.status).toBe(422);
    const err = await errorOf(res);
    expect(err.code).toBe('swap.self_swap');
  });

  it('refuses swap request on a shift in the past', async () => {
    const pastStartsAt = new Date(Date.now() - 5 * 60 * 60 * 1_000);
    const pastEndsAt = new Date(Date.now() - 1 * 60 * 60 * 1_000);
    const client = forTeam(f.teamId);
    const pastShift = await client.shifts.create({
      data: {
        team_id: f.teamId,
        assigned_user_id: f.staff1Id,
        starts_at: pastStartsAt,
        ends_at: pastEndsAt,
        label: 'Yesterday shift',
        created_by: f.ownerId,
      },
    });

    const res = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId: pastShift.id },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    expect(res.status).toBe(422);
    const err = await errorOf(res);
    expect(err.code).toBe('swap.shift.inPast');
  });

  it('refuses decide (approve/reject) from Staff (403 team.forbidden)', async () => {
    const shiftId = await createShift(f, f.staff1Id);
    const createRes = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId, targetUserId: f.staff2Id },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    const swap = await dataOf(createRes);

    const decideRes = await post(
      app,
      `/teams/${f.teamId}/swaps/${swap.id}/decide`,
      { status: 'approved' },
      f.staff2Auth,
    );
    expect(decideRes.status).toBe(403);
    const err = await errorOf(decideRes);
    expect(err.code).toBe('team.forbidden');
  });

  it('allows Manager to approve swap, atomically reassigning shift and writing activity', async () => {
    const shiftId = await createShift(f, f.staff1Id);
    const createRes = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId, targetUserId: f.staff2Id },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    const swap = await dataOf(createRes);

    const decideRes = await post(
      app,
      `/teams/${f.teamId}/swaps/${swap.id}/decide`,
      { status: 'approved' },
      f.managerAuth,
    );
    expect(decideRes.status).toBe(200);
    const decided = await dataOf(decideRes);
    expect(decided.status).toBe('approved');
    expect(decided.decidedBy).toBe(f.managerId);

    // Verify shift was reassigned to Staff 2
    const shift = await forTeam(f.teamId).shifts.findUnique({ where: { id: shiftId } });
    expect(shift?.assigned_user_id).toBe(f.staff2Id);

    // Verify activity event
    const events = await forTeam(f.teamId).activity_events.findMany({
      where: { team_id: f.teamId, kind: 'swap.approved', subject_id: swap.id as string },
    });
    expect(events.length).toBe(1);
    expect(events[0]?.actor_user_id).toBe(f.managerId);
  });

  it('requires a target colleague on approval if swap was open', async () => {
    const shiftId = await createShift(f, f.staff1Id);
    const createRes = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    const swap = await dataOf(createRes);

    // Approval without target fails
    const failRes = await post(
      app,
      `/teams/${f.teamId}/swaps/${swap.id}/decide`,
      { status: 'approved' },
      f.managerAuth,
    );
    expect(failRes.status).toBe(422);
    const err = await errorOf(failRes);
    expect(err.code).toBe('swap.target_required');

    // Approval with target in decide body succeeds
    const okRes = await post(
      app,
      `/teams/${f.teamId}/swaps/${swap.id}/decide`,
      { status: 'approved', targetUserId: f.staff2Id },
      f.managerAuth,
    );
    expect(okRes.status).toBe(200);
    const decided = await dataOf(okRes);
    expect(decided.status).toBe('approved');
    expect(decided.targetUserId).toBe(f.staff2Id);

    const shift = await forTeam(f.teamId).shifts.findUnique({ where: { id: shiftId } });
    expect(shift?.assigned_user_id).toBe(f.staff2Id);
  });

  it('allows Manager to reject swap, leaving shift assignment unchanged', async () => {
    const shiftId = await createShift(f, f.staff1Id);
    const createRes = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId, targetUserId: f.staff2Id },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    const swap = await dataOf(createRes);

    const rejectRes = await post(
      app,
      `/teams/${f.teamId}/swaps/${swap.id}/decide`,
      { status: 'rejected', declineReason: 'Coverage conflict' },
      f.managerAuth,
    );
    expect(rejectRes.status).toBe(200);
    const decided = await dataOf(rejectRes);
    expect(decided.status).toBe('rejected');

    // Shift stays assigned to Staff 1
    const shift = await forTeam(f.teamId).shifts.findUnique({ where: { id: shiftId } });
    expect(shift?.assigned_user_id).toBe(f.staff1Id);
  });

  it('returns 409 conflict when deciding a swap that was already decided', async () => {
    const shiftId = await createShift(f, f.staff1Id);
    const createRes = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId, targetUserId: f.staff2Id },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    const swap = await dataOf(createRes);

    // Manager 1 decides
    await post(
      app,
      `/teams/${f.teamId}/swaps/${swap.id}/decide`,
      { status: 'rejected' },
      f.managerAuth,
    );

    // Manager 2 attempts to decide
    const retryRes = await post(
      app,
      `/teams/${f.teamId}/swaps/${swap.id}/decide`,
      { status: 'approved', targetUserId: f.staff2Id },
      f.ownerAuth,
    );
    expect(retryRes.status).toBe(409);
    const err = await errorOf(retryRes);
    expect(err.code).toBe('swap.conflict');
  });

  it('handles concurrent decisions with row locking (exactly one 200 and one 409)', async () => {
    const shiftId = await createShift(f, f.staff1Id);
    const createRes = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId, targetUserId: f.staff2Id },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    expect(createRes.status).toBe(201);
    const swap = await dataOf(createRes);

    const [resA, resB] = await Promise.all([
      post(app, `/teams/${f.teamId}/swaps/${swap.id}/decide`, { status: 'approved' }, f.managerAuth),
      post(app, `/teams/${f.teamId}/swaps/${swap.id}/decide`, { status: 'approved' }, f.ownerAuth),
    ]);

    expect(resA.status).not.toBe(500);
    expect(resB.status).not.toBe(500);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const shift = await forTeam(f.teamId).shifts.findUnique({ where: { id: shiftId } });
    expect(shift?.assigned_user_id).toBe(f.staff2Id);

    const events = await forTeam(f.teamId).activity_events.findMany({
      where: { team_id: f.teamId, kind: 'swap.approved', subject_id: swap.id as string },
    });
    expect(events).toHaveLength(1);
  });

  it('allows requester to cancel their own pending swap', async () => {
    const shiftId = await createShift(f, f.staff1Id);
    const createRes = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId, targetUserId: f.staff2Id },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    const swap = await dataOf(createRes);

    const cancelRes = await post(
      app,
      `/teams/${f.teamId}/swaps/${swap.id}/cancel`,
      {},
      f.staff1Auth,
    );
    expect(cancelRes.status).toBe(200);
    const cancelled = await dataOf(cancelRes);
    expect(cancelled.status).toBe('cancelled');

    // After cancellation, another swap can now be requested on the same shift
    const newSwapRes = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId, targetUserId: f.staff2Id },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    expect(newSwapRes.status).toBe(201);
  });

  it('allows requesting a new swap on the same shift after previous swap was cancelled (returns 201)', async () => {
    const shiftId = await createShift(f, f.staff1Id);
    const firstReq = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    expect(firstReq.status).toBe(201);
    const swap1 = await dataOf(firstReq);

    const cancelRes = await post(
      app,
      `/teams/${f.teamId}/swaps/${swap1.id}/cancel`,
      {},
      f.staff1Auth,
    );
    expect(cancelRes.status).toBe(200);

    const secondReq = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    expect(secondReq.status).toBe(201);
    const swap2 = await dataOf(secondReq);
    expect(swap2.id).not.toBe(swap1.id);
    expect(swap2.status).toBe('pending');
  });

  it('refuses cancellation from a different staff member (403 team.forbidden)', async () => {
    const shiftId = await createShift(f, f.staff1Id);
    const createRes = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    const swap = await dataOf(createRes);

    const cancelRes = await post(
      app,
      `/teams/${f.teamId}/swaps/${swap.id}/cancel`,
      {},
      f.staff2Auth,
    );
    expect(cancelRes.status).toBe(403);
  });

  it('enforces team isolation (404) across all swap endpoints for non-members', async () => {
    const shiftId = await createShift(f, f.staff1Id);
    const createRes = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    const swap = await dataOf(createRes);

    // List swaps
    const listRes = await get(`/teams/${f.teamId}/swaps`, outsiderAuth);
    expect(listRes.status).toBe(404);

    // Get swap
    const getRes = await get(`/teams/${f.teamId}/swaps/${swap.id}`, outsiderAuth);
    expect(getRes.status).toBe(404);

    // Request swap
    const reqRes = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId },
      { ...outsiderAuth, 'idempotency-key': randomUUID() },
    );
    expect(reqRes.status).toBe(404);

    // Decide swap
    const decideRes = await post(
      app,
      `/teams/${f.teamId}/swaps/${swap.id}/decide`,
      { status: 'approved', targetUserId: f.staff2Id },
      outsiderAuth,
    );
    expect(decideRes.status).toBe(404);

    // Cancel swap
    const cancelRes = await post(
      app,
      `/teams/${f.teamId}/swaps/${swap.id}/cancel`,
      {},
      outsiderAuth,
    );
    expect(cancelRes.status).toBe(404);
  });

  it('refuses approval if shift was reassigned between request and approval (409 swap.assignee_changed)', async () => {
    const shiftId = await createShift(f, f.staff1Id);
    const createRes = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId, targetUserId: f.staff2Id },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    expect(createRes.status).toBe(201);
    const swap = await dataOf(createRes);

    // Reassign shift directly to manager before approval takes place
    await forTeam(f.teamId).shifts.update({
      where: { id: shiftId },
      data: { assigned_user_id: f.managerId },
    });

    // Manager attempts to approve the stale swap
    const approveRes = await post(
      app,
      `/teams/${f.teamId}/swaps/${swap.id}/decide`,
      { status: 'approved' },
      f.managerAuth,
    );
    expect(approveRes.status).toBe(409);
    const err = await errorOf(approveRes);
    expect(err.code).toBe('swap.assignee_changed');

    // Shift remains assigned to manager
    const shift = await forTeam(f.teamId).shifts.findUnique({ where: { id: shiftId } });
    expect(shift?.assigned_user_id).toBe(f.managerId);

    // Swap remains pending
    const swapAfter = await forTeam(f.teamId).swap_requests.findUnique({ where: { id: swap.id as string } });
    expect(swapAfter?.status).toBe('pending');

    // No swap.approved activity event was written
    const events = await forTeam(f.teamId).activity_events.findMany({
      where: { team_id: f.teamId, kind: 'swap.approved', subject_id: swap.id as string },
    });
    expect(events.length).toBe(0);
  });

  it('refuses approval if requester was removed from team after creating swap request (409 swap.requester_removed)', async () => {
    // Create an extra staff member so we can remove them safely
    const extraEmail = uniqueEmail('swap-extra-staff');
    const extraId = await createVerifiedUser(extraEmail, 'ExtraPass123#');
    await globalDb().users.update({ where: { id: extraId }, data: { display_name: 'Extra Staff' } });
    const extraToken = await signAccessToken(extraId);
    const extraAuth = { authorization: `Bearer ${extraToken}` };
    await addMember(f.teamId, extraId, 'staff');

    const shiftId = await createShift(f, extraId);
    const createRes = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId, targetUserId: f.staff2Id },
      { ...extraAuth, 'idempotency-key': randomUUID() },
    );
    expect(createRes.status).toBe(201);
    const swap = await dataOf(createRes);

    // Mark extra staff member as removed
    await forTeam(f.teamId).memberships.update({
      where: { team_id_user_id: { team_id: f.teamId, user_id: extraId } },
      data: { removed_at: new Date() },
    });

    // Manager attempts to approve the swap
    const approveRes = await post(
      app,
      `/teams/${f.teamId}/swaps/${swap.id}/decide`,
      { status: 'approved' },
      f.managerAuth,
    );
    expect(approveRes.status).toBe(409);
    const err = await errorOf(approveRes);
    expect(err.code).toBe('swap.requester_removed');

    // Shift assignment and swap status remain unchanged
    const shift = await forTeam(f.teamId).shifts.findUnique({ where: { id: shiftId } });
    expect(shift?.assigned_user_id).toBe(extraId);
    const swapAfter = await forTeam(f.teamId).swap_requests.findUnique({ where: { id: swap.id as string } });
    expect(swapAfter?.status).toBe('pending');
  });

  it('refuses swap approval and rejection if the shift was deleted (409 swap.shift_deleted) [D4]', async () => {
    const shiftId = await createShift(f, f.staff1Id);
    const createRes = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId, targetUserId: f.staff2Id },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    expect(createRes.status).toBe(201);
    const swap = await dataOf(createRes);

    // Soft-delete the shift
    await forTeam(f.teamId).shifts.update({
      where: { id: shiftId },
      data: { deleted_at: new Date(), deleted_by: f.ownerId },
    });

    // Manager attempts to approve
    const approveRes = await post(
      app,
      `/teams/${f.teamId}/swaps/${swap.id}/decide`,
      { status: 'approved' },
      f.managerAuth,
    );
    expect(approveRes.status).toBe(409);
    const approveErr = await errorOf(approveRes);
    expect(approveErr.code).toBe('swap.shift_deleted');

    // Manager attempts to reject
    const rejectRes = await post(
      app,
      `/teams/${f.teamId}/swaps/${swap.id}/decide`,
      { status: 'rejected', declineReason: 'Coverage conflict' },
      f.managerAuth,
    );
    expect(rejectRes.status).toBe(409);
    const rejectErr = await errorOf(rejectRes);
    expect(rejectErr.code).toBe('swap.shift_deleted');

    // Swap remains pending
    const swapAfter = await forTeam(f.teamId).swap_requests.findUnique({ where: { id: swap.id as string } });
    expect(swapAfter?.status).toBe('pending');
  });

  it('allows cancellation of a pending swap even if the shift was deleted [D5]', async () => {
    const shiftId = await createShift(f, f.staff1Id);
    const createRes = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId, targetUserId: f.staff2Id },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    expect(createRes.status).toBe(201);
    const swap = await dataOf(createRes);

    // Soft-delete the shift
    await forTeam(f.teamId).shifts.update({
      where: { id: shiftId },
      data: { deleted_at: new Date(), deleted_by: f.ownerId },
    });

    // Requester cancels swap
    const cancelRes = await post(
      app,
      `/teams/${f.teamId}/swaps/${swap.id}/cancel`,
      {},
      f.staff1Auth,
    );
    expect(cancelRes.status).toBe(200);
    const cancelled = await dataOf(cancelRes);
    expect(cancelled.status).toBe('cancelled');

    // Verify DB row
    const swapAfter = await forTeam(f.teamId).swap_requests.findUnique({ where: { id: swap.id as string } });
    expect(swapAfter?.status).toBe('cancelled');
  });

  it('exposes shiftDeleted: true on list and getSwap when shift is deleted', async () => {
    const shiftId = await createShift(f, f.staff1Id);
    const createRes = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId, targetUserId: f.staff2Id },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    expect(createRes.status).toBe(201);
    const swap = await dataOf(createRes);

    // Soft-delete the shift
    await forTeam(f.teamId).shifts.update({
      where: { id: shiftId },
      data: { deleted_at: new Date(), deleted_by: f.ownerId },
    });

    // Get single swap
    const getRes = await get(`/teams/${f.teamId}/swaps/${swap.id}`, f.staff1Auth);
    expect(getRes.status).toBe(200);
    const singleData = await dataOf(getRes);
    expect(singleData.shiftDeleted).toBe(true);
    expect(singleData.shiftLabel).toBeDefined();

    // List swaps
    const listRes = await get(`/teams/${f.teamId}/swaps`, f.staff1Auth);
    expect(listRes.status).toBe(200);
    const listData = (await dataOf(listRes)) as { swaps: Array<{ id: string; shiftDeleted?: boolean }> };
    const found = listData.swaps.find((s) => s.id === swap.id);
    expect(found?.shiftDeleted).toBe(true);
  });

  describe('Swap v2: notes, decline reasons, cancellation audit, activity audience', () => {
    it('enforces declineReason rules on decideSwap (reject requires 1-140 chars; approve forbids it)', async () => {
      const shiftId = await createShift(f, f.staff1Id);
      const createRes = await post(
        app,
        `/teams/${f.teamId}/swaps`,
        { shiftId, targetUserId: f.staff2Id },
        { ...f.staff1Auth, 'idempotency-key': randomUUID() },
      );
      expect(createRes.status).toBe(201);
      const swap = await dataOf(createRes);

      // 1. Reject without declineReason -> 422
      const resNoReason = await post(
        app,
        `/teams/${f.teamId}/swaps/${swap.id}/decide`,
        { status: 'rejected' },
        f.managerAuth,
      );
      expect(resNoReason.status).toBe(422);
      const errNoReason = await errorOf(resNoReason);
      expect(errNoReason.code).toBe('validation.invalid');

      // 2. Reject with whitespace-only declineReason -> 422
      const resWhitespace = await post(
        app,
        `/teams/${f.teamId}/swaps/${swap.id}/decide`,
        { status: 'rejected', declineReason: '    ' },
        f.managerAuth,
      );
      expect(resWhitespace.status).toBe(422);

      // 3. Reject with 141 chars -> 422
      const res141 = await post(
        app,
        `/teams/${f.teamId}/swaps/${swap.id}/decide`,
        { status: 'rejected', declineReason: 'x'.repeat(141) },
        f.managerAuth,
      );
      expect(res141.status).toBe(422);

      // 4. Approve with declineReason -> 422
      const resApproveWithReason = await post(
        app,
        `/teams/${f.teamId}/swaps/${swap.id}/decide`,
        { status: 'approved', declineReason: 'Valid text but not allowed on approve' },
        f.managerAuth,
      );
      expect(resApproveWithReason.status).toBe(422);

      // 5. Exactly 140 chars -> ok and stored
      const valid140Reason = 'x'.repeat(140);
      const res140 = await post(
        app,
        `/teams/${f.teamId}/swaps/${swap.id}/decide`,
        { status: 'rejected', declineReason: valid140Reason },
        f.managerAuth,
      );
      expect(res140.status).toBe(200);
      const decided = await dataOf(res140);
      expect(decided.status).toBe('rejected');
      expect(decided.declineReason).toBe(valid140Reason);

      // Verify stored in DB
      const row = await forTeam(f.teamId).swap_requests.findUnique({
        where: { id: swap.id as string },
      });
      expect(row?.decline_reason).toBe(valid140Reason);
    });

    it('stores request note and exposes it to requester, target and Manager, but NOT to an unrelated Staff member', async () => {
      // Add third staff member to the team
      const staff3Email = uniqueEmail('swap-staff3');
      const staff3Id = await createVerifiedUser(staff3Email, 'Staff3Pass123#');
      const staff3Token = await signAccessToken(staff3Id);
      const staff3Auth = { authorization: `Bearer ${staff3Token}` };
      await addMember(f.teamId, staff3Id, 'staff');

      const shiftId = await createShift(f, f.staff1Id);
      const noteText = 'Doctor appointment in the afternoon';
      const createRes = await post(
        app,
        `/teams/${f.teamId}/swaps`,
        { shiftId, targetUserId: f.staff2Id, note: `  ${noteText}  ` },
        { ...f.staff1Auth, 'idempotency-key': randomUUID() },
      );
      expect(createRes.status).toBe(201);
      const swap = await dataOf(createRes);
      expect(swap.note).toBe(noteText);

      // Stored in database trimmed
      const dbSwap = await forTeam(f.teamId).swap_requests.findUnique({
        where: { id: swap.id as string },
      });
      expect(dbSwap?.note).toBe(noteText);

      // 1. Requester sees note
      const reqRes = await get(`/teams/${f.teamId}/swaps/${swap.id}`, f.staff1Auth);
      expect(reqRes.status).toBe(200);
      const reqData = await dataOf(reqRes);
      expect(reqData.note).toBe(noteText);

      // 2. Target colleague sees note
      const targetRes = await get(`/teams/${f.teamId}/swaps/${swap.id}`, f.staff2Auth);
      expect(targetRes.status).toBe(200);
      const targetData = await dataOf(targetRes);
      expect(targetData.note).toBe(noteText);

      // 3. Manager sees note
      const mgrRes = await get(`/teams/${f.teamId}/swaps/${swap.id}`, f.managerAuth);
      expect(mgrRes.status).toBe(200);
      const mgrData = await dataOf(mgrRes);
      expect(mgrData.note).toBe(noteText);

      // 4. Unrelated Staff (Staff 3) does NOT see note
      const staff3Res = await get(`/teams/${f.teamId}/swaps/${swap.id}`, staff3Auth);
      expect(staff3Res.status).toBe(200);
      const staff3Data = await dataOf(staff3Res);
      expect(staff3Data.note).toBeUndefined();

      // 5. List swaps: requester sees note, unrelated staff does not
      const listReqRes = await get(`/teams/${f.teamId}/swaps`, f.staff1Auth);
      const listReqData = (await dataOf(listReqRes)) as { swaps: Array<{ id: string; note?: string }> };
      const foundReq = listReqData.swaps.find((s) => s.id === swap.id);
      expect(foundReq?.note).toBe(noteText);

      const listStaff3Res = await get(`/teams/${f.teamId}/swaps`, staff3Auth);
      const listStaff3Data = (await dataOf(listStaff3Res)) as { swaps: Array<{ id: string; note?: string }> };
      const foundStaff3 = listStaff3Data.swaps.find((s) => s.id === swap.id);
      expect(foundStaff3?.note).toBeUndefined();
    });

    it('handles idempotency fingerprint with note: different note gives 422, identical retry replays 201', async () => {
      const shiftId = await createShift(f, f.staff1Id);
      const key = randomUUID();

      // 1. Initial request with note
      const res1 = await post(
        app,
        `/teams/${f.teamId}/swaps`,
        { shiftId, targetUserId: f.staff2Id, note: 'Need shift covered' },
        { ...f.staff1Auth, 'idempotency-key': key },
      );
      expect(res1.status).toBe(201);
      const swap1 = await dataOf(res1);
      expect(swap1.note).toBe('Need shift covered');

      // 2. Same idempotency key with different note -> 422 fingerprint_mismatch
      const resDiffNote = await post(
        app,
        `/teams/${f.teamId}/swaps`,
        { shiftId, targetUserId: f.staff2Id, note: 'Changed mind about reason' },
        { ...f.staff1Auth, 'idempotency-key': key },
      );
      expect(resDiffNote.status).toBe(422);
      const diffErr = await errorOf(resDiffNote);
      expect(diffErr.code).toBe('idempotency.fingerprint_mismatch');

      // 3. Identical retry with same key and same note -> 201 replay with same body
      const resRetry = await post(
        app,
        `/teams/${f.teamId}/swaps`,
        { shiftId, targetUserId: f.staff2Id, note: 'Need shift covered' },
        { ...f.staff1Auth, 'idempotency-key': key },
      );
      expect(resRetry.status).toBe(201);
      const swapRetry = await dataOf(resRetry);
      expect(swapRetry.id).toBe(swap1.id);
      expect(swapRetry.note).toBe(swap1.note);
    });

    it('rejects request note of 141 characters with 422', async () => {
      const shiftId = await createShift(f, f.staff1Id);
      const res = await post(
        app,
        `/teams/${f.teamId}/swaps`,
        { shiftId, note: 'n'.repeat(141) },
        { ...f.staff1Auth, 'idempotency-key': randomUUID() },
      );
      expect(res.status).toBe(422);
      const err = await errorOf(res);
      expect(err.code).toBe('validation.invalid');
    });

    it('sets cancelled_by and cancelled_at on cancel, and a second cancel returns 409', async () => {
      const shiftId = await createShift(f, f.staff1Id);
      const createRes = await post(
        app,
        `/teams/${f.teamId}/swaps`,
        { shiftId, targetUserId: f.staff2Id },
        { ...f.staff1Auth, 'idempotency-key': randomUUID() },
      );
      expect(createRes.status).toBe(201);
      const swap = await dataOf(createRes);

      // Cancel by requester
      const cancelRes = await post(
        app,
        `/teams/${f.teamId}/swaps/${swap.id}/cancel`,
        {},
        f.staff1Auth,
      );
      expect(cancelRes.status).toBe(200);
      const cancelledView = await dataOf(cancelRes);
      expect(cancelledView.status).toBe('cancelled');
      expect(cancelledView.cancelledBy).toBe(f.staff1Id);
      expect(cancelledView.cancelledAt).toBeDefined();

      // Stored in database
      const dbSwap = await forTeam(f.teamId).swap_requests.findUnique({
        where: { id: swap.id as string },
      });
      expect(dbSwap?.cancelled_by).toBe(f.staff1Id);
      expect(dbSwap?.cancelled_at).toBeDefined();

      // Second cancel attempt -> 409 swap.cannot_cancel
      const secondCancelRes = await post(
        app,
        `/teams/${f.teamId}/swaps/${swap.id}/cancel`,
        {},
        f.staff1Auth,
      );
      expect(secondCancelRes.status).toBe(409);
      const secondErr = await errorOf(secondCancelRes);
      expect(secondErr.code).toBe('swap.cannot_cancel');
    });

    it('writes activity rows for shift.* (team), swap.* (involved), and team.* (managers)', async () => {
      // 1. Shift activity -> audience: 'team'
      const shiftId = await createShift(f, f.staff1Id);
      const shiftEvents = await forTeam(f.teamId).activity_events.findMany({
        where: { kind: 'shift.created', subject_id: shiftId },
      });
      expect(shiftEvents.length).toBeGreaterThan(0);
      expect(shiftEvents[0]?.audience).toBe('team');

      // 2. Swap activity -> audience: 'involved'
      const createRes = await post(
        app,
        `/teams/${f.teamId}/swaps`,
        { shiftId, targetUserId: f.staff2Id },
        { ...f.staff1Auth, 'idempotency-key': randomUUID() },
      );
      const swap = await dataOf(createRes);
      const swapEvents = await forTeam(f.teamId).activity_events.findMany({
        where: { kind: 'swap.requested', subject_id: swap.id as string },
      });
      expect(swapEvents.length).toBeGreaterThan(0);
      expect(swapEvents[0]?.audience).toBe('involved');

      // 3. Team activity -> audience: 'managers'
      // Transfer ownership to test team.transferred event
      const transferRes = await post(
        app,
        `/teams/${f.teamId}/transfer`,
        { targetUserId: f.managerId },
        f.ownerAuth,
      );
      expect(transferRes.status).toBe(200);
      const teamEvents = await forTeam(f.teamId).activity_events.findMany({
        where: { kind: 'team.transferred', team_id: f.teamId },
      });
      expect(teamEvents.length).toBeGreaterThan(0);
      expect(teamEvents[0]?.audience).toBe('managers');

      // Transfer back so fixture remains intact
      await post(
        app,
        `/teams/${f.teamId}/transfer`,
        { targetUserId: f.ownerId },
        f.managerAuth,
      );
    });

    it('reject path still refunds nothing and changes no shift assignment', async () => {
      const shiftId = await createShift(f, f.staff1Id);
      const createRes = await post(
        app,
        `/teams/${f.teamId}/swaps`,
        { shiftId, targetUserId: f.staff2Id },
        { ...f.staff1Auth, 'idempotency-key': randomUUID() },
      );
      expect(createRes.status).toBe(201);
      const swap = await dataOf(createRes);

      // Ledger before
      const ledgerBefore = await forTeam(f.teamId).ledger_entries.findMany({
        where: { team_id: f.teamId },
      });

      const rejectRes = await post(
        app,
        `/teams/${f.teamId}/swaps/${swap.id}/decide`,
        { status: 'rejected', declineReason: 'Schedule conflict' },
        f.managerAuth,
      );
      expect(rejectRes.status).toBe(200);

      // Shift stays assigned to requester
      const shiftAfter = await forTeam(f.teamId).shifts.findUnique({
        where: { id: shiftId },
      });
      expect(shiftAfter?.assigned_user_id).toBe(f.staff1Id);

      // Ledger untouched (refunds nothing)
      const ledgerAfter = await forTeam(f.teamId).ledger_entries.findMany({
        where: { team_id: f.teamId },
      });
      expect(ledgerAfter.length).toBe(ledgerBefore.length);
    });
  });
});
