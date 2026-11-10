// Pure state machine tests for swaps (PRD 8.5, 12).
// Covers all 16 possible status transitions (4x4 matrix).
import { describe, expect, it } from 'vitest';
import type { SwapStatus } from '@rowta/shared';
import {
  canTransitionSwap,
  transitionSwap,
  FINAL_SWAP_STATUSES,
} from '../src/swaps/state-machine.ts';

const ALL_STATUSES: readonly SwapStatus[] = ['pending', 'approved', 'rejected', 'cancelled'];

describe('swaps state machine', () => {
  it('allows pending -> approved', () => {
    expect(canTransitionSwap('pending', 'approved')).toBe(true);
    const result = transitionSwap('pending', 'approved');
    expect(result).toEqual({ ok: true, to: 'approved' });
  });

  it('allows pending -> rejected', () => {
    expect(canTransitionSwap('pending', 'rejected')).toBe(true);
    const result = transitionSwap('pending', 'rejected');
    expect(result).toEqual({ ok: true, to: 'rejected' });
  });

  it('allows pending -> cancelled', () => {
    expect(canTransitionSwap('pending', 'cancelled')).toBe(true);
    const result = transitionSwap('pending', 'cancelled');
    expect(result).toEqual({ ok: true, to: 'cancelled' });
  });

  it('refuses pending -> pending', () => {
    expect(canTransitionSwap('pending', 'pending')).toBe(false);
    const result = transitionSwap('pending', 'pending');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('invalid_transition');
    }
  });

  it('refuses any transition out of final states (approved, rejected, cancelled)', () => {
    for (const finalStatus of FINAL_SWAP_STATUSES) {
      for (const target of ALL_STATUSES) {
        expect(canTransitionSwap(finalStatus, target)).toBe(false);
        const result = transitionSwap(finalStatus, target);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toBe('already_final');
          expect(result.currentStatus).toBe(finalStatus);
          expect(result.targetStatus).toBe(target);
        }
      }
    }
  });
});

