// Pure swap logic for app screens (PRD 8.5, 12; rules C7, U8, V5).
// Optimistic update + rollback reducer, swap filter helpers, and permission helpers.
// Pure functions with zero side-effects and zero React/DOM dependencies for straightforward testability.
import type { SwapRequestView, SwapStatus } from '@rowta/shared';
import { t, type MessageKey } from '../i18n/en';

export interface ShiftSwapState {
  readonly hasPendingSwap: boolean;
  readonly isRequesting: boolean;
  readonly pendingSwapId: string | null;
  readonly error: string | null;
}

export const INITIAL_SHIFT_SWAP_STATE: ShiftSwapState = {
  hasPendingSwap: false,
  isRequesting: false,
  pendingSwapId: null,
  error: null,
};

export type ShiftSwapAction =
  | { readonly type: 'request_start' }
  | { readonly type: 'request_success'; readonly swapId: string }
  | { readonly type: 'request_failure'; readonly error: string }
  | { readonly type: 'cancel_success' }
  | { readonly type: 'clear_error' };

/**
 * Optimistic update and rollback reducer (PRD 8.5, rule C7).
 * 'request_start' optimistically flips hasPendingSwap = true.
 * 'request_failure' rolls back to hasPendingSwap = false and records the announced error.
 */
export function shiftSwapReducer(state: ShiftSwapState, action: ShiftSwapAction): ShiftSwapState {
  switch (action.type) {
    case 'request_start':
      return {
        ...state,
        isRequesting: true,
        hasPendingSwap: true, // optimistic
        error: null,
      };
    case 'request_success':
      return {
        ...state,
        isRequesting: false,
        hasPendingSwap: true,
        pendingSwapId: action.swapId,
        error: null,
      };
    case 'request_failure':
      // Rollback
      return {
        ...state,
        isRequesting: false,
        hasPendingSwap: false,
        pendingSwapId: null,
        error: action.error,
      };
    case 'cancel_success':
      return {
        ...state,
        hasPendingSwap: false,
        pendingSwapId: null,
        error: null,
      };
    case 'clear_error':
      return {
        ...state,
        error: null,
      };
  }
}

export type SwapFilterTab = 'all' | 'pending' | 'my';

/**
 * Filter swap requests for tab navigation.
 */
export function filterSwapsByTab(
  swaps: readonly SwapRequestView[],
  tab: SwapFilterTab,
  currentUserId: string,
): readonly SwapRequestView[] {
  switch (tab) {
    case 'all':
      return swaps;
    case 'pending':
      return swaps.filter((s) => s.status === 'pending');
    case 'my':
      return swaps.filter((s) => s.requestedBy === currentUserId || s.targetUserId === currentUserId);
  }
}

/**
 * Determines whether the swap button should show "Swap requested" (disabled)
 * or allow requesting a new swap.
 * ONLY a swap with status 'pending' disables/hides the button;
 * cancelled, rejected, approved, or none must not.
 */
export function hasPendingSwapRequest(
  swaps: readonly { readonly status: SwapStatus }[] | null | undefined,
): boolean {
  if (!swaps || swaps.length === 0) return false;
  return swaps.some((s) => s.status === 'pending');
}

/**
 * Check whether a user is eligible to request a swap on a shift.
 * Must be the shift's assigned user, shift must not have ended, and no swap is pending.
 */
export function canRequestSwap(
  shift: { readonly assignedUserId: string; readonly endsAt: string },
  currentUserId: string,
  hasPendingSwap: boolean,
  nowMs = Date.now(),
): boolean {
  if (hasPendingSwap) return false;
  if (shift.assignedUserId !== currentUserId) return false;
  const endsAtMs = new Date(shift.endsAt).getTime();
  if (endsAtMs <= nowMs) return false;
  return true;
}

export type SwapIneligibleReason =
  | 'not_assignee'
  | 'shift_ended'
  | 'pending_swap';

/**
 * Diagnoses why a user cannot request a swap on a shift (Owner UX pass, Task 4).
 * Returns null if the user can request a swap.
 */
export function getSwapIneligibleReason(
  shift: { readonly assignedUserId: string; readonly endsAt: string } | null | undefined,
  currentUserId: string,
  hasPendingSwap: boolean,
  nowMs = Date.now(),
): SwapIneligibleReason | null {
  if (!shift) return null;
  if (shift.assignedUserId !== currentUserId) {
    return 'not_assignee';
  }
  const endsAtMs = new Date(shift.endsAt).getTime();
  if (endsAtMs <= nowMs) {
    return 'shift_ended';
  }
  if (hasPendingSwap) {
    return 'pending_swap';
  }
  return null;
}

export function swapIneligibleMessageKey(reason: SwapIneligibleReason): MessageKey {
  switch (reason) {
    case 'not_assignee':
      return 'swap.reason.notAssignee';
    case 'shift_ended':
      return 'swap.reason.shiftEnded';
    case 'pending_swap':
      return 'swap.reason.pendingSwap';
  }
}

/**
 * Check whether a user role can decide (approve/reject) swaps.
 * Owner and Manager only (PRD Section 4).
 */
export function canDecideSwap(role: string): boolean {
  return role === 'owner' || role === 'manager';
}

/**
 * Check whether a user role can decide (approve/reject) swaps given the shift's deleted state (Owner Decision D4).
 * Owner and Manager only; blocked if shift was deleted.
 */
export function canDecideSwapWithShift(role: string, shiftDeleted?: boolean): boolean {
  if (shiftDeleted) return false;
  return canDecideSwap(role);
}

/**
 * Check whether a user can cancel a swap.
 * Requester may cancel their own pending swap; Owner/Manager may cancel any pending swap.
 */
export function canCancelSwap(
  swap: { readonly requestedBy: string; readonly status: SwapStatus },
  currentUserId: string,
  userRole: string,
): boolean {
  if (swap.status !== 'pending') return false;
  if (swap.requestedBy === currentUserId) return true;
  return canDecideSwap(userRole);
}

/**
 * Merge two swap request pages while preserving chronological order and de-duplicating by id.
 */
export function mergeSwapPages(
  existing: readonly SwapRequestView[],
  incoming: readonly SwapRequestView[],
): readonly SwapRequestView[] {
  const seen = new Set<string>();
  const merged: SwapRequestView[] = [];

  for (const s of existing) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      merged.push(s);
    }
  }

  for (const s of incoming) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      merged.push(s);
    }
  }

  return merged;
}

/**
 * D1: Whether approving this swap requires picking a target colleague.
 * Targeted swaps approve directly without a picker; open swaps require the manager to pick a colleague.
 */
export function needsTargetPicker(swap: { readonly targetUserId: string | null }): boolean {
  return swap.targetUserId === null;
}

/**
 * Filter team members eligible for swap reassignment.
 * The requester cannot be reassigned their own shift (rule 1b: swap.self_swap).
 */
export function getEligibleSwapTargets<T extends { readonly userId: string; readonly displayName: string }>(
  members: readonly T[],
  requestedBy: string,
): readonly T[] {
  return members.filter((m) => m.userId !== requestedBy);
}

/**
 * Maximum character limit for a swap decline reason (Phase 5 / Swap v2; rules V1, V3).
 */
export const SWAP_DECLINE_REASON_MAX_LENGTH = 140;

/**
 * Returns the trimmed decline reason.
 */
export function getTrimmedDeclineReason(reason: string): string {
  return reason.trim();
}

/**
 * Checks whether the decline reason is valid (non-empty after trim and <= 140 characters).
 */
export function isDeclineReasonValid(reason: string): boolean {
  const trimmed = reason.trim();
  return trimmed.length >= 1 && trimmed.length <= SWAP_DECLINE_REASON_MAX_LENGTH;
}

/**
 * Checks whether the Decline confirm button is ready to accept presses.
 * Ready only when the trimmed reason is between 1 and 140 characters and not currently submitting.
 */
export function isDeclineReady(reason: string, isBusy = false): boolean {
  return !isBusy && isDeclineReasonValid(reason);
}

/**
 * Formats the live character counter showing trimmed characters used out of the maximum limit.
 */
export function formatDeclineReasonCounter(
  reason: string,
  maxLength = SWAP_DECLINE_REASON_MAX_LENGTH,
): string {
  const count = reason.trim().length;
  return t('swap.declineModal.counter', { count, max: maxLength });
}

export type DecideSwapPayload =
  | { readonly status: 'approved'; readonly targetUserId?: string | null }
  | { readonly status: 'rejected'; readonly declineReason: string };

/**
 * Pure payload builder for swap decision endpoint.
 * Rejected payload includes trimmed declineReason.
 * Approved payload never includes declineReason.
 */
export function buildDecideSwapPayload(
  status: 'approved' | 'rejected',
  opts?: { readonly targetUserId?: string | null; readonly declineReason?: string },
): DecideSwapPayload {
  if (status === 'approved') {
    return {
      status: 'approved',
      ...(opts?.targetUserId !== undefined ? { targetUserId: opts.targetUserId } : {}),
    };
  }
  const trimmed = opts?.declineReason ? opts.declineReason.trim() : '';
  return {
    status: 'rejected',
    declineReason: trimmed,
  };
}


