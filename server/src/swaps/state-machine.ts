// Pure swap state machine (PRD 8.5, 12).
// No I/O, no database dependencies.
// Allowed transitions:
//   pending -> approved
//   pending -> rejected
//   pending -> cancelled
// Every other transition returns a typed refusal.
import type { SwapStatus } from '@rowta/shared';

export const FINAL_SWAP_STATUSES: readonly SwapStatus[] = ['approved', 'rejected', 'cancelled'];

export interface TransitionSuccess {
  readonly ok: true;
  readonly to: SwapStatus;
}

export interface TransitionFailure {
  readonly ok: false;
  readonly error: 'invalid_transition' | 'already_final';
  readonly currentStatus: SwapStatus;
  readonly targetStatus: SwapStatus;
  readonly reason: string;
}

export type TransitionResult = TransitionSuccess | TransitionFailure;

const ALLOWED_TRANSITIONS: Readonly<Record<SwapStatus, readonly SwapStatus[]>> = {
  pending: ['approved', 'rejected', 'cancelled'],
  approved: [],
  rejected: [],
  cancelled: [],
};

/**
 * Check whether a state transition is permitted.
 */
export function canTransitionSwap(from: SwapStatus, to: SwapStatus): boolean {
  const allowed = ALLOWED_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

/**
 * Attempt to transition a swap from its current state to a target state.
 * Returns a typed success or refusal.
 */
export function transitionSwap(from: SwapStatus, to: SwapStatus): TransitionResult {
  if (from === 'approved' || from === 'rejected' || from === 'cancelled') {
    return {
      ok: false,
      error: 'already_final',
      currentStatus: from,
      targetStatus: to,
      reason: `Cannot transition from terminal state "${from}" to "${to}".`,
    };
  }

  if (from === 'pending') {
    if (to === 'approved' || to === 'rejected' || to === 'cancelled') {
      return { ok: true, to };
    }
  }

  return {
    ok: false,
    error: 'invalid_transition',
    currentStatus: from,
    targetStatus: to,
    reason: `Invalid transition from "${from}" to "${to}".`,
  };
}

