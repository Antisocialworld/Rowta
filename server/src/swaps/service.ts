// Swaps service (PRD 4, 8.5, 9.9, 12; rules S6, S7, S8, C4, D4).
//
// Manages shift swap requests, approval/rejection with shift reassignment, and cancellation.
// Atomic transactions guarantee shift update + swap update + activity event. Notification enqueue
// happens after commit (best-effort; a failed enqueue means a lost notification; transactional outbox deferred to Phase 6).
import {
  SWAP_PAGE_DEFAULT,
  type DecideSwapInput,
  type RequestSwapInput,
  type SwapListResponse,
  type SwapRequestView,
  type SwapStatus,
  type SwapsQuery,
  authMessage,
} from '@rowta/shared';
import {
  forTeam,
  globalDb,
  teamTransaction,
  type AnyPrismaClient,
  type JsonInput,
  type ShardTx,
} from '../db/clients.ts';
import { fingerprint } from '../security/fingerprint.ts';
import { can, type Role } from '../security/policy.ts';
import { HttpError } from '../middleware/error.ts';
import { getQueue } from '../jobs/queues.ts';
import { transitionSwap } from './state-machine.ts';
import { logger } from '../lib/logger.ts';

const log = logger.child({ module: 'swaps-service' });
const FORBIDDEN = 'You do not have permission to perform this action.';

function assertTeamId(teamId: string): void {
  if (typeof teamId !== 'string' || teamId.trim().length === 0) {
    throw new Error('teamId is required for team-scoped data access (rule S7)');
  }
}

function iso(value: Date): string {
  return value.toISOString();
}

function roleOf(membership: { role: string }): Role {
  if (membership.role === 'owner' || membership.role === 'manager' || membership.role === 'staff') {
    return membership.role;
  }
  throw new Error(`unknown membership role "${membership.role}"`);
}

/** Caller's active membership or 404 (rule S7: never leak cross-team existence). */
async function requireMember(client: AnyPrismaClient, teamId: string, userId: string) {
  assertTeamId(teamId);
  const membership = await client.memberships.findUnique({
    where: { team_id_user_id: { team_id: teamId, user_id: userId } },
  });
  if (!membership || membership.removed_at !== null) {
    throw new HttpError(404, 'team.notFound', 'Team not found.');
  }
  const team = await client.teams.findUnique({ where: { id: teamId } });
  if (!team || team.deleted_at !== null) {
    throw new HttpError(404, 'team.notFound', 'Team not found.');
  }
  return membership;
}

function requireAction(
  userId: string,
  membership: { role: string; user_id: string },
  action: 'manage_swaps' | 'view_shifts',
): void {
  if (!can({ id: userId }, { user_id: membership.user_id, role: roleOf(membership) }, action)) {
    throw new HttpError(403, 'team.forbidden', FORBIDDEN);
  }
}

interface DecodedCursor {
  readonly t: string;
  readonly id: string;
}

function decodeCursor(cursor: string): DecodedCursor {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      't' in parsed &&
      'id' in parsed &&
      typeof (parsed as DecodedCursor).t === 'string' &&
      typeof (parsed as DecodedCursor).id === 'string'
    ) {
      return parsed as DecodedCursor;
    }
  } catch {
    // fall through
  }
  throw new HttpError(400, 'activity.cursor.invalid', authMessage('activity.cursor.invalid'));
}

function encodeCursor(t: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: t.toISOString(), id }), 'utf8').toString('base64url');
}

/**
 * Request a swap on an assigned shift.
 * Must be requested by the shift's current assignee.
 * Requires Idempotency-Key.
 */
export async function requestSwap(
  teamId: string,
  userId: string,
  input: RequestSwapInput,
  idempotencyKey: string | undefined,
): Promise<SwapRequestView> {
  assertTeamId(teamId);
  if (!idempotencyKey || idempotencyKey.trim().length === 0) {
    throw new HttpError(400, 'idempotency.missing', 'Idempotency-Key header is required.');
  }

  const client = forTeam(teamId);
  const membership = await requireMember(client, teamId, userId);

  // Idempotency replay check
  const fp = fingerprint(JSON.stringify({ shiftId: input.shiftId, targetUserId: input.targetUserId ?? null }));
  const scope = `request_swap:${teamId}:${userId}`;

  const existingKey = await client.idempotency_keys.findUnique({
    where: { scope_key: { scope, key: idempotencyKey } },
  });
  if (existingKey) {
    if (existingKey.request_fingerprint !== fp) {
      throw new HttpError(
        422,
        'idempotency.fingerprint_mismatch',
        'Idempotency key has already been used with a different request payload.',
      );
    }
    if (existingKey.response && typeof existingKey.response === 'object') {
      return existingKey.response as unknown as SwapRequestView;
    }
  }

  // Shift checks
  const shift = await client.shifts.findFirst({
    where: { id: input.shiftId, team_id: teamId, deleted_at: null },
  });
  if (!shift) {
    throw new HttpError(404, 'shift.notFound', authMessage('shift.notFound'));
  }

  // Permission check: only assignee can request a swap on their own shift
  if (shift.assigned_user_id !== userId) {
    throw new HttpError(403, 'team.forbidden', authMessage('swap.shift.notAssigned'));
  }

  // Check past shift
  if (shift.ends_at.getTime() <= Date.now()) {
    throw new HttpError(422, 'swap.shift.inPast', authMessage('swap.shift.inPast'));
  }

  // Target colleague validation
  if (input.targetUserId) {
    if (input.targetUserId === userId) {
      throw new HttpError(422, 'swap.self_swap', authMessage('swap.self_swap'));
    }
    const targetMember = await client.memberships.findUnique({
      where: { team_id_user_id: { team_id: teamId, user_id: input.targetUserId } },
    });
    if (!targetMember || targetMember.removed_at !== null) {
      throw new HttpError(422, 'swap.target_invalid', authMessage('swap.target_invalid'));
    }
  }

  // Check existing pending swap
  const existingPending = await client.swap_requests.findFirst({
    where: { shift_id: input.shiftId, status: 'pending' },
  });
  if (existingPending) {
    throw new HttpError(409, 'swap.already_pending', authMessage('swap.already_pending'));
  }

  let createdSwap: SwapRequestView;
  try {
    createdSwap = await teamTransaction(teamId, async (tx: ShardTx) => {
      // Re-verify shift under row lock inside transaction to protect against concurrent reassignment or deletion
      const lockedShifts = await tx.$queryRaw<
        Array<{
          id: string;
          assigned_user_id: string;
          deleted_at: Date | null;
          ends_at: Date;
          label: string;
          starts_at: Date;
        }>
      >`SELECT id, assigned_user_id, deleted_at, ends_at, label, starts_at
        FROM shifts
        WHERE id = ${input.shiftId}::uuid AND team_id = ${teamId}::uuid
        FOR UPDATE`;

      const currentShift = lockedShifts[0];
      if (!currentShift || currentShift.deleted_at !== null) {
        throw new HttpError(404, 'shift.notFound', authMessage('shift.notFound'));
      }
      if (currentShift.assigned_user_id !== userId) {
        throw new HttpError(403, 'team.forbidden', authMessage('swap.shift.notAssigned'));
      }
      if (currentShift.ends_at.getTime() <= Date.now()) {
        throw new HttpError(422, 'swap.shift.inPast', authMessage('swap.shift.inPast'));
      }

      // Re-verify requester membership under transaction
      const currentRequester = await tx.memberships.findUnique({
        where: { team_id_user_id: { team_id: teamId, user_id: userId } },
      });
      if (!currentRequester || currentRequester.removed_at !== null) {
        throw new HttpError(404, 'team.notFound', 'Team not found.');
      }

      // Re-verify target membership if specified
      if (input.targetUserId) {
        if (input.targetUserId === userId) {
          throw new HttpError(422, 'swap.self_swap', authMessage('swap.self_swap'));
        }
        const currentTarget = await tx.memberships.findUnique({
          where: { team_id_user_id: { team_id: teamId, user_id: input.targetUserId } },
        });
        if (!currentTarget || currentTarget.removed_at !== null) {
          throw new HttpError(422, 'swap.target_invalid', authMessage('swap.target_invalid'));
        }
      }

      const swap = await tx.swap_requests.create({
        data: {
          team_id: teamId,
          shift_id: input.shiftId,
          requested_by: userId,
          target_user_id: input.targetUserId ?? null,
          status: 'pending',
        },
      });

      await tx.activity_events.create({
        data: {
          team_id: teamId,
          kind: 'swap.requested',
          actor_user_id: userId,
          subject_id: swap.id,
          data: {
            swapId: swap.id,
            shiftId: currentShift.id,
            shiftLabel: currentShift.label,
            targetUserId: swap.target_user_id,
          },
        },
      });

      const view: SwapRequestView = {
        id: swap.id,
        teamId: swap.team_id,
        shiftId: swap.shift_id,
        requestedBy: swap.requested_by,
        targetUserId: swap.target_user_id,
        status: swap.status as SwapStatus,
        decidedBy: swap.decided_by,
        decidedAt: swap.decided_at ? iso(swap.decided_at) : null,
        createdAt: iso(swap.created_at),
        updatedAt: iso(swap.updated_at),
        shiftLabel: currentShift.label,
        shiftStartsAt: iso(currentShift.starts_at),
        shiftEndsAt: iso(currentShift.ends_at),
      };

      await tx.idempotency_keys.create({
        data: {
          scope,
          key: idempotencyKey,
          request_fingerprint: fp,
          state: 'completed',
          status_code: 200,
          response: view as unknown as JsonInput,
        },
      });

      return view;
    });
  } catch (err: unknown) {
    // Catch unique constraint violation (swaps_one_pending_idx)
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002') {
      throw new HttpError(409, 'swap.already_pending', authMessage('swap.already_pending'));
    }
    throw err;
  }

  // Enqueue push notification job after commit (best-effort; acknowledged by worker in Phase 5; sent in Phase 6)
  try {
    await getQueue('push').add('notify-swap-requested', {
      teamId,
      swapId: createdSwap.id,
      shiftId: input.shiftId,
      requesterId: userId,
      targetUserId: input.targetUserId ?? null,
    });
  } catch (err) {
    log.warn({ err }, 'failed to enqueue swap requested notification');
  }

  return createdSwap;
}

/**
 * List team swaps with keyset pagination and optional status / shift filter.
 */
export async function listSwaps(
  teamId: string,
  userId: string,
  query: SwapsQuery,
): Promise<SwapListResponse> {
  assertTeamId(teamId);
  const client = forTeam(teamId);
  const membership = await requireMember(client, teamId, userId);
  requireAction(userId, membership, 'view_shifts');

  const limit = query.limit ?? SWAP_PAGE_DEFAULT;
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;

  // Query swaps
  const rows = await client.swap_requests.findMany({
    where: {
      team_id: teamId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.shiftId ? { shift_id: query.shiftId } : {}),
      ...(cursor
        ? {
            OR: [
              { created_at: { lt: new Date(cursor.t) } },
              { created_at: new Date(cursor.t), id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    include: {
      shifts: {
        select: {
          label: true,
          starts_at: true,
          ends_at: true,
        },
      },
    },
  });

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;

  // Collect user IDs for display names
  const userIds = new Set<string>();
  for (const s of slice) {
    userIds.add(s.requested_by);
    if (s.target_user_id) userIds.add(s.target_user_id);
  }

  const namesMap = new Map<string, string>();
  if (userIds.size > 0) {
    const users = await globalDb().users.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, display_name: true },
    });
    for (const u of users) {
      namesMap.set(u.id, u.display_name);
    }
  }

  const swaps: SwapRequestView[] = slice.map((s) => ({
    id: s.id,
    teamId: s.team_id,
    shiftId: s.shift_id,
    requestedBy: s.requested_by,
    targetUserId: s.target_user_id,
    status: s.status as SwapStatus,
    decidedBy: s.decided_by,
    decidedAt: s.decided_at ? iso(s.decided_at) : null,
    createdAt: iso(s.created_at),
    updatedAt: iso(s.updated_at),
    shiftLabel: s.shifts?.label,
    shiftStartsAt: s.shifts?.starts_at ? iso(s.shifts.starts_at) : undefined,
    shiftEndsAt: s.shifts?.ends_at ? iso(s.shifts.ends_at) : undefined,
    requesterName: namesMap.get(s.requested_by),
    targetName: s.target_user_id ? namesMap.get(s.target_user_id) : null,
  }));

  const last = slice[slice.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.created_at, last.id) : null;

  return { swaps, nextCursor };
}

/**
 * Get details for a single swap request.
 */
export async function getSwap(
  teamId: string,
  userId: string,
  swapId: string,
): Promise<SwapRequestView> {
  assertTeamId(teamId);
  const client = forTeam(teamId);
  const membership = await requireMember(client, teamId, userId);
  requireAction(userId, membership, 'view_shifts');

  const s = await client.swap_requests.findFirst({
    where: { id: swapId, team_id: teamId },
    include: {
      shifts: {
        select: {
          label: true,
          starts_at: true,
          ends_at: true,
        },
      },
    },
  });

  if (!s) {
    throw new HttpError(404, 'swap.notFound', authMessage('swap.notFound'));
  }

  const userIds = [s.requested_by];
  if (s.target_user_id) userIds.push(s.target_user_id);
  const users = await globalDb().users.findMany({
    where: { id: { in: userIds } },
    select: { id: true, display_name: true },
  });
  const namesMap = new Map(users.map((u) => [u.id, u.display_name]));

  return {
    id: s.id,
    teamId: s.team_id,
    shiftId: s.shift_id,
    requestedBy: s.requested_by,
    targetUserId: s.target_user_id,
    status: s.status as SwapStatus,
    decidedBy: s.decided_by,
    decidedAt: s.decided_at ? iso(s.decided_at) : null,
    createdAt: iso(s.created_at),
    updatedAt: iso(s.updated_at),
    shiftLabel: s.shifts?.label,
    shiftStartsAt: s.shifts?.starts_at ? iso(s.shifts.starts_at) : undefined,
    shiftEndsAt: s.shifts?.ends_at ? iso(s.shifts.ends_at) : undefined,
    requesterName: namesMap.get(s.requested_by),
    targetName: s.target_user_id ? namesMap.get(s.target_user_id) : null,
  };
}

/**
 * Decide a swap request (approve or reject).
 * Restricted to Owner and Manager (Staff gets 403 team.forbidden).
 * Concurrency protected via row locking (FOR UPDATE) inside teamTransaction.
 * On approval, reassigns the shift to the target user atomically.
 */
export async function decideSwap(
  teamId: string,
  userId: string,
  swapId: string,
  input: DecideSwapInput,
): Promise<SwapRequestView> {
  assertTeamId(teamId);
  const client = forTeam(teamId);
  const membership = await requireMember(client, teamId, userId);
  requireAction(userId, membership, 'manage_swaps');

  const result = await teamTransaction(teamId, async (tx: ShardTx) => {
    // 1. Lock swap row
    const lockedSwaps = await tx.$queryRaw<
      Array<{
        id: string;
        team_id: string;
        shift_id: string;
        requested_by: string;
        target_user_id: string | null;
        status: string;
        created_at: Date;
        updated_at: Date;
      }>
    >`SELECT id, team_id, shift_id, requested_by, target_user_id, status, created_at, updated_at
      FROM swap_requests
      WHERE id = ${swapId}::uuid AND team_id = ${teamId}::uuid
      FOR UPDATE`;

    const lockedSwap = lockedSwaps[0];
    if (!lockedSwap) {
      throw new HttpError(404, 'swap.notFound', authMessage('swap.notFound'));
    }

    // 2. Validate transition
    const transition = transitionSwap(lockedSwap.status as SwapStatus, input.status);
    if (!transition.ok) {
      throw new HttpError(409, 'swap.conflict', authMessage('swap.conflict'));
    }

    // 3. Lock shift row
    const lockedShifts = await tx.$queryRaw<
      Array<{
        id: string;
        team_id: string;
        label: string;
        starts_at: Date;
        ends_at: Date;
        assigned_user_id: string;
        deleted_at: Date | null;
      }>
    >`SELECT id, team_id, label, starts_at, ends_at, assigned_user_id, deleted_at
      FROM shifts
      WHERE id = ${lockedSwap.shift_id}::uuid AND team_id = ${teamId}::uuid
      FOR UPDATE`;

    const lockedShift = lockedShifts[0];
    if (!lockedShift || lockedShift.deleted_at !== null) {
      throw new HttpError(422, 'swap.shift.notFound', authMessage('swap.shift.notFound'));
    }

    const now = new Date();

    if (input.status === 'approved') {
      // Staleness check: verify shift is still assigned to the swap's requester
      if (lockedShift.assigned_user_id !== lockedSwap.requested_by) {
        throw new HttpError(409, 'swap.assignee_changed', authMessage('swap.assignee_changed'));
      }

      // Staleness check: verify requester is still an active member of this team
      const requesterMember = await tx.memberships.findUnique({
        where: { team_id_user_id: { team_id: teamId, user_id: lockedSwap.requested_by } },
      });
      if (!requesterMember || requesterMember.removed_at !== null) {
        throw new HttpError(409, 'swap.requester_removed', authMessage('swap.requester_removed'));
      }

      const finalTarget = input.targetUserId ?? lockedSwap.target_user_id;
      if (!finalTarget) {
        throw new HttpError(422, 'swap.target_required', authMessage('swap.target_required'));
      }

      if (finalTarget === lockedSwap.requested_by) {
        throw new HttpError(422, 'swap.self_swap', authMessage('swap.self_swap'));
      }

      // Check target member is active
      const targetMember = await tx.memberships.findUnique({
        where: { team_id_user_id: { team_id: teamId, user_id: finalTarget } },
      });
      if (!targetMember || targetMember.removed_at !== null) {
        throw new HttpError(422, 'swap.target_invalid', authMessage('swap.target_invalid'));
      }

      // Reassign shift
      await tx.shifts.update({
        where: { id: lockedShift.id },
        data: { assigned_user_id: finalTarget, updated_at: now },
      });

      // Update swap
      const updated = await tx.swap_requests.update({
        where: { id: lockedSwap.id },
        data: {
          status: 'approved',
          decided_by: userId,
          decided_at: now,
          target_user_id: finalTarget,
          updated_at: now,
        },
      });

      // Write activity event
      await tx.activity_events.create({
        data: {
          team_id: teamId,
          kind: 'swap.approved',
          actor_user_id: userId,
          subject_id: lockedSwap.id,
          data: {
            swapId: lockedSwap.id,
            shiftId: lockedShift.id,
            shiftLabel: lockedShift.label,
            previousAssigneeId: lockedSwap.requested_by,
            newAssigneeId: finalTarget,
            decidedBy: userId,
          },
        },
      });

      return {
        id: updated.id,
        teamId: updated.team_id,
        shiftId: updated.shift_id,
        requestedBy: updated.requested_by,
        targetUserId: updated.target_user_id,
        status: 'approved' as SwapStatus,
        decidedBy: updated.decided_by,
        decidedAt: updated.decided_at ? iso(updated.decided_at) : null,
        createdAt: iso(updated.created_at),
        updatedAt: iso(updated.updated_at),
        shiftLabel: lockedShift.label,
        shiftStartsAt: iso(lockedShift.starts_at),
        shiftEndsAt: iso(lockedShift.ends_at),
      };
    } else {
      // Rejected
      const updated = await tx.swap_requests.update({
        where: { id: lockedSwap.id },
        data: {
          status: 'rejected',
          decided_by: userId,
          decided_at: now,
          updated_at: now,
        },
      });

      await tx.activity_events.create({
        data: {
          team_id: teamId,
          kind: 'swap.rejected',
          actor_user_id: userId,
          subject_id: lockedSwap.id,
          data: {
            swapId: lockedSwap.id,
            shiftId: lockedShift.id,
            shiftLabel: lockedShift.label,
            decidedBy: userId,
          },
        },
      });

      return {
        id: updated.id,
        teamId: updated.team_id,
        shiftId: updated.shift_id,
        requestedBy: updated.requested_by,
        targetUserId: updated.target_user_id,
        status: 'rejected' as SwapStatus,
        decidedBy: updated.decided_by,
        decidedAt: updated.decided_at ? iso(updated.decided_at) : null,
        createdAt: iso(updated.created_at),
        updatedAt: iso(updated.updated_at),
        shiftLabel: lockedShift.label,
        shiftStartsAt: iso(lockedShift.starts_at),
        shiftEndsAt: iso(lockedShift.ends_at),
      };
    }
  });

  // Enqueue notification job after commit (best-effort; acknowledged by worker in Phase 5; delivery in Phase 6)
  try {
    await getQueue('push').add('notify-swap-decided', {
      teamId,
      swapId: result.id,
      shiftId: result.shiftId,
      status: input.status,
      decidedBy: userId,
    });
  } catch (err) {
    log.warn({ err }, 'failed to enqueue swap decided notification');
  }

  return result;
}

/**
 * Cancel a pending swap request.
 * Requester may cancel their own pending swap; Owner/Manager may cancel any pending swap.
 * Staff cannot cancel another user's swap.
 */
export async function cancelSwap(
  teamId: string,
  userId: string,
  swapId: string,
): Promise<SwapRequestView> {
  assertTeamId(teamId);
  const client = forTeam(teamId);
  const membership = await requireMember(client, teamId, userId);

  return teamTransaction(teamId, async (tx: ShardTx) => {
    const lockedSwaps = await tx.$queryRaw<
      Array<{
        id: string;
        team_id: string;
        shift_id: string;
        requested_by: string;
        target_user_id: string | null;
        status: string;
        created_at: Date;
        updated_at: Date;
      }>
    >`SELECT id, team_id, shift_id, requested_by, target_user_id, status, created_at, updated_at
      FROM swap_requests
      WHERE id = ${swapId}::uuid AND team_id = ${teamId}::uuid
      FOR UPDATE`;

    const lockedSwap = lockedSwaps[0];
    if (!lockedSwap) {
      throw new HttpError(404, 'swap.notFound', authMessage('swap.notFound'));
    }

    // Permission check: requester can cancel own; manager/owner can cancel any
    const isRequester = lockedSwap.requested_by === userId;
    const isManagerOrOwner = can(
      { id: userId },
      { user_id: membership.user_id, role: roleOf(membership) },
      'manage_swaps',
    );

    if (!isRequester && !isManagerOrOwner) {
      throw new HttpError(403, 'team.forbidden', FORBIDDEN);
    }

    // Transition check
    const transition = transitionSwap(lockedSwap.status as SwapStatus, 'cancelled');
    if (!transition.ok) {
      throw new HttpError(409, 'swap.cannot_cancel', authMessage('swap.cannot_cancel'));
    }

    const now = new Date();
    const updated = await tx.swap_requests.update({
      where: { id: lockedSwap.id },
      data: {
        status: 'cancelled',
        updated_at: now,
      },
    });

    await tx.activity_events.create({
      data: {
        team_id: teamId,
        kind: 'swap.cancelled',
        actor_user_id: userId,
        subject_id: lockedSwap.id,
        data: {
          swapId: lockedSwap.id,
          shiftId: lockedSwap.shift_id,
          cancelledBy: userId,
        },
      },
    });

    return {
      id: updated.id,
      teamId: updated.team_id,
      shiftId: updated.shift_id,
      requestedBy: updated.requested_by,
      targetUserId: updated.target_user_id,
      status: 'cancelled' as SwapStatus,
      decidedBy: updated.decided_by,
      decidedAt: updated.decided_at ? iso(updated.decided_at) : null,
      createdAt: iso(updated.created_at),
      updatedAt: iso(updated.updated_at),
    };
  });
}
