// Billing hand-over (Stage 2, PRD 8.6 + ADR 0023).
// Hand-over moves the billing holder to the current Admin (role 'owner'). Exists only when
// the holder is not the Admin. States: requested -> accepted | declined | cancelled | expired.
// Expiry is 7 days from created_at, lazy (computed when read). Writes are idempotent and
// transactional on the shard. No money moves at hand-over; the current period continues and
// the next renewal charges the new holder.

import { randomUUID } from 'node:crypto';
import { globalDb, forTeam, shardTransaction, type ShardTx } from '../db/clients.ts';
import { shardFor, type Shard } from '../db/shard.ts';
import { HttpError } from '../middleware/error.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { enqueueNotification } from '../notifications/outbox.ts';
import { resolvePaymentProvider } from './provider.ts';
import { isAdmin, takeOverBilling } from './holder.ts';

const HANDOVER_TTL_DAYS = 7;

export interface HandoverView {
  readonly id: string;
  readonly status: 'requested' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  readonly fromUserId: string;
  readonly toUserId: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly resolvedAt: Date | null;
  readonly isExpired: boolean;
}

/** Request a hand-over. Holder must not be the Admin; recipient is always the Admin. */
export async function requestHandover(holderId: string, teamId: string): Promise<{ handoverId: string }> {
  const client = forTeam(teamId);

  const sub = await client.subscriptions.findUnique({ where: { team_id: teamId } });
  if (!sub) throw new HttpError(404, 'billing.not_found', 'No subscription for this team.');
  if (sub.billing_user_id !== holderId) {
    throw new HttpError(403, 'billing.holder_only', 'Only the billing holder can hand over billing.');
  }
  if (sub.status === 'past_due' || sub.status === 'restricted' || sub.status === 'cancelled') {
    throw new HttpError(422, 'billing.not_in_crisis', 'Hand-over is blocked while the subscription is past_due, restricted or cancelled.');
  }

  // Holder must not be the Admin (owner).
  const holderIsAdmin = await isAdmin(holderId, teamId);
  if (holderIsAdmin) {
    throw new HttpError(422, 'billing.holder_is_admin', 'The Admin already holds billing; no hand-over needed.');
  }

  // Recipient is always the current Admin (owner member).
  const adminMembership = await client.memberships.findFirst({
    where: { team_id: teamId, role: 'owner', removed_at: null },
  });
  if (!adminMembership || adminMembership.user_id === holderId) {
    throw new HttpError(422, 'billing.no_admin', 'No Admin (owner) member exists to receive billing.');
  }

  // Mark any expired open hand-over as expired before checking for conflicts.
  await client.billing_handovers.updateMany({
    where: { subscription_id: sub.id, status: 'requested', expires_at: { lte: new Date() } },
    data: { status: 'expired', resolved_at: new Date() },
  });

  // One open hand-over per subscription: partial UNIQUE index enforces this at the DB level.
  const handoverId = randomUUID();
  const expiresAt = new Date(Date.now() + HANDOVER_TTL_DAYS * 24 * 60 * 60 * 1000);

  // Create the request and its notice in ONE shard transaction (category 'billing', ids only).
  try {
    await shardTransaction(shardFor(teamId), async (tx: ShardTx) => {
      await tx.billing_handovers.create({
        data: {
          id: handoverId,
          subscription_id: sub.id,
          team_id: teamId,
          from_user_id: holderId,
          to_user_id: adminMembership.user_id,
          status: 'requested',
          expires_at: expiresAt,
        },
      });
      await enqueueNotification(tx, {
        recipientUserId: adminMembership.user_id,
        category: 'billing.handover_requested',
        payload: { teamId, handoverId },
        dedupeKey: `billing:handover:${handoverId}:requested`,
      });
    });
  } catch (err) {
    // Unique-index violation on a genuinely open request -> 409.
    if (isUniqueViolation(err)) {
      throw new HttpError(409, 'billing.handover_exists', 'An open hand-over already exists for this subscription.');
    }
    throw err;
  }

  return { handoverId };
}

/** Get the current open hand-over for a subscription, with lazy expiry. */
export async function getHandover(teamId: string, userId: string): Promise<HandoverView | null> {
  const client = forTeam(teamId);
  const sub = await client.subscriptions.findUnique({ where: { team_id: teamId } });
  if (!sub) return null;

  const isAdminUser = await isAdmin(userId, teamId);
  if (!isAdminUser && sub.billing_user_id !== userId) {
    throw new HttpError(404, 'billing.not_found', 'Hand-over not found.');
  }

  const row = await client.billing_handovers.findFirst({
    where: { subscription_id: sub.id, status: 'requested' },
    orderBy: { created_at: 'desc' },
  });
  if (!row) return null;

  // Lazy expiry: a request whose expires_at is in the past counts as expired when read.
  const now = new Date();
  const isExpired = row.expires_at.getTime() <= now.getTime();
  const status = (isExpired ? 'expired' : row.status) as HandoverView['status'];

  return {
    id: row.id,
    status,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    isExpired,
  };
}

/** Accept a hand-over. Admin only; requires Idempotency-Key. */
export async function acceptHandover(
  adminId: string,
  teamId: string,
  handoverId: string,
  idempotencyKey: string,
): Promise<{ accepted: boolean }> {
  const client = forTeam(teamId);
  const db0 = globalDb();

  // Admin (owner) only.
  const isAdminUser = await isAdmin(adminId, teamId);
  if (!isAdminUser) {
    throw new HttpError(403, 'billing.admin_only', 'Only the Admin (owner) can accept a hand-over.');
  }

  // Idempotency: replay with the same key returns without side effects.
  const existingKey = await db0.payment_intents.findFirst({ where: { team_id: teamId, idempotency_key: idempotencyKey } });
  if (existingKey) {
    return { accepted: true };
  }

  const sub = await client.subscriptions.findUnique({ where: { team_id: teamId } });
  if (!sub) throw new HttpError(404, 'billing.not_found', 'No subscription for this team.');

  const handover = await client.billing_handovers.findUnique({ where: { id: handoverId } });
  if (!handover || handover.subscription_id !== sub.id) {
    throw new HttpError(404, 'billing.handover_not_found', 'Hand-over request not found.');
  }
  if (handover.status === 'accepted' && handover.to_user_id === adminId) {
    return { accepted: true };
  }
  if (handover.status !== 'requested') {
    throw new HttpError(422, 'billing.handover_not_requested', 'Hand-over request is no longer open.');
  }
  if (handover.to_user_id !== adminId) {
    throw new HttpError(403, 'billing.not_recipient', 'Only the recipient Admin can accept this hand-over.');
  }

  // Lazy expiry check.
  const now = new Date();
  if (handover.expires_at.getTime() <= now.getTime()) {
    await client.billing_handovers.update({
      where: { id: handoverId },
      data: { status: 'expired', resolved_at: now },
    });
    throw new HttpError(422, 'billing.handover_expired', 'This hand-over request has expired.');
  }

  // Obtain a payment authorisation from the provider (simulator implements; real provider is a [VERIFY] stub).
  const provider = resolvePaymentProvider();
  const authorisation = await provider.createAuthorisation({
    currency: sub.currency,
    txRef: `auth-${randomUUID()}`,
  });

  await shardTransaction(shardFor(teamId) as Shard, async (tx: ShardTx) => {
    // Re-check under lock: handover still open and not expired.
    const current = await tx.billing_handovers.findUnique({ where: { id: handoverId } });
    if (!current || current.status !== 'requested') {
      throw new HttpError(422, 'billing.handover_not_requested', 'Hand-over request is no longer open.');
    }
    if (current.expires_at.getTime() <= now.getTime()) {
      await tx.billing_handovers.update({
        where: { id: handoverId },
        data: { status: 'expired', resolved_at: now },
      });
      throw new HttpError(422, 'billing.handover_expired', 'This hand-over request has expired.');
    }

    // Move billing to the Admin; replace the old holder's payment reference (single code path via takeOverBilling).
    await takeOverBilling(adminId, teamId, authorisation.authorizationRef, tx);

    // Mark handover accepted.
    await tx.billing_handovers.update({
      where: { id: handoverId },
      data: { status: 'accepted', resolved_at: now },
    });

    // Activity event (no amounts, no payment data).
    await tx.activity_events.create({
      data: {
        team_id: teamId,
        kind: 'billing.handover_accepted',
        actor_user_id: adminId,
        audience: 'managers',
        data: { handoverId, fromUserId: handover.from_user_id, toUserId: adminId },
      },
    });

    // Notify the old holder.
    await enqueueNotification(tx, {
      recipientUserId: handover.from_user_id,
      category: 'billing.handover_accepted',
      payload: { teamId, handoverId },
      dedupeKey: `billing:handover:${handoverId}:accepted`,
    });
  });

  // Consume the idempotency key (marker row so a replay is a no-op).
  await db0.payment_intents.upsert({
    where: { tx_ref: `handover:${handoverId}` },
    update: { status: 'succeeded', completed_at: now },
    create: {
      team_id: teamId,
      tx_ref: `handover:${handoverId}`,
      purpose: 'plan_change',
      amount_minor: BigInt(0),
      currency: sub.currency,
      status: 'succeeded',
      idempotency_key: idempotencyKey,
      created_by: adminId,
      completed_at: now,
    },
  });

  return { accepted: true };
}

/** Decline a hand-over. Admin only. */
export async function declineHandover(adminId: string, teamId: string, handoverId: string): Promise<{ declined: boolean }> {
  const client = forTeam(teamId);

  const isAdminUser = await isAdmin(adminId, teamId);
  if (!isAdminUser) {
    throw new HttpError(403, 'billing.admin_only', 'Only the Admin (owner) can decline a hand-over.');
  }

  const sub = await client.subscriptions.findUnique({ where: { team_id: teamId } });
  if (!sub) throw new HttpError(404, 'billing.not_found', 'No subscription for this team.');

  const handover = await client.billing_handovers.findUnique({ where: { id: handoverId } });
  if (!handover || handover.subscription_id !== sub.id) {
    throw new HttpError(404, 'billing.handover_not_found', 'Hand-over request not found.');
  }
  if (handover.status !== 'requested') {
    throw new HttpError(422, 'billing.handover_not_requested', 'Hand-over request is no longer open.');
  }
  if (handover.to_user_id !== adminId) {
    throw new HttpError(403, 'billing.not_recipient', 'Only the recipient Admin can decline this hand-over.');
  }

  // Lazy expiry.
  const now = new Date();
  if (handover.expires_at.getTime() <= now.getTime()) {
    await client.billing_handovers.update({
      where: { id: handoverId },
      data: { status: 'expired', resolved_at: now },
    });
    throw new HttpError(422, 'billing.handover_expired', 'This hand-over request has expired.');
  }

  await shardTransaction(shardFor(teamId), async (tx: ShardTx) => {
    await tx.billing_handovers.update({
      where: { id: handoverId },
      data: { status: 'declined', resolved_at: now },
    });
    await enqueueNotification(tx, {
      recipientUserId: handover.from_user_id,
      category: 'billing.handover_declined',
      payload: { teamId, handoverId },
      dedupeKey: `billing:handover:${handoverId}:declined`,
    });
  });

  return { declined: true };
}

/** Cancel a hand-over. Holder only. */
export async function cancelHandover(holderId: string, teamId: string, handoverId: string): Promise<{ cancelled: boolean }> {
  const client = forTeam(teamId);

  const sub = await client.subscriptions.findUnique({ where: { team_id: teamId } });
  if (!sub) throw new HttpError(404, 'billing.not_found', 'No subscription for this team.');
  if (sub.billing_user_id !== holderId) {
    throw new HttpError(403, 'billing.holder_only', 'Only the billing holder can cancel a hand-over.');
  }

  const handover = await client.billing_handovers.findUnique({ where: { id: handoverId } });
  if (!handover || handover.subscription_id !== sub.id) {
    throw new HttpError(404, 'billing.handover_not_found', 'Hand-over request not found.');
  }
  if (handover.status !== 'requested') {
    throw new HttpError(422, 'billing.handover_not_requested', 'Hand-over request is no longer open.');
  }
  if (handover.from_user_id !== holderId) {
    throw new HttpError(403, 'billing.not_holder', 'Only the holder can cancel this hand-over.');
  }

  const now = new Date();
  if (handover.expires_at.getTime() <= now.getTime()) {
    await client.billing_handovers.update({
      where: { id: handoverId },
      data: { status: 'expired', resolved_at: now },
    });
    throw new HttpError(422, 'billing.handover_expired', 'This hand-over request has expired.');
  }

  await shardTransaction(shardFor(teamId), async (tx: ShardTx) => {
    await tx.billing_handovers.update({
      where: { id: handoverId },
      data: { status: 'cancelled', resolved_at: now },
    });
    await enqueueNotification(tx, {
      recipientUserId: handover.to_user_id,
      category: 'billing.handover_cancelled',
      payload: { teamId, handoverId },
      dedupeKey: `billing:handover:${handoverId}:cancelled`,
    });
  });

  return { cancelled: true };
}
