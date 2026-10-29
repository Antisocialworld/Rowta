// Shared Zod schemas for shift swap requests and decisions (rules V1 to V3; PRD 4, 8.5, 12).
// Strict objects reject unknown fields; client validates for kindness, server validates for authority.
import { z } from 'zod';

export const SWAP_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type SwapStatus = (typeof SWAP_STATUSES)[number];

export const SWAP_PAGE_DEFAULT = 20;
export const SWAP_PAGE_MAX = 50;

/** Request a swap on an assigned shift. Colleague is optional (open swap). */
export const requestSwapSchema = z
  .object({
    shiftId: z.string().uuid('swap.shift.notFound'),
    targetUserId: z.string().uuid('swap.target_invalid').nullable().optional(),
  })
  .strict();
export type RequestSwapInput = z.infer<typeof requestSwapSchema>;

/** Owner or Manager decides (approve or reject). On approval, target colleague can be supplied if open. */
export const decideSwapSchema = z
  .object({
    status: z.enum(['approved', 'rejected']),
    targetUserId: z.string().uuid('swap.target_invalid').nullable().optional(),
  })
  .strict();
export type DecideSwapInput = z.infer<typeof decideSwapSchema>;

/** Cancel a pending swap. */
export const cancelSwapSchema = z.object({}).strict().optional();
export type CancelSwapInput = z.infer<typeof cancelSwapSchema>;

/** Query list of swaps with cursor pagination and optional status filter. */
export const swapsQuerySchema = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(SWAP_PAGE_MAX).default(SWAP_PAGE_DEFAULT),
    status: z.enum(SWAP_STATUSES).optional(),
    shiftId: z.string().uuid().optional(),
  })
  .strict();
export type SwapsQuery = z.infer<typeof swapsQuerySchema>;

/** Structured swap view returned to the client. */
export interface SwapRequestView {
  readonly id: string;
  readonly teamId: string;
  readonly shiftId: string;
  readonly requestedBy: string;
  readonly targetUserId: string | null;
  readonly status: SwapStatus;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  // Joined fields for display kindness (joined on read, never stored in activity data)
  readonly shiftLabel?: string;
  readonly shiftStartsAt?: string;
  readonly shiftEndsAt?: string;
  readonly shiftDeleted?: boolean;
  readonly requesterName?: string;
  readonly targetName?: string | null;
}

export interface SwapListResponse {
  readonly swaps: readonly SwapRequestView[];
  readonly nextCursor: string | null;
}

