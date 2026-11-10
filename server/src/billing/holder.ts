// Billing holder (Task 8, Stage 1, PRD 8.6 + ADR 0023).
// Billing follows the billing holder (subscriptions.billing_user_id), not a role.
// Team ownership transfer NEVER moves billing.

import { forTeam, globalDb, shardTransaction, type ShardClient, type ShardTx } from '../db/clients.ts';
import { shardFor, type Shard } from '../db/shard.ts';
import { enqueueNotification } from '../notifications/outbox.ts';
import { enqueueEmail } from '../jobs/email/enqueue.ts';
import type { EmailJobData } from '../jobs/email/types.ts';
import { logger } from '../lib/logger.ts';
import { HttpError } from '../middleware/error.ts';

const log = logger.child({ module: 'billing-holder' });

export interface CancelledHandoverRow {
  id: string;
  from_user_id: string;
  to_user_id: string;
}

/** Check whether the user is the billing holder for the team. */
export async function isBillingHolder(userId: string, teamId: string): Promise<boolean> {
  const client = forTeam(teamId);
  const sub = await client.subscriptions.findUnique({ where: { team_id: teamId } });
  if (!sub) return false;
  return sub.billing_user_id === userId;
}

/** Check whether the user is the Admin (role 'owner') of the team. */
export async function isAdmin(userId: string, teamId: string): Promise<boolean> {
  const client = forTeam(teamId);
  const membership = await client.memberships.findUnique({
    where: { team_id_user_id: { team_id: teamId, user_id: userId } },
  });
  return membership?.role === 'owner' && membership.removed_at === null;
}

/** Get the billing holder user id for the team, or null if none. */
export async function getBillingHolder(teamId: string): Promise<string | null> {
  const client = forTeam(teamId);
  const sub = await client.subscriptions.findUnique({ where: { team_id: teamId } });
  if (!sub) return null;
  return sub.billing_user_id ?? null;
}

/**
 * Take over billing: the caller must be the current Admin (owner). Sets billing_user_id and
 * provider_authorization_ref on the subscription. Single code path shared by take-over and
 * hand-over accept. Can run inside a shard transaction if tx is provided.
 */
export async function takeOverBilling(
  adminUserId: string,
  teamId: string,
  authorizationRef: string,
  tx?: ShardTx,
): Promise<{ tookOver: boolean }> {
  const client: ShardClient = tx ? (tx as unknown as ShardClient) : forTeam(teamId);

  const isAdminUser = await isAdmin(adminUserId, teamId);
  if (!isAdminUser) {
    throw new HttpError(403, 'billing.admin_only', 'Only the Admin (owner) can take over billing.');
  }

  const sub = await client.subscriptions.findUnique({ where: { team_id: teamId } });
  if (!sub) throw new HttpError(404, 'billing.not_found', 'No subscription for this team.');
  if (sub.billing_user_id === adminUserId) {
    throw new HttpError(422, 'billing.already_holder', 'You are already the billing holder.');
  }

  // The Admin becomes the holder; old holder's payment reference is replaced.
  await client.subscriptions.update({
    where: { team_id: teamId },
    data: {
      billing_user_id: adminUserId,
      provider_authorization_ref: authorizationRef,
      updated_at: new Date(),
    },
  });

  return { tookOver: true };
}

/** Cancel any open move/hand-over request for the team (legacy subscription-linked and account-level).
 * If departingUserId is provided, cancels open moves where departingUserId is from_user_id or to_user_id.
 * If departingUserId is not provided, cancels all open moves for the team.
 * Returns the cancelled rows and sends moveCancelled push + email to the counterpart for each row.
 */
export async function cancelOpenHandover(
  teamId: string,
  departingUserId?: string,
): Promise<CancelledHandoverRow[]> {
  const client = forTeam(teamId);
  const sub = await client.subscriptions.findUnique({ where: { team_id: teamId } });

  const rows = await client.$queryRaw<CancelledHandoverRow[]>`
    UPDATE billing_handovers
    SET status = 'cancelled', resolved_at = now()
    WHERE team_id = ${teamId}::uuid
      AND status = 'requested'
      AND (
        ${departingUserId ? departingUserId : null}::uuid IS NULL
        OR from_user_id = ${departingUserId}::uuid
        OR to_user_id = ${departingUserId}::uuid
      )
      AND (subscription_id IS NULL OR subscription_id = ${sub?.id ?? null}::uuid)
    RETURNING id, from_user_id, to_user_id
  `;

  for (const row of rows) {
    const otherUserId = departingUserId && row.from_user_id === departingUserId
      ? row.to_user_id
      : departingUserId && row.to_user_id === departingUserId
      ? row.from_user_id
      : row.to_user_id;

    const departingId = departingUserId ?? (otherUserId === row.to_user_id ? row.from_user_id : row.to_user_id);

    // 1. Push notification via transactional outbox on team's shard
    try {
      await shardTransaction(shardFor(teamId) as Shard, async (tx) => {
        await enqueueNotification(tx, {
          recipientUserId: otherUserId,
          category: 'billing.move_cancelled',
          payload: { teamId, moveId: row.id },
          dedupeKey: `billing:move:${row.id}:cancelled:${otherUserId}`,
        });
      });
    } catch (err: unknown) {
      const errorCode = (err as { code?: string })?.code ?? 'OUTBOX_ERROR';
      log.warn({ errorCode, teamId, moveId: row.id }, 'failed to enqueue move_cancelled push');
    }

    // 2. Email notification
    try {
      const db0 = globalDb();
      const otherUser = await db0.users.findUnique({
        where: { id: otherUserId },
        select: { email: true },
      });
      const departingUser = departingId ? await db0.users.findUnique({
        where: { id: departingId },
        select: { display_name: true },
      }) : null;
      const teamRow = await client.teams.findUnique({
        where: { id: teamId },
        select: { name: true },
      });

      if (otherUser?.email && teamRow) {
        await enqueueEmail({
          kind: 'moveCancelled',
          email: otherUser.email,
          team: teamRow.name,
          from: departingUser?.display_name || 'The team',
        } as EmailJobData, {
          dedupeKey: `email:move:${row.id}:cancelled:${otherUserId}`,
        });
      }
    } catch (err: unknown) {
      const errorCode = (err as { code?: string })?.code ?? 'EMAIL_ERROR';
      log.warn({ errorCode, teamId, moveId: row.id }, 'failed to enqueue moveCancelled email');
    }
  }

  return rows;
}

/**
 * Shared helper for removeMember, leaveTeam, transferTeam.
 * Cancels open handovers/moves for the team and departing user, dispatches notifications,
 * catches any error, logs errorCode, and never throws.
 */
export async function cancelOpenHandoverSafe(
  teamId: string,
  departingUserId?: string,
): Promise<CancelledHandoverRow[]> {
  try {
    return await cancelOpenHandover(teamId, departingUserId);
  } catch (err: unknown) {
    const errorCode = (err as { code?: string })?.code ?? 'CANCEL_OPEN_HANDOVER_ERROR';
    log.warn({ errorCode, teamId, departingUserId }, 'failed to cancel open handover');
    return [];
  }
}
