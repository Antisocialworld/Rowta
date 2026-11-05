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
import { enqueueNotification } from '../notifications/outbox.ts';
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
  await requireMember(client, teamId, userId);

  // Idempotency replay check
  const fp = fingerprint(
    JSON.stringify({
      shiftId: input.shiftId,
      targetUserId: input.targetUserId ?? null,
      note: input.note ?? null,
    }),
  );
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
    if (existingKey.state === 'in_flight') {
      throw new HttpError(409, 'idempotency.in_flight', 'A request with this idempotency key is already in progress.');
    }
    if (existingKey.state === 'done' && existingKey.response && typeof existingKey.response === 'object') {
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

  // Record in_flight idempotency row outside the main transaction (mirrors shifts/service.ts).
  // Wrapped in its own try/catch: if two identical requests race at the exact same instant, the
  // second create throws P2002 on (scope, key), which we catch to resolve cleanly instead of returning 500.
  try {
    await client.idempotency_keys.create({
      data: {
        scope,
        key: idempotencyKey,
        request_fingerprint: fp,
        state: 'in_flight',
      },
    });
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002') {
      // Race: another concurrent request inserted the same scope_key first. Inspect its state.
      const racedKey = await client.idempotency_keys.findUnique({
        where: { scope_key: { scope, key: idempotencyKey } },
      });
      if (racedKey) {
        if (racedKey.request_fingerprint !== fp) {
          throw new HttpError(
            422,
            'idempotency.fingerprint_mismatch',
            'Idempotency key was previously used with different request parameters.',
          );
        }
        if (racedKey.state === 'in_flight') {
          throw new HttpError(
            409,
            'idempotency.in_flight',
            'A request with this idempotency key is already in progress.',
          );
        }
        if (racedKey.state === 'done' && racedKey.response && typeof racedKey.response === 'object') {
          return racedKey.response as unknown as SwapRequestView;
        }
      }
    }
    throw err;
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
          note: input.note ?? null,
        },
      });

      await tx.activity_events.create({
        data: {
          team_id: teamId,
          kind: 'swap.requested',
          audience: 'involved',
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

      // Enqueue notification in transactional outbox (Phase 6 Stage 4; PRD 7.1, 8.7)
      if (input.targetUserId) {
        await enqueueNotification(tx, {
          recipientUserId: input.targetUserId,
          category: 'swap.requested',
          payload: {
            teamId,
            swapId: swap.id,
            shiftId: currentShift.id,
          },
          dedupeKey: `swap:${swap.id}:requested:${input.targetUserId}`,
        });
      } else {
        // Open swap: notify team managers and owner
        const managers = await tx.memberships.findMany({
          where: {
            team_id: teamId,
            role: { in: ['owner', 'manager'] },
          },
          select: { user_id: true },
        });
        for (const mgr of managers) {
          if (mgr.user_id !== userId) {
            await enqueueNotification(tx, {
              recipientUserId: mgr.user_id,
              category: 'swap.requested',
              payload: {
                teamId,
                swapId: swap.id,
                shiftId: currentShift.id,
              },
              dedupeKey: `swap:${swap.id}:requested:${mgr.user_id}`,
            });
          }
        }
      }

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
        note: swap.note ?? undefined,
        cancelledBy: null,
        cancelledAt: null,
      };

      return view;
    });

    // Update idempotency row to 'done' (state IN ('in_flight', 'done'))
    await client.idempotency_keys.update({
      where: { scope_key: { scope, key: idempotencyKey } },
      data: {
        state: 'done',
        status_code: 201,
        response: createdSwap as unknown as JsonInput,
      },
    });
  } catch (err: unknown) {
    await client.idempotency_keys
      .delete({ where: { scope_key: { scope, key: idempotencyKey } } })
      .catch(() => undefined);

    // Catch unique constraint violation (swaps_one_pending_idx)
    if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002') {
      throw new HttpError(409, 'swap.already_pending', authMessage('swap.already_pending'));
    }
    throw err;
  }

  // Trigger outbox sweeper after commit (best-effort kick; Phase 6 Stage 4)
  try {
    await getQueue('push').add('sweep-outbox', {});
  } catch (err) {
    log.warn({ err }, 'failed to trigger sweep-outbox');
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
          deleted_at: true,
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

  const isManagerOrOwner = membership.role === 'owner' || membership.role === 'manager';
  const swaps: SwapRequestView[] = slice.map((s) => {
    const isPrivileged = isManagerOrOwner || s.requested_by === userId || s.target_user_id === userId;
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
      shiftDeleted: s.shifts ? s.shifts.deleted_at !== null : undefined,
      requesterName: namesMap.get(s.requested_by),
      targetName: s.target_user_id ? namesMap.get(s.target_user_id) : null,
      ...(isPrivileged
        ? {
            note: s.note ?? undefined,
            declineReason: s.decline_reason ?? undefined,
            cancelledBy: s.cancelled_by ?? null,
            cancelledAt: s.cancelled_at ? iso(s.cancelled_at) : null,
          }
        : {}),
    };
  });

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
          deleted_at: true,
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

  const isPrivileged =
    membership.role === 'owner' ||
    membership.role === 'manager' ||
    s.requested_by === userId ||
    s.target_user_id === userId;

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
    shiftDeleted: s.shifts ? s.shifts.deleted_at !== null : undefined,
    requesterName: namesMap.get(s.requested_by),
    targetName: s.target_user_id ? namesMap.get(s.target_user_id) : null,
    ...(isPrivileged
      ? {
          note: s.note ?? undefined,
          declineReason: s.decline_reason ?? undefined,
          cancelledBy: s.cancelled_by ?? null,
          cancelledAt: s.cancelled_at ? iso(s.cancelled_at) : null,
        }
      : {}),
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
        note: string | null;
        decline_reason: string | null;
        cancelled_by: string | null;
        cancelled_at: Date | null;
        created_at: Date;
        updated_at: Date;
      }>
    >`SELECT id, team_id, shift_id, requested_by, target_user_id, status, note, decline_reason, cancelled_by, cancelled_at, created_at, updated_at
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
    if (!lockedShift) {
      throw new HttpError(404, 'shift.notFound', authMessage('shift.notFound'));
    }
    if (lockedShift.deleted_at !== null) {
      throw new HttpError(409, 'swap.shift_deleted', authMessage('swap.shift_deleted'));
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
          audience: 'involved',
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

      // Enqueue notification in transactional outbox for requester and target colleague (Phase 6 Stage 4; PRD 8.7)
      const notifyRecipients = new Set<string>();
      if (lockedSwap.requested_by) notifyRecipients.add(lockedSwap.requested_by);
      if (finalTarget) notifyRecipients.add(finalTarget);
      for (const recipientId of notifyRecipients) {
        await enqueueNotification(tx, {
          recipientUserId: recipientId,
          category: 'swap.approved',
          payload: {
            teamId,
            swapId: lockedSwap.id,
            shiftId: lockedShift.id,
          },
          dedupeKey: `swap:${lockedSwap.id}:approved:${recipientId}`,
        });
      }

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
        note: updated.note ?? undefined,
        declineReason: updated.decline_reason ?? undefined,
        cancelledBy: updated.cancelled_by ?? null,
        cancelledAt: updated.cancelled_at ? iso(updated.cancelled_at) : null,
      };
    } else {
      // Rejected
      const updated = await tx.swap_requests.update({
        where: { id: lockedSwap.id },
        data: {
          status: 'rejected',
          decline_reason: input.declineReason,
          decided_by: userId,
          decided_at: now,
          updated_at: now,
        },
      });

      await tx.activity_events.create({
        data: {
          team_id: teamId,
          kind: 'swap.rejected',
          audience: 'involved',
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

      // Enqueue notification in transactional outbox for requester (Phase 6 Stage 4; PRD 8.7)
      await enqueueNotification(tx, {
        recipientUserId: lockedSwap.requested_by,
        category: 'swap.rejected',
        payload: {
          teamId,
          swapId: lockedSwap.id,
          shiftId: lockedShift.id,
        },
        dedupeKey: `swap:${lockedSwap.id}:rejected:${lockedSwap.requested_by}`,
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
        note: updated.note ?? undefined,
        declineReason: updated.decline_reason ?? undefined,
        cancelledBy: updated.cancelled_by ?? null,
        cancelledAt: updated.cancelled_at ? iso(updated.cancelled_at) : null,
      };
    }
  });

  // Trigger outbox sweeper after commit (best-effort kick; Phase 6 Stage 4)
  try {
    await getQueue('push').add('sweep-outbox', {});
  } catch (err) {
    log.warn({ err }, 'failed to trigger sweep-outbox');
  }

  return result;
}

export type AutoCancelReason = 'shift_reassigned' | 'shift_deleted';

async function applySwapCancellation(
  tx: ShardTx,
  teamId: string,
  swapId: string,
  shiftId: string,
  actorUserId: string,
  now: Date,
  reasonCode?: AutoCancelReason,
) {
  const updated = await tx.swap_requests.update({
    where: { id: swapId },
    data: {
      status: 'cancelled',
      cancelled_by: actorUserId,
      cancelled_at: now,
      updated_at: now,
    },
  });

  await tx.activity_events.create({
    data: {
      team_id: teamId,
      kind: 'swap.cancelled',
      audience: 'involved',
      actor_user_id: actorUserId,
      subject_id: swapId,
      data: {
        swapId,
        shiftId,
        cancelledBy: actorUserId,
        ...(reasonCode ? { reason: reasonCode } : {}),
      },
    },
  });

  // Enqueue notification in transactional outbox for involved colleagues (Phase 6 Stage 4; PRD 8.7)
  const cancelRecipients = new Set<string>();
  if (updated.requested_by && updated.requested_by !== actorUserId) {
    cancelRecipients.add(updated.requested_by);
  }
  if (updated.target_user_id && updated.target_user_id !== actorUserId) {
    cancelRecipients.add(updated.target_user_id);
  }
  for (const recipientId of cancelRecipients) {
    await enqueueNotification(tx, {
      recipientUserId: recipientId,
      category: 'swap.cancelled',
      payload: {
        teamId,
        swapId,
        shiftId,
      },
      dedupeKey: `swap:${swapId}:cancelled:${recipientId}`,
    });
  }

  return updated;
}

/**
 * Automatically cancel any pending swaps for a shift (e.g. when reassigned or deleted).
 * Acquires row locks on pending swaps FOR UPDATE.
 * Must be called BEFORE updating or locking the shift row to maintain consistent lock ordering with decideSwap.
 */
export async function cancelPendingSwapsForShift(
  tx: ShardTx,
  teamId: string,
  shiftId: string,
  actorUserId: string,
  reasonCode: AutoCancelReason,
): Promise<number> {
  const lockedSwaps = await tx.$queryRaw<
    Array<{
      id: string;
      team_id: string;
      shift_id: string;
      requested_by: string;
      target_user_id: string | null;
      status: string;
    }>
  >`SELECT id, team_id, shift_id, requested_by, target_user_id, status
    FROM swap_requests
    WHERE shift_id = ${shiftId}::uuid AND team_id = ${teamId}::uuid AND status = 'pending'
    FOR UPDATE`;

  if (lockedSwaps.length === 0) {
    return 0;
  }

  const now = new Date();
  for (const swap of lockedSwaps) {
    await applySwapCancellation(tx, teamId, swap.id, swap.shift_id, actorUserId, now, reasonCode);
  }

  return lockedSwaps.length;
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

  const result = await teamTransaction(teamId, async (tx: ShardTx) => {
    const lockedSwaps = await tx.$queryRaw<
      Array<{
        id: string;
        team_id: string;
        shift_id: string;
        requested_by: string;
        target_user_id: string | null;
        status: string;
        note: string | null;
        decline_reason: string | null;
        cancelled_by: string | null;
        cancelled_at: Date | null;
        created_at: Date;
        updated_at: Date;
      }>
    >`SELECT id, team_id, shift_id, requested_by, target_user_id, status, note, decline_reason, cancelled_by, cancelled_at, created_at, updated_at
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
    const updated = await applySwapCancellation(
      tx,
      teamId,
      lockedSwap.id,
      lockedSwap.shift_id,
      userId,
      now,
    );

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
      note: updated.note ?? undefined,
      declineReason: updated.decline_reason ?? undefined,
      cancelledBy: updated.cancelled_by ?? null,
      cancelledAt: updated.cancelled_at ? iso(updated.cancelled_at) : null,
    };
  });

  // Trigger outbox sweeper after commit (best-effort kick; Phase 6 Stage 4)
  try {
    await getQueue('push').add('sweep-outbox', {});
  } catch (err) {
    log.warn({ err }, 'failed to trigger sweep-outbox');
  }

  return result;
}
