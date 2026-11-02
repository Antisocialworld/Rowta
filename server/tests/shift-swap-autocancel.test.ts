// shift-swap-autocancel.test.ts — verifies automatic cancellation of pending swaps on shift reassign or delete (PRD 8.5; rules S6, S7, S8, C4, D4).
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { forTeam, globalDb } from '../src/db/clients.ts';
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

interface Fixture {
  ownerId: string;
  managerId: string;
  staff1Id: string;
  staff2Id: string;
  staff3Id: string;
  ownerAuth: { authorization: string };
  managerAuth: { authorization: string };
  staff1Auth: { authorization: string };
  staff2Auth: { authorization: string };
  staff3Auth: { authorization: string };
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
      label: 'Standard Shift',
      notes: 'Initial duties',
      ...overrides,
    },
    { ...f.ownerAuth, 'idempotency-key': randomUUID() },
  );
  expect(res.status).toBe(201);
  return (await dataOf(res)).id as string;
}

describe('Shift swap auto-cancellation on reassign or delete', () => {
  let f: Fixture;

  beforeAll(async () => {
    await clearRateKeys();
    await ensureTestCountries();
    app = testApp('shift-swap-autocancel');

    const ownerEmail = uniqueEmail('autocancel-owner');
    const managerEmail = uniqueEmail('autocancel-manager');
    const staff1Email = uniqueEmail('autocancel-staff1');
    const staff2Email = uniqueEmail('autocancel-staff2');
    const staff3Email = uniqueEmail('autocancel-staff3');

    const ownerId = await createVerifiedUser(ownerEmail, 'OwnerPass123#');
    const managerId = await createVerifiedUser(managerEmail, 'ManagerPass123#');
    const staff1Id = await createVerifiedUser(staff1Email, 'StaffPass123#');
    const staff2Id = await createVerifiedUser(staff2Email, 'StaffPass123#');
    const staff3Id = await createVerifiedUser(staff3Email, 'StaffPass123#');

    const db = globalDb();
    await db.users.update({ where: { id: ownerId }, data: { display_name: 'Owner User' } });
    await db.users.update({ where: { id: managerId }, data: { display_name: 'Manager User' } });
    await db.users.update({ where: { id: staff1Id }, data: { display_name: 'Staff One' } });
    await db.users.update({ where: { id: staff2Id }, data: { display_name: 'Staff Two' } });
    await db.users.update({ where: { id: staff3Id }, data: { display_name: 'Staff Three' } });

    const ownerAuth = { authorization: `Bearer ${await signAccessToken(ownerId)}` };
    const managerAuth = { authorization: `Bearer ${await signAccessToken(managerId)}` };
    const staff1Auth = { authorization: `Bearer ${await signAccessToken(staff1Id)}` };
    const staff2Auth = { authorization: `Bearer ${await signAccessToken(staff2Id)}` };
    const staff3Auth = { authorization: `Bearer ${await signAccessToken(staff3Id)}` };

    const teamId = await createTeamFor(ownerAuth, 'AutoCancel Team');
    await addMember(teamId, managerId, 'manager');
    await addMember(teamId, staff1Id, 'staff');
    await addMember(teamId, staff2Id, 'staff');
    await addMember(teamId, staff3Id, 'staff');

    f = {
      ownerId,
      managerId,
      staff1Id,
      staff2Id,
      staff3Id,
      ownerAuth,
      managerAuth,
      staff1Auth,
      staff2Auth,
      staff3Auth,
      teamId,
    };
  });

  afterAll(async () => {
    await shutdownAuthTest();
  });

  // (a) reassign cancels the pending swap, sets cancelled_by/cancelled_at, and the NEW assignee can then request a swap (no 409)
  it('(a) reassign cancels the pending swap and allows new assignee to request swap without 409', async () => {
    const shiftId = await createShift(f, f.staff1Id);

    const swapRes = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId, targetUserId: f.staff2Id },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    expect(swapRes.status).toBe(201);
    const swap = await dataOf(swapRes);

    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1_000);
    const endsAt = new Date(startsAt.getTime() + 4 * 60 * 60 * 1_000);

    // Reassign shift to staff2 via Manager update
    const updateRes = await post(
      app,
      `/teams/${f.teamId}/shifts/${shiftId}/update`,
      {
        assignedUserId: f.staff2Id,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        label: 'Reassigned Shift',
      },
      f.managerAuth,
    );
    expect(updateRes.status).toBe(200);

    // Swap row in DB is now cancelled
    const swapAfter = await forTeam(f.teamId).swap_requests.findUnique({
      where: { id: swap.id as string },
    });
    expect(swapAfter?.status).toBe('cancelled');
    expect(swapAfter?.cancelled_by).toBe(f.managerId);
    expect(swapAfter?.cancelled_at).not.toBeNull();

    // The NEW assignee (staff2) can now request a swap on the same shift without 409 already_pending
    const newSwapRes = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId, targetUserId: f.staff3Id },
      { ...f.staff2Auth, 'idempotency-key': randomUUID() },
    );
    expect(newSwapRes.status).toBe(201);
    const newSwap = await dataOf(newSwapRes);
    expect(newSwap.status).toBe('pending');
    expect(newSwap.requestedBy).toBe(f.staff2Id);
  });

  // (b) delete cancels it
  it('(b) deleting a shift cancels its pending swap with cancelled_by and cancelled_at', async () => {
    const shiftId = await createShift(f, f.staff1Id);

    const swapRes = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId, targetUserId: f.staff2Id },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    expect(swapRes.status).toBe(201);
    const swap = await dataOf(swapRes);

    // Delete shift via Manager delete
    const deleteRes = await post(
      app,
      `/teams/${f.teamId}/shifts/${shiftId}/delete`,
      undefined,
      f.managerAuth,
    );
    expect(deleteRes.status).toBe(200);

    // Swap row in DB is now cancelled
    const swapAfter = await forTeam(f.teamId).swap_requests.findUnique({
      where: { id: swap.id as string },
    });
    expect(swapAfter?.status).toBe('cancelled');
    expect(swapAfter?.cancelled_by).toBe(f.managerId);
    expect(swapAfter?.cancelled_at).not.toBeNull();
  });

  // (c) an edit that does not change the assignee leaves it pending
  it('(c) editing a shift without changing the assignee leaves the swap pending', async () => {
    const shiftId = await createShift(f, f.staff1Id);

    const swapRes = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId, targetUserId: f.staff2Id },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    expect(swapRes.status).toBe(201);
    const swap = await dataOf(swapRes);

    const startsAt = new Date(Date.now() + 25 * 60 * 60 * 1_000);
    const endsAt = new Date(startsAt.getTime() + 5 * 60 * 60 * 1_000);

    // Manager updates time, label, notes but keeps assignee as staff1
    const updateRes = await post(
      app,
      `/teams/${f.teamId}/shifts/${shiftId}/update`,
      {
        assignedUserId: f.staff1Id,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        label: 'Changed Label Only',
        notes: 'Updated notes',
      },
      f.managerAuth,
    );
    expect(updateRes.status).toBe(200);

    // Swap row remains pending
    const swapAfter = await forTeam(f.teamId).swap_requests.findUnique({
      where: { id: swap.id as string },
    });
    expect(swapAfter?.status).toBe('pending');
    expect(swapAfter?.cancelled_by).toBeNull();
    expect(swapAfter?.cancelled_at).toBeNull();
  });

  // (d) approved/rejected/cancelled swaps are untouched
  it('(d) approved, rejected, and user-cancelled swaps are untouched when shift is reassigned', async () => {
    // 1. Approved swap
    const shift1Id = await createShift(f, f.staff1Id);
    const swap1Res = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId: shift1Id, targetUserId: f.staff2Id },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    const swap1 = await dataOf(swap1Res);
    const approveRes = await post(
      app,
      `/teams/${f.teamId}/swaps/${swap1.id}/decide`,
      { status: 'approved' },
      f.managerAuth,
    );
    expect(approveRes.status).toBe(200);

    // Reassign shift1 to staff3
    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1_000);
    const endsAt = new Date(startsAt.getTime() + 4 * 60 * 60 * 1_000);
    await post(
      app,
      `/teams/${f.teamId}/shifts/${shift1Id}/update`,
      {
        assignedUserId: f.staff3Id,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        label: 'Shift 1',
      },
      f.ownerAuth,
    );
    const swap1After = await forTeam(f.teamId).swap_requests.findUnique({ where: { id: swap1.id as string } });
    expect(swap1After?.status).toBe('approved');
    expect(swap1After?.cancelled_by).toBeNull();

    // 2. Rejected swap
    const shift2Id = await createShift(f, f.staff1Id);
    const swap2Res = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId: shift2Id, targetUserId: f.staff2Id },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    const swap2 = await dataOf(swap2Res);
    const rejectRes = await post(
      app,
      `/teams/${f.teamId}/swaps/${swap2.id}/decide`,
      { status: 'rejected', declineReason: 'Coverage need' },
      f.managerAuth,
    );
    expect(rejectRes.status).toBe(200);

    // Reassign shift2 to staff3
    await post(
      app,
      `/teams/${f.teamId}/shifts/${shift2Id}/update`,
      {
        assignedUserId: f.staff3Id,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        label: 'Shift 2',
      },
      f.ownerAuth,
    );
    const swap2After = await forTeam(f.teamId).swap_requests.findUnique({ where: { id: swap2.id as string } });
    expect(swap2After?.status).toBe('rejected');
    expect(swap2After?.cancelled_by).toBeNull();

    // 3. User-cancelled swap
    const shift3Id = await createShift(f, f.staff1Id);
    const swap3Res = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId: shift3Id, targetUserId: f.staff2Id },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    const swap3 = await dataOf(swap3Res);
    const cancelRes = await post(
      app,
      `/teams/${f.teamId}/swaps/${swap3.id}/cancel`,
      {},
      f.staff1Auth,
    );
    expect(cancelRes.status).toBe(200);

    // Reassign shift3 to staff3
    await post(
      app,
      `/teams/${f.teamId}/shifts/${shift3Id}/update`,
      {
        assignedUserId: f.staff3Id,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        label: 'Shift 3',
      },
      f.ownerAuth,
    );
    const swap3After = await forTeam(f.teamId).swap_requests.findUnique({ where: { id: swap3.id as string } });
    expect(swap3After?.status).toBe('cancelled');
    expect(swap3After?.cancelled_by).toBe(f.staff1Id);
  });

  // (e) a concurrent approve and reassign on the same swap both finish without deadlock and leave a consistent result
  it('(e) concurrent approve and reassign finish without deadlock and leave a consistent result', async () => {
    const shiftId = await createShift(f, f.staff1Id);

    const swapRes = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId, targetUserId: f.staff2Id },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    expect(swapRes.status).toBe(201);
    const swap = await dataOf(swapRes);

    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1_000);
    const endsAt = new Date(startsAt.getTime() + 4 * 60 * 60 * 1_000);

    // Concurrently trigger approve (Manager) and reassign (Owner)
    const [approveResult, reassignResult] = await Promise.all([
      post(
        app,
        `/teams/${f.teamId}/swaps/${swap.id}/decide`,
        { status: 'approved' },
        f.managerAuth,
      ),
      post(
        app,
        `/teams/${f.teamId}/shifts/${shiftId}/update`,
        {
          assignedUserId: f.staff3Id,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          label: 'Concurrent Reassign',
        },
        f.ownerAuth,
      ),
    ]);

    // Both requests must complete (neither deadlocked!)
    expect([200, 409]).toContain(approveResult.status);
    expect([200]).toContain(reassignResult.status);

    // Final database state must be consistent
    const finalShift = await forTeam(f.teamId).shifts.findUnique({ where: { id: shiftId } });
    const finalSwap = await forTeam(f.teamId).swap_requests.findUnique({ where: { id: swap.id as string } });

    if (approveResult.status === 200) {
      // Approve won first, then reassign reassigned to staff3
      expect(finalSwap?.status).toBe('approved');
      expect(finalShift?.assigned_user_id).toBe(f.staff3Id);
    } else {
      // Reassign won first: swap was cancelled, approve failed with 409
      expect(approveResult.status).toBe(409);
      const err = await errorOf(approveResult);
      expect(['swap.conflict', 'swap.assignee_changed']).toContain(err.code);
      expect(finalSwap?.status).toBe('cancelled');
      expect(finalShift?.assigned_user_id).toBe(f.staff3Id);
    }
  });

  // (f) activity data contains no names, emails, notes or reasons
  it('(f) activity data for auto-cancelled swaps contains only ids and reason code', async () => {
    // 1. Shift reassigned auto-cancel activity
    const shift1Id = await createShift(f, f.staff1Id);
    const swap1Res = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId: shift1Id, targetUserId: f.staff2Id, note: 'Special swap note that must not leak' },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    const swap1 = await dataOf(swap1Res);

    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1_000);
    const endsAt = new Date(startsAt.getTime() + 4 * 60 * 60 * 1_000);
    await post(
      app,
      `/teams/${f.teamId}/shifts/${shift1Id}/update`,
      {
        assignedUserId: f.staff3Id,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        label: 'Reassigned Shift 1',
      },
      f.managerAuth,
    );

    const reassignEvents = await forTeam(f.teamId).activity_events.findMany({
      where: {
        team_id: f.teamId,
        kind: 'swap.cancelled',
        subject_id: swap1.id as string,
      },
    });
    expect(reassignEvents.length).toBe(1);
    const reassignEvent = reassignEvents[0]!;
    expect(reassignEvent.audience).toBe('involved');
    expect(reassignEvent.actor_user_id).toBe(f.managerId);

    const reassignData = reassignEvent.data as Record<string, unknown>;
    expect(reassignData.swapId).toBe(swap1.id);
    expect(reassignData.shiftId).toBe(shift1Id);
    expect(reassignData.cancelledBy).toBe(f.managerId);
    expect(reassignData.reason).toBe('shift_reassigned');

    // Strict privacy checks: NO names, emails, notes, or decline reasons in data
    const reassignJson = JSON.stringify(reassignData);
    expect(reassignJson).not.toMatch(/@/);
    expect(reassignJson).not.toMatch(/Special swap note/);
    expect(reassignData).not.toHaveProperty('requesterName');
    expect(reassignData).not.toHaveProperty('targetName');
    expect(reassignData).not.toHaveProperty('note');
    expect(reassignData).not.toHaveProperty('declineReason');

    // 2. Shift deleted auto-cancel activity
    const shift2Id = await createShift(f, f.staff1Id);
    const swap2Res = await post(
      app,
      `/teams/${f.teamId}/swaps`,
      { shiftId: shift2Id, targetUserId: f.staff2Id, note: 'Another confidential note' },
      { ...f.staff1Auth, 'idempotency-key': randomUUID() },
    );
    const swap2 = await dataOf(swap2Res);

    await post(
      app,
      `/teams/${f.teamId}/shifts/${shift2Id}/delete`,
      undefined,
      f.managerAuth,
    );

    const deleteEvents = await forTeam(f.teamId).activity_events.findMany({
      where: {
        team_id: f.teamId,
        kind: 'swap.cancelled',
        subject_id: swap2.id as string,
      },
    });
    expect(deleteEvents.length).toBe(1);
    const deleteEvent = deleteEvents[0]!;
    expect(deleteEvent.audience).toBe('involved');
    expect(deleteEvent.actor_user_id).toBe(f.managerId);

    const deleteData = deleteEvent.data as Record<string, unknown>;
    expect(deleteData.swapId).toBe(swap2.id);
    expect(deleteData.shiftId).toBe(shift2Id);
    expect(deleteData.cancelledBy).toBe(f.managerId);
    expect(deleteData.reason).toBe('shift_deleted');

    const deleteJson = JSON.stringify(deleteData);
    expect(deleteJson).not.toMatch(/@/);
    expect(deleteJson).not.toMatch(/Another confidential note/);
    expect(deleteData).not.toHaveProperty('requesterName');
    expect(deleteData).not.toHaveProperty('targetName');
    expect(deleteData).not.toHaveProperty('note');
    expect(deleteData).not.toHaveProperty('declineReason');
  });
});
