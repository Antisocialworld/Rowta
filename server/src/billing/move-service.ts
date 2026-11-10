// Account-level move billing service (C6).
// Moves a team's billing from one owner account to another.
// Reuses billing_handovers (one-open partial unique index, 7-day lazy expiry, notifications).
// No payment_intents markers are written for account-level moves (T13).
// NOT wired into live paths until C7 — old hand-over routes remain in place.
// Money is integer kobo; BigInt in DB; no floats. NAIRA ONLY.
import { randomUUID } from 'node:crypto';
import { globalDb, forTeam } from '../db/clients.ts';
import { shardFor, type Shard } from '../db/shard.ts';
import { shardTransaction } from '../db/clients.ts';
import { HttpError } from '../middleware/error.ts';
import { enqueueNotification } from '../notifications/outbox.ts';
import { enqueueEmail } from '../jobs/email/enqueue.ts';
import { loadOwnerAccount, loadPlanEntitlements, loadTeamRegistry, applyCoverage } from './entitlements.ts';
import type { EmailJobData } from '../jobs/email/types.ts';

export interface MoveView {
  readonly id: string;
  readonly status: 'requested' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  readonly fromUserId: string;
  readonly toUserId: string;
  readonly teamId: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly resolvedAt: Date | null;
}

const MOVE_TTL_DAYS = 7;

/** Look up a user's email and display name for billing notices (best effort). */
async function userEmailAndName(userId: string): Promise<{ email: string; name: string } | null> {
  const db0 = globalDb();
  const user = await db0.users.findUnique({
    where: { id: userId },
    select: { email: true, display_name: true },
  });
  if (!user) return null;
  return { email: user.email, name: user.display_name ?? '' };
}

/** Request an account-level billing move. Only the current paying owner can start it. */
export async function requestMove(
  ownerUserId: string,
  teamId: string,
  receiverUserId: string,
  _idempotencyKey: string,
): Promise<{ moveId: string }> {
  const db0 = globalDb();

  // Caller must be the current paying owner (account holder).
  const account = await loadOwnerAccount(ownerUserId);
  if (!account || (account.status !== 'active' && account.status !== 'trialing')) {
    throw new HttpError(422, 'billing.account_not_active', 'Only an active paying owner can start a move.');
  }

  // T14: Caller must be an active member of the team AND the team's current payer.
  const client = forTeam(teamId);
  const callerMembership = await client.memberships.findUnique({
    where: { team_id_user_id: { team_id: teamId, user_id: ownerUserId } },
  });
  if (!callerMembership || callerMembership.removed_at !== null) {
    throw new HttpError(403, 'billing.not_payer', 'Only the team payer can request a billing move.');
  }

  const registry = await loadTeamRegistry(teamId);
  if (!registry || registry.ownerUserId !== ownerUserId) {
    throw new HttpError(403, 'billing.not_payer', 'Only the team payer can request a billing move.');
  }
  if (registry.status === 'cancelled' || registry.status === 'read_only') {
    throw new HttpError(
      403,
      'billing.not_payer',
      'The team payer cannot move billing while the team is cancelled or read-only.',
    );
  }

  // Receiver must be the current Admin (owner role) of the team and not the caller.
  const receiverMembership = await client.memberships.findUnique({
    where: { team_id_user_id: { team_id: teamId, user_id: receiverUserId } },
  });
  if (!receiverMembership || receiverMembership.role !== 'owner' || receiverMembership.removed_at !== null) {
    throw new HttpError(422, 'billing.move_target_not_admin', 'Receiver must be the current Admin of this team.');
  }
  if (receiverUserId === ownerUserId) {
    throw new HttpError(422, 'billing.move_same_user', 'Cannot move billing to yourself.');
  }

  // T14: Receiver must have a working user account (not deleted/disabled). No billing account
  // is required to receive a request — the receiver may get a trial on accept (T15a).
  const receiverUser = await db0.users.findUnique({
    where: { id: receiverUserId },
    select: { id: true, status: true, deleted_at: true },
  });
  if (!receiverUser || receiverUser.status === 'pending_deletion' || receiverUser.deleted_at !== null) {
    throw new HttpError(422, 'billing.receiver_invalid', 'Receiver must have an active user account.');
  }

  // G3-1: Close any stale expired move for this team before checking for conflicts.
  // If we close one, enqueue move_expired to from_user_id (same as lazy-expiry path).
  const shard = shardFor(teamId);
  await shardTransaction(shard as Shard, async (tx) => {
    const expiredMove = await tx.billing_handovers.findFirst({
      where: {
        team_id: teamId,
        subscription_id: null,
        status: 'requested',
        expires_at: { lte: new Date() },
      },
    });
    if (expiredMove) {
      await tx.billing_handovers.update({
        where: { id: expiredMove.id },
        data: { status: 'expired', resolved_at: new Date() },
      });
      await enqueueNotification(tx, {
        recipientUserId: expiredMove.from_user_id,
        category: 'billing.move_expired',
        payload: { teamId, moveId: expiredMove.id },
        dedupeKey: `billing:move:${expiredMove.id}:expired`,
      });
    }
  });

  // T13: Idempotency via move state, not payment_intents. If an open 'requested' move for this
  // team from this caller to this receiver exists, return its id. If an open move exists for
  // different parties, keep the 409.
  const existingMove = await client.billing_handovers.findFirst({
    where: {
      team_id: teamId,
      subscription_id: null,
      status: 'requested',
    },
    orderBy: { created_at: 'desc' },
  });
  if (existingMove) {
    if (existingMove.from_user_id === ownerUserId && existingMove.to_user_id === receiverUserId) {
      return { moveId: existingMove.id };
    }
    throw new HttpError(409, 'billing.move_exists', 'An open move already exists for this team.');
  }

  const moveId = randomUUID();
  const expiresAt = new Date(Date.now() + MOVE_TTL_DAYS * 24 * 60 * 60 * 1000);

  // One open account-level move per team (partial unique index).
  try {
    await shardTransaction(shard as Shard, async (tx) => {
      await tx.billing_handovers.create({
        data: {
          id: moveId,
          subscription_id: null,
          team_id: teamId,
          from_user_id: ownerUserId,
          to_user_id: receiverUserId,
          status: 'requested',
          expires_at: expiresAt,
        },
      });
      await enqueueNotification(tx, {
        recipientUserId: receiverUserId,
        category: 'billing.move_requested',
        payload: { teamId, moveId },
        dedupeKey: `billing:move:${moveId}:requested`,
      });
    });
  } catch (err) {
    // Unique-index violation -> conflict.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('one_open_per_team')) {
      throw new HttpError(409, 'billing.move_exists', 'An open move already exists for this team.');
    }
    throw err;
  }

  // T17: move_requested notice to the receiver (push already enqueued in shard tx).
  const teamRow = await client.teams.findUnique({
    where: { id: teamId },
    select: { name: true },
  });
  const receiver = await userEmailAndName(receiverUserId);
  const payer = await userEmailAndName(ownerUserId);
  if (teamRow && receiver && payer) {
    try {
      await enqueueEmail({
        kind: 'moveRequested',
        email: receiver.email,
        team: teamRow.name,
        from: payer.name,
        date: expiresAt.toISOString(),
      } as EmailJobData);
    } catch {
      // Notification failure must not fail the move.
    }
  }

  return { moveId };
}

/** Get the current open move for a team. */
export async function getMove(teamId: string, userId: string): Promise<MoveView | null> {
  const client = forTeam(teamId);

  // Only members can view (holder or Admin).
  const membership = await client.memberships.findUnique({
    where: { team_id_user_id: { team_id: teamId, user_id: userId } },
  });
  if (!membership || membership.removed_at !== null) {
    throw new HttpError(404, 'team.notFound', 'Team not found.');
  }

  const row = await client.billing_handovers.findFirst({
    where: {
      team_id: teamId,
      subscription_id: null,
      status: 'requested',
    },
    orderBy: { created_at: 'desc' },
  });
  if (!row) return null;

  // Lazy expiry (T17: enqueue move_expired notice to previous payer when read as expired).
  const now = new Date();
  const isExpired = row.expires_at.getTime() <= now.getTime();
  const status = (isExpired ? 'expired' : row.status) as MoveView['status'];

  return {
    id: row.id,
    status,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    teamId: row.team_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

/** Accept a move. Admin (receiver) only. Idempotency-Key required. Atomic. */
export async function acceptMove(
  receiverUserId: string,
  teamId: string,
  moveId: string,
  _idempotencyKey: string,
): Promise<{ accepted: boolean }> {
  const db0 = globalDb();
  const client = forTeam(teamId);

  // Receiver must be the current Admin.
  const membership = await client.memberships.findUnique({
    where: { team_id_user_id: { team_id: teamId, user_id: receiverUserId } },
  });
  if (!membership || membership.role !== 'owner' || membership.removed_at !== null) {
    throw new HttpError(403, 'billing.admin_only', 'Only the Admin can accept a move.');
  }

  const move = await client.billing_handovers.findUnique({ where: { id: moveId } });
  if (!move || move.team_id !== teamId || move.subscription_id !== null) {
    throw new HttpError(404, 'billing.move_not_found', 'Move request not found.');
  }

  // T13/T15: Idempotent replay — if already accepted to this receiver, return without side effects.
  if (move.status === 'accepted' && move.to_user_id === receiverUserId) {
    return { accepted: true };
  }
  if (move.status !== 'requested') {
    throw new HttpError(422, 'billing.move_not_requested', 'Move request is no longer open.');
  }
  if (move.to_user_id !== receiverUserId) {
    throw new HttpError(403, 'billing.not_recipient', 'Only the recipient Admin can accept this move.');
  }

  // Re-check: receiver is still the current Admin (verified above).
  // Lazy expiry.
  const now = new Date();
  if (move.expires_at.getTime() <= now.getTime()) {
    await client.billing_handovers.update({
      where: { id: moveId },
      data: { status: 'expired', resolved_at: now },
    });
    throw new HttpError(422, 'billing.move_expired', 'This move request has expired.');
  }

  // T15: Determine the accept outcome inside db0, using existing capacity helpers.
  const receiverAccount = await loadOwnerAccount(receiverUserId);
  let registryStatus: 'active' | 'pending_payment';
  let isExtra: boolean;

  if (!receiverAccount) {
    // T15a: Receiver has NO owner_account ever: create a normal 14-day trial exactly as
    // first-team creation does. Never a second trial — trial_used is unique and loadOwnerAccount
    // returned null so this user never had an account.
    await db0.owner_accounts.create({
      data: {
        user_id: receiverUserId,
        plan: 'monthly',
        status: 'trialing',
        trial_started_at: new Date(),
        trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        trial_used: true,
        period_start: new Date(),
        period_end: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        currency: 'NGN',
      },
    });
    registryStatus = 'active';
    isExtra = false;
  } else {
    // Lock the receiver's account row to serialize concurrent accepts.
    await db0.$queryRaw<{ user_id: string }[]>`
      SELECT user_id FROM owner_accounts WHERE user_id = ${receiverUserId}::uuid FOR UPDATE
    `;

    const entitlements = receiverAccount.status === 'active' || receiverAccount.status === 'trialing'
      ? await loadPlanEntitlements(receiverAccount.plan)
      : null;

    if (!entitlements) {
      // Account in any other status (past_due, cancelled, lapsed): move still completes,
      // team restricted pending payment (T15c).
      registryStatus = 'pending_payment';
      isExtra = false;
    } else {
      // Count receiver's teams to check capacity (existing helper logic, no own arithmetic).
      const receiverTeams = await db0.owner_team_registry.count({
        where: { owner_user_id: receiverUserId },
      });
      const freeAllowance = receiverAccount.status === 'trialing'
        ? entitlements.trialTeams
        : entitlements.freeTeams;

      // T15d: Receiver at the account team cap → 422, nothing changes.
      if (receiverTeams >= entitlements.maxTeams) {
        throw new HttpError(422, 'billing.receiver_team_cap', 'Receiver has no free team slots.');
      }

      if (receiverTeams >= freeAllowance) {
        // T15c: trialing with no free slot, or active and the team would be extra.
        registryStatus = 'pending_payment';
        isExtra = true;
      } else {
        // T15b: receiver active/trialing and the team fits a FREE slot.
        registryStatus = 'active';
        isExtra = false;
      }
    }
  }

  // T15: Guarded registry update — change owner from from_user_id to receiverUserId.
  const currentRegistry = await loadTeamRegistry(teamId);
  if (!currentRegistry || currentRegistry.ownerUserId !== move.from_user_id) {
    if (currentRegistry?.ownerUserId === receiverUserId) {
      // Already moved to receiver (idempotent retry after shard failure) — proceed to shard step.
    } else {
      throw new HttpError(404, 'billing.move_not_found', 'Move request not found.');
    }
  }
  await db0.owner_team_registry.update({
    where: { team_id: teamId },
    data: {
      owner_user_id: receiverUserId,
      status: registryStatus,
      is_extra: isExtra,
    },
  });

  // T15: Shard transaction — handover accepted, team coverage, activity event, notification.
  const shard = shardFor(teamId);
  await shardTransaction(shard as Shard, async (tx) => {
    // Re-check under lock.
    const current = await tx.billing_handovers.findUnique({ where: { id: moveId } });
    if (!current || current.status !== 'requested') {
      throw new HttpError(422, 'billing.move_not_requested', 'Move request is no longer open.');
    }

    // Update team row coverage cache.
    await tx.teams.update({
      where: { id: teamId },
      data: {
        coverage_status: registryStatus,
        is_extra: isExtra,
        coverage_updated_at: now,
      },
    });

    // Mark move accepted.
    await tx.billing_handovers.update({
      where: { id: moveId },
      data: { status: 'accepted', resolved_at: now },
    });

    // Activity event.
    await tx.activity_events.create({
      data: {
        team_id: teamId,
        kind: 'billing.move_accepted',
        actor_user_id: receiverUserId,
        audience: 'managers',
        data: { moveId, fromUserId: move.from_user_id, toUserId: receiverUserId },
      },
    });

    // T17: Notices on accept — push via outbox (ids only), email via enqueueEmail after tx.
    if (registryStatus === 'pending_payment') {
      await enqueueNotification(tx, {
        recipientUserId: receiverUserId,
        category: 'billing.move_payment_needed',
        payload: { teamId, moveId },
        dedupeKey: `billing:move:${moveId}:payment_needed`,
      });
    } else if (registryStatus === 'active' && !receiverAccount) {
      // T15a: trial started.
      await enqueueNotification(tx, {
        recipientUserId: receiverUserId,
        category: 'billing.move_trial_started',
        payload: { teamId, moveId },
        dedupeKey: `billing:move:${moveId}:trial_started`,
      });
    }
    await enqueueNotification(tx, {
      recipientUserId: move.from_user_id,
      category: 'billing.move_accepted',
      payload: { teamId, moveId },
      dedupeKey: `billing:move:${moveId}:accepted`,
    });
  });

  // T16: When a move is accepted, mark any open 'pending' payment_intents from the previous
  // payer that include this team as 'expired', so a late payment cannot be taken for a team
  // they no longer pay for.
  await db0.payment_intents.updateMany({
    where: {
      team_id: teamId,
      created_by: move.from_user_id,
      status: 'pending',
    },
    data: { status: 'expired', completed_at: now },
  });

  // T15: Recalculate coverage for both accounts.
  await applyCoverage(move.from_user_id);
  await applyCoverage(receiverUserId);

  // T17: move_accepted notice to the previous payer (push already enqueued in shard tx).
  const teamRow = await client.teams.findUnique({
    where: { id: teamId },
    select: { name: true },
  });
  const payer = await userEmailAndName(move.from_user_id);
  const receiver = await userEmailAndName(receiverUserId);
  if (teamRow && payer) {
    try {
      await enqueueEmail({
        kind: 'moveAccepted',
        email: payer.email,
        team: teamRow.name,
        name: receiver ? receiver.name : '',
      } as EmailJobData);
    } catch {
      // Notification failure must not fail the move.
    }
  }
  // T17: move_trial_started (outcome a) or move_payment_needed (outcome c) to the receiver.
  if (receiver && teamRow) {
    if (!receiverAccount) {
      // Outcome a: trial started.
      try {
        await enqueueEmail({
          kind: 'moveTrialStarted',
          email: receiver.email,
          team: teamRow.name,
          date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        } as EmailJobData);
      } catch {
        // Notification failure must not fail the move.
      }
    } else if (registryStatus === 'pending_payment') {
      // Outcome c: payment needed.
      try {
        await enqueueEmail({
          kind: 'movePaymentNeeded',
          email: receiver.email,
          team: teamRow.name,
          name: receiver.name,
        } as EmailJobData);
      } catch {
        // Notification failure must not fail the move.
      }
    }
  }

  return { accepted: true };
}

/** Decline a move. Admin (receiver) only. */
export async function declineMove(
  receiverUserId: string,
  teamId: string,
  moveId: string,
): Promise<{ declined: boolean }> {
  const client = forTeam(teamId);

  const membership = await client.memberships.findUnique({
    where: { team_id_user_id: { team_id: teamId, user_id: receiverUserId } },
  });
  if (!membership || membership.role !== 'owner' || membership.removed_at !== null) {
    throw new HttpError(403, 'billing.admin_only', 'Only the Admin can decline a move.');
  }

  const move = await client.billing_handovers.findUnique({ where: { id: moveId } });
  if (!move || move.team_id !== teamId || move.subscription_id !== null) {
    throw new HttpError(404, 'billing.move_not_found', 'Move request not found.');
  }
  if (move.status !== 'requested') {
    throw new HttpError(422, 'billing.move_not_requested', 'Move request is no longer open.');
  }
  if (move.to_user_id !== receiverUserId) {
    throw new HttpError(403, 'billing.not_recipient', 'Only the recipient Admin can decline this move.');
  }

  const now = new Date();
  if (move.expires_at.getTime() <= now.getTime()) {
    // T17: move_expired notice to the previous payer (push + email) on lazy expiry.
    await shardTransaction(shardFor(teamId) as Shard, async (tx) => {
      await tx.billing_handovers.update({
        where: { id: moveId },
        data: { status: 'expired', resolved_at: now },
      });
      await enqueueNotification(tx, {
        recipientUserId: move.from_user_id,
        category: 'billing.move_expired',
        payload: { teamId, moveId },
        dedupeKey: `billing:move:${moveId}:expired`,
      });
    });
    const payer = await userEmailAndName(move.from_user_id);
    const teamRow = await client.teams.findUnique({
      where: { id: teamId },
      select: { name: true },
    });
    if (payer && teamRow) {
      try {
        await enqueueEmail({
          kind: 'moveExpired',
          email: payer.email,
          team: teamRow.name,
          name: payer.name,
          date: move.expires_at.toISOString(),
        } as EmailJobData);
      } catch {
        // Notification failure must not fail the decline.
      }
    }
    throw new HttpError(422, 'billing.move_expired', 'This move request has expired.');
  }

  await shardTransaction(shardFor(teamId) as Shard, async (tx) => {
    await tx.billing_handovers.update({
      where: { id: moveId },
      data: { status: 'declined', resolved_at: now },
    });
    await enqueueNotification(tx, {
      recipientUserId: move.from_user_id,
      category: 'billing.move_declined',
      payload: { teamId, moveId },
      dedupeKey: `billing:move:${moveId}:declined`,
    });
  });

  const payer = await userEmailAndName(move.from_user_id);
  const teamRow = await client.teams.findUnique({
    where: { id: teamId },
    select: { name: true },
  });
  if (payer && teamRow) {
    try {
      await enqueueEmail({
        kind: 'moveDeclined',
        email: payer.email,
        team: teamRow.name,
        name: payer.name,
      } as EmailJobData);
    } catch {
      // Notification failure must not fail the decline.
    }
  }

  return { declined: true };
}

/** Cancel a move. Current owner only. */
export async function cancelMove(
  ownerUserId: string,
  teamId: string,
  moveId: string,
): Promise<{ cancelled: boolean }> {
  const client = forTeam(teamId);

  const move = await client.billing_handovers.findUnique({ where: { id: moveId } });
  if (!move || move.team_id !== teamId || move.subscription_id !== null) {
    throw new HttpError(404, 'billing.move_not_found', 'Move request not found.');
  }
  if (move.status !== 'requested') {
    throw new HttpError(422, 'billing.move_not_requested', 'Move request is no longer open.');
  }
  if (move.from_user_id !== ownerUserId) {
    throw new HttpError(403, 'billing.not_holder', 'Only the owner can cancel this move.');
  }

  const now = new Date();
  if (move.expires_at.getTime() <= now.getTime()) {
    // T17: move_expired notice to the previous payer (push + email) on lazy expiry.
    await shardTransaction(shardFor(teamId) as Shard, async (tx) => {
      await tx.billing_handovers.update({
        where: { id: moveId },
        data: { status: 'expired', resolved_at: now },
      });
      await enqueueNotification(tx, {
        recipientUserId: move.from_user_id,
        category: 'billing.move_expired',
        payload: { teamId, moveId },
        dedupeKey: `billing:move:${moveId}:expired`,
      });
    });
    const payer = await userEmailAndName(move.from_user_id);
    const teamRow = await client.teams.findUnique({
      where: { id: teamId },
      select: { name: true },
    });
    if (payer && teamRow) {
      try {
        await enqueueEmail({
          kind: 'moveExpired',
          email: payer.email,
          team: teamRow.name,
          name: payer.name,
          date: move.expires_at.toISOString(),
        } as EmailJobData);
      } catch {
        // Notification failure must not fail the cancel.
      }
    }
    throw new HttpError(422, 'billing.move_expired', 'This move request has expired.');
  }

  await shardTransaction(shardFor(teamId) as Shard, async (tx) => {
    await tx.billing_handovers.update({
      where: { id: moveId },
      data: { status: 'cancelled', resolved_at: now },
    });
    await enqueueNotification(tx, {
      recipientUserId: move.to_user_id,
      category: 'billing.move_cancelled',
      payload: { teamId, moveId },
      dedupeKey: `billing:move:${moveId}:cancelled`,
    });
  });

  const receiver = await userEmailAndName(move.to_user_id);
  const teamRow = await client.teams.findUnique({
    where: { id: teamId },
    select: { name: true },
  });
  if (receiver && teamRow) {
    try {
      await enqueueEmail({
        kind: 'moveCancelled',
        email: receiver.email,
        team: teamRow.name,
        from: receiver.name,
      } as EmailJobData);
    } catch {
      // Notification failure must not fail the cancel.
    }
  }

  return { cancelled: true };
}
