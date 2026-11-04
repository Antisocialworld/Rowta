// Pure logic unit test for swap helpers, optimistic update + rollback reducer (PRD 8.5, 12; rules C7, U8).
import assert from 'node:assert/strict';
import type { SwapRequestView } from '@rowta/shared';
import {
  buildDecideSwapPayload,
  canCancelSwap,
  canDecideSwap,
  canDecideSwapWithShift,
  canRequestSwap,
  canViewerRequestSwap,
  filterSwapsByTab,
  formatDeclineReasonCounter,
  getEligibleSwapTargets,
  getSwapIneligibleReason,
  getTrimmedDeclineReason,
  INITIAL_SHIFT_SWAP_STATE,
  hasPendingSwapRequest,
  isDeclineReady,
  isDeclineReasonValid,
  mergeSwapPages,
  needsTargetPicker,
  shiftSwapReducer,
  swapIneligibleMessageKey,
  SWAP_DECLINE_REASON_MAX_LENGTH,
} from '../src/lib/swap-logic';
import { formatSignedInUserName } from '../src/lib/user-name';

function testOptimisticUpdateAndRollback() {
  // Initial state
  const s0 = INITIAL_SHIFT_SWAP_STATE;
  assert.equal(s0.hasPendingSwap, false);
  assert.equal(s0.isRequesting, false);
  assert.equal(s0.error, null);

  // 1. Optimistic update on request_start
  const s1 = shiftSwapReducer(s0, { type: 'request_start' });
  assert.equal(s1.hasPendingSwap, true, 'must optimistically reflect pending swap');
  assert.equal(s1.isRequesting, true, 'must be marked requesting/busy');
  assert.equal(s1.error, null);

  // 2. Forced failure causes rollback
  const s2 = shiftSwapReducer(s1, {
    type: 'request_failure',
    error: 'A swap request is already pending for this shift.',
  });
  assert.equal(s2.hasPendingSwap, false, 'must roll back hasPendingSwap to false');
  assert.equal(s2.isRequesting, false, 'must reset requesting flag');
  assert.equal(s2.pendingSwapId, null);
  assert.equal(
    s2.error,
    'A swap request is already pending for this shift.',
    'must capture announced error text',
  );

  // 3. Clear error
  const s3 = shiftSwapReducer(s2, { type: 'clear_error' });
  assert.equal(s3.error, null);

  // 4. Successful request
  const s4 = shiftSwapReducer(s0, { type: 'request_start' });
  const s5 = shiftSwapReducer(s4, { type: 'request_success', swapId: 'swap-123' });
  assert.equal(s5.hasPendingSwap, true);
  assert.equal(s5.isRequesting, false);
  assert.equal(s5.pendingSwapId, 'swap-123');

  // 5. Cancel success
  const s6 = shiftSwapReducer(s5, { type: 'cancel_success' });
  assert.equal(s6.hasPendingSwap, false);
  assert.equal(s6.pendingSwapId, null);
}

function testCanRequestSwap() {
  const now = 1_000_000;
  const futureShift = { assignedUserId: 'user-1', endsAt: new Date(now + 10_000).toISOString() };
  const pastShift = { assignedUserId: 'user-1', endsAt: new Date(now - 10_000).toISOString() };

  // Assignee on future shift without pending swap can request
  assert.equal(canRequestSwap(futureShift, 'user-1', false, now), true);

  // Non-assignee cannot request
  assert.equal(canRequestSwap(futureShift, 'user-2', false, now), false);

  // Already has pending swap -> blocked
  assert.equal(canRequestSwap(futureShift, 'user-1', true, now), false);

  // Past shift -> blocked
  assert.equal(canRequestSwap(pastShift, 'user-1', false, now), false);
}

function testCanViewerRequestSwap() {
  const now = 1_000_000;
  const future = { assignedUserId: 'assignee', endsAt: new Date(now + 10_000).toISOString() };
  const past = { assignedUserId: 'assignee', endsAt: new Date(now - 10_000).toISOString() };

  // The assignee may request on a future, non-deleted shift with no pending swap.
  assert.equal(canViewerRequestSwap(future, 'assignee', false, now), true);

  // A manager/admin who is not the assignee may not request (role is irrelevant to the server rule).
  assert.equal(canViewerRequestSwap(future, 'manager-not-assignee', false, now), false);
  assert.equal(canViewerRequestSwap(future, 'owner-not-assignee', false, now), false);

  // Staff who is not the assignee may not request.
  assert.equal(canViewerRequestSwap(future, 'staff-not-assignee', false, now), false);

  // The server rejects a shift that has already ended.
  assert.equal(canViewerRequestSwap(past, 'assignee', false, now), false);

  // The server rejects a second pending swap for the same shift.
  assert.equal(canViewerRequestSwap(future, 'assignee', true, now), false);

  // Missing or deleted shifts cannot be swapped.
  assert.equal(canViewerRequestSwap(null, 'assignee', false, now), false);
  assert.equal(canViewerRequestSwap(undefined, 'assignee', false, now), false);
  assert.equal(
    canViewerRequestSwap({ ...future, deletedAt: '2026-01-01T00:00:00Z' }, 'assignee', false, now),
    false,
  );
  assert.equal(canViewerRequestSwap({ ...future, deletedAt: null }, 'assignee', false, now), true);
}

function testCanDecideSwap() {
  assert.equal(canDecideSwap('owner'), true);
  assert.equal(canDecideSwap('manager'), true);
  assert.equal(canDecideSwap('staff'), false);
  assert.equal(canDecideSwap('unknown'), false);
}

function testCanDecideSwapWithShift() {
  // If shift is deleted, neither owner nor manager can decide (D4)
  assert.equal(canDecideSwapWithShift('owner', true), false);
  assert.equal(canDecideSwapWithShift('manager', true), false);
  assert.equal(canDecideSwapWithShift('staff', true), false);

  // If shift is not deleted, owner and manager can decide
  assert.equal(canDecideSwapWithShift('owner', false), true);
  assert.equal(canDecideSwapWithShift('manager', false), true);
  assert.equal(canDecideSwapWithShift('staff', false), false);

  // Undefined shiftDeleted defaults to false
  assert.equal(canDecideSwapWithShift('manager', undefined), true);
}

function testCanCancelSwap() {
  const pendingSwap = { requestedBy: 'user-1', status: 'pending' as const };
  const approvedSwap = { requestedBy: 'user-1', status: 'approved' as const };

  // Requester can cancel own pending swap
  assert.equal(canCancelSwap(pendingSwap, 'user-1', 'staff'), true);

  // Another staff cannot cancel
  assert.equal(canCancelSwap(pendingSwap, 'user-2', 'staff'), false);

  // Manager can cancel pending swap
  assert.equal(canCancelSwap(pendingSwap, 'user-2', 'manager'), true);

  // Owner can cancel pending swap
  assert.equal(canCancelSwap(pendingSwap, 'user-2', 'owner'), true);

  // Cannot cancel already approved/rejected swap
  assert.equal(canCancelSwap(approvedSwap, 'user-1', 'staff'), false);
  assert.equal(canCancelSwap(approvedSwap, 'user-2', 'owner'), false);
}

function testFilterSwapsByTab() {
  const mockSwaps: SwapRequestView[] = [
    {
      id: '1',
      teamId: 'team-1',
      shiftId: 'shift-1',
      requestedBy: 'user-1',
      targetUserId: 'user-2',
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      createdAt: '2026-10-28T10:00:00Z',
      updatedAt: '2026-10-28T10:00:00Z',
    },
    {
      id: '2',
      teamId: 'team-1',
      shiftId: 'shift-2',
      requestedBy: 'user-3',
      targetUserId: null,
      status: 'approved',
      decidedBy: 'owner',
      decidedAt: '2026-10-28T10:05:00Z',
      createdAt: '2026-10-28T10:01:00Z',
      updatedAt: '2026-10-28T10:05:00Z',
    },
    {
      id: '3',
      teamId: 'team-1',
      shiftId: 'shift-3',
      requestedBy: 'user-2',
      targetUserId: 'user-1',
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      createdAt: '2026-10-28T10:02:00Z',
      updatedAt: '2026-10-28T10:02:00Z',
    },
  ];

  const all = filterSwapsByTab(mockSwaps, 'all', 'user-1');
  assert.equal(all.length, 3);

  const pending = filterSwapsByTab(mockSwaps, 'pending', 'user-1');
  assert.equal(pending.length, 2);
  assert.deepEqual(pending.map((s) => s.id), ['1', '3']);

  const my = filterSwapsByTab(mockSwaps, 'my', 'user-1');
  assert.equal(my.length, 2);
  assert.deepEqual(my.map((s) => s.id), ['1', '3']);
}

function testMergeSwapPages() {
  const page1: SwapRequestView[] = [
    {
      id: 'swap-1',
      teamId: 't1',
      shiftId: 's1',
      requestedBy: 'u1',
      targetUserId: null,
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      createdAt: '2026-10-28T10:00:00Z',
      updatedAt: '2026-10-28T10:00:00Z',
    },
    {
      id: 'swap-2',
      teamId: 't1',
      shiftId: 's2',
      requestedBy: 'u2',
      targetUserId: null,
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      createdAt: '2026-10-28T09:00:00Z',
      updatedAt: '2026-10-28T09:00:00Z',
    },
  ];

  const page2: SwapRequestView[] = [
    {
      id: 'swap-2', // duplicate from page boundary
      teamId: 't1',
      shiftId: 's2',
      requestedBy: 'u2',
      targetUserId: null,
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      createdAt: '2026-10-28T09:00:00Z',
      updatedAt: '2026-10-28T09:00:00Z',
    },
    {
      id: 'swap-3',
      teamId: 't1',
      shiftId: 's3',
      requestedBy: 'u3',
      targetUserId: null,
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      createdAt: '2026-10-28T08:00:00Z',
      updatedAt: '2026-10-28T08:00:00Z',
    },
  ];

  const merged = mergeSwapPages(page1, page2);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map((s) => s.id), ['swap-1', 'swap-2', 'swap-3']);
}

function testNeedsTargetPicker() {
  assert.equal(needsTargetPicker({ targetUserId: null }), true, 'open swap with no target needs picker');
  assert.equal(needsTargetPicker({ targetUserId: 'user-2' }), false, 'targeted swap does not need picker');
}

function testGetEligibleSwapTargets() {
  const members = [
    { userId: 'u1', displayName: 'Requester' },
    { userId: 'u2', displayName: 'Colleague A' },
    { userId: 'u3', displayName: 'Colleague B' },
  ];
  const eligible = getEligibleSwapTargets(members, 'u1');
  assert.equal(eligible.length, 2);
  assert.equal(eligible.some((m) => m.userId === 'u1'), false, 'requester must be excluded (swap.self_swap rule 1b)');
  assert.equal(eligible[0]?.userId, 'u2');
  assert.equal(eligible[1]?.userId, 'u3');
}

function testFormatSignedInUserName() {
  assert.equal(formatSignedInUserName(null), null);
  assert.equal(formatSignedInUserName(undefined), null);
  assert.equal(formatSignedInUserName({ displayName: '' }), null);
  assert.equal(formatSignedInUserName({ displayName: '   ' }), null);
  assert.equal(formatSignedInUserName({ displayName: 'Alex Okoro' }), 'Alex Okoro');
}

function testSwapButtonConditions() {
  // Button condition: only pending disables/hides the button (Phase 1 bug)
  assert.equal(hasPendingSwapRequest([{ status: 'pending' }]), true, 'pending must mark hasPendingSwap');
  assert.equal(hasPendingSwapRequest([{ status: 'cancelled' }]), false, 'cancelled must not mark hasPendingSwap');
  assert.equal(hasPendingSwapRequest([{ status: 'rejected' }]), false, 'rejected must not mark hasPendingSwap');
  assert.equal(hasPendingSwapRequest([{ status: 'approved' }]), false, 'approved must not mark hasPendingSwap');
  assert.equal(hasPendingSwapRequest([]), false, 'empty swaps must not mark hasPendingSwap');
  assert.equal(hasPendingSwapRequest(null), false, 'null swaps must not mark hasPendingSwap');
  assert.equal(hasPendingSwapRequest(undefined), false, 'undefined swaps must not mark hasPendingSwap');

  const now = 1_000_000;
  const futureShift = { assignedUserId: 'u1', endsAt: new Date(now + 10_000).toISOString() };

  // Eligible to request swap when no pending swap exists
  assert.equal(canRequestSwap(futureShift, 'u1', hasPendingSwapRequest([{ status: 'pending' }]), now), false);
  assert.equal(canRequestSwap(futureShift, 'u1', hasPendingSwapRequest([{ status: 'cancelled' }]), now), true);
  assert.equal(canRequestSwap(futureShift, 'u1', hasPendingSwapRequest([{ status: 'rejected' }]), now), true);
  assert.equal(canRequestSwap(futureShift, 'u1', hasPendingSwapRequest([]), now), true);
}

function testGetSwapIneligibleReason() {
  const now = 1_000_000;
  const futureShift = { assignedUserId: 'user-1', endsAt: new Date(now + 10_000).toISOString() };
  const pastShift = { assignedUserId: 'user-1', endsAt: new Date(now - 10_000).toISOString() };

  // Eligible -> null
  assert.equal(getSwapIneligibleReason(futureShift, 'user-1', false, now), null);

  // Non-assignee -> not_assignee
  assert.equal(getSwapIneligibleReason(futureShift, 'user-2', false, now), 'not_assignee');
  assert.equal(swapIneligibleMessageKey('not_assignee'), 'swap.reason.notAssignee');

  // Past shift -> shift_ended
  assert.equal(getSwapIneligibleReason(pastShift, 'user-1', false, now), 'shift_ended');
  assert.equal(swapIneligibleMessageKey('shift_ended'), 'swap.reason.shiftEnded');

  // Pending swap -> pending_swap
  assert.equal(getSwapIneligibleReason(futureShift, 'user-1', true, now), 'pending_swap');
  assert.equal(swapIneligibleMessageKey('pending_swap'), 'swap.reason.pendingSwap');

  // Null shift -> null
  assert.equal(getSwapIneligibleReason(null, 'user-1', false, now), null);
}

function testDeclineReasonLogic() {
  // 1. Validation: empty, whitespace-only, 1 char, 140 chars, 141 chars
  assert.equal(isDeclineReasonValid(''), false, 'empty string must be invalid');
  assert.equal(isDeclineReasonValid('   '), false, 'whitespace-only string must be invalid');
  assert.equal(isDeclineReasonValid('a'), true, '1 char must be valid');
  assert.equal(isDeclineReasonValid('  a  '), true, 'trimmed 1 char must be valid');

  const char140 = 'x'.repeat(SWAP_DECLINE_REASON_MAX_LENGTH);
  assert.equal(isDeclineReasonValid(char140), true, '140 chars must be valid');
  assert.equal(isDeclineReasonValid(`  ${char140}  `), true, 'trimmed 140 chars must be valid');

  const char141 = 'x'.repeat(SWAP_DECLINE_REASON_MAX_LENGTH + 1);
  assert.equal(isDeclineReasonValid(char141), false, '141 chars must be invalid');
  assert.equal(isDeclineReasonValid(`  ${char141}  `), false, 'trimmed 141 chars must be invalid');

  // 2. getTrimmedDeclineReason
  assert.equal(getTrimmedDeclineReason('  hello world  '), 'hello world');
  assert.equal(getTrimmedDeclineReason(''), '');
  assert.equal(getTrimmedDeclineReason('   '), '');

  // 3. isDeclineReady (considers validity and busy state)
  assert.equal(isDeclineReady('', false), false);
  assert.equal(isDeclineReady('   ', false), false);
  assert.equal(isDeclineReady('Valid reason', false), true);
  assert.equal(isDeclineReady('Valid reason', true), false, 'must not be ready when busy');
  assert.equal(isDeclineReady(char141, false), false);

  // 4. Counter formatting
  assert.equal(formatDeclineReasonCounter(''), '0 of 140 characters');
  assert.equal(formatDeclineReasonCounter('   '), '0 of 140 characters');
  assert.equal(formatDeclineReasonCounter('  abc  '), '3 of 140 characters');
  assert.equal(formatDeclineReasonCounter(char140), '140 of 140 characters');

  // 5. buildDecideSwapPayload: rejected payload includes trimmed declineReason
  const rejectedPayload = buildDecideSwapPayload('rejected', { declineReason: '  Shift conflict  ' });
  assert.equal(rejectedPayload.status, 'rejected');
  assert.equal(rejectedPayload.declineReason, 'Shift conflict');

  // 6. buildDecideSwapPayload: approved payload has NO declineReason key
  const approvedPayload = buildDecideSwapPayload('approved', {
    targetUserId: 'target-123',
    declineReason: 'Should not exist in approved payload',
  });
  assert.equal(approvedPayload.status, 'approved');
  assert.equal('targetUserId' in approvedPayload && approvedPayload.targetUserId, 'target-123');
  assert.equal('declineReason' in approvedPayload, false, 'approved payload must NOT contain declineReason key');

  const approvedPayloadNoTarget = buildDecideSwapPayload('approved');
  assert.equal(approvedPayloadNoTarget.status, 'approved');
  assert.equal('declineReason' in approvedPayloadNoTarget, false);
}

function runAll() {
  testOptimisticUpdateAndRollback();
  testCanRequestSwap();
  testCanViewerRequestSwap();
  testCanDecideSwap();
  testCanDecideSwapWithShift();
  testCanCancelSwap();
  testFilterSwapsByTab();
  testMergeSwapPages();
  testNeedsTargetPicker();
  testGetEligibleSwapTargets();
  testFormatSignedInUserName();
  testSwapButtonConditions();
  testGetSwapIneligibleReason();
  testDeclineReasonLogic();
  console.log('test-swap-logic: 14 assertion suites passed');
}

runAll();

