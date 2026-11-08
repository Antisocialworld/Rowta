// Renewal job processor (Task 7 + X5, PRD 8.6).
// Charges the holder's saved authorisation or emails a renewal pay link.
// Price = scheduled_plan/seats if set, else current, in the locked currency.
// Missing currency/price row = renewal fails visibly (past_due), never fallback.
// Idempotent per (subscription, period_end): if the intent already succeeded, skip.
// Never advances a period without payment — the period advance, ledger row and receipt
// happen ONLY in the webhook job (F6).

import type { Job } from 'bullmq';
import { globalDb, forTeam, shardTransaction, type ShardTx } from '../db/clients.ts';
import { shardFor } from '../db/shard.ts';
import { logger } from '../lib/logger.ts';
import { enqueueNotification } from '../notifications/outbox.ts';
import { PLAN_LIMITS, periodPrice, type PlanId } from '../billing/proration.ts';
import { resolvePaymentProvider } from '../billing/provider.ts';

const log = logger.child({ module: 'billing-renewal' });

export interface RenewalJobData {
  subscriptionId: string;
  teamId: string;
  periodEnd: string;
}

/**
 * Mark a renewal as failed in ONE shard transaction: status past_due with a 7-day grace, plus a day-0
 * notice to the billing holder through the outbox (ids only: no amounts, no currency, no names).
 * When there is no holder, only the status changes (nobody to notify).
 */
async function markRenewalFailed(
  teamId: string,
  subscriptionId: string,
  holderId: string | null,
  periodEnd: string,
): Promise<void> {
  await shardTransaction(shardFor(teamId), async (tx: ShardTx) => {
    await tx.subscriptions.update({
      where: { id: subscriptionId },
      data: {
        status: 'past_due',
        grace_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    if (holderId) {
      await enqueueNotification(tx, {
        recipientUserId: holderId,
        category: 'billing.renewal_failed',
        payload: { subscriptionId },
        dedupeKey: `renewal:${subscriptionId}:${periodEnd}:failed`,
      });
    }
  });
}

/**
 * Process a renewal for one subscription.
 * Idempotent per (subscription, period_end): if the intent already succeeded, skip.
 */
export async function processRenewalJob(job: Job<RenewalJobData>): Promise<{ processed: boolean }> {
  const { subscriptionId, teamId, periodEnd } = job.data;

  const db0 = globalDb();
  const client = forTeam(teamId);

  const sub = await client.subscriptions.findUnique({ where: { id: subscriptionId } });
  if (!sub) {
    log.warn({ subscriptionId }, 'renewal: subscription not found');
    return { processed: false };
  }

  // Only active subscriptions whose period has ended.
  if (sub.status !== 'active') {
    log.info({ subscriptionId, status: sub.status }, 'renewal: subscription not active; skipping');
    return { processed: false };
  }

  const periodEndDate = new Date(periodEnd);
  if (new Date() < periodEndDate) {
    log.info({ subscriptionId }, 'renewal: period not yet ended; skipping');
    return { processed: false };
  }

  // T16 #3: Legacy per-team subscription — if the team's billing moved to another account
  // (owner_team_registry.owner_user_id differs from the subscription's billing holder), do
  // not charge the previous payer for a team they no longer pay for.
  const teamRegistry = await db0.owner_team_registry.findUnique({ where: { team_id: teamId } });
  if (
    teamRegistry &&
    sub.billing_user_id &&
    teamRegistry.owner_user_id !== sub.billing_user_id
  ) {
    log.info(
      {
        subscriptionId,
        teamId,
        registryOwner: teamRegistry.owner_user_id,
        billingHolder: sub.billing_user_id,
      },
      'renewal: team billing moved to another account; skipping charge for previous payer',
    );
    return { processed: false };
  }

  // Cancel at period end: set cancelled, charge nothing.
  if (sub.cancel_at_period_end) {
    await shardTransaction(shardFor(teamId), async (tx: ShardTx) => {
      await tx.subscriptions.update({
        where: { id: subscriptionId },
        data: { status: 'cancelled', updated_at: new Date() },
      });
    });
    log.info({ subscriptionId }, 'renewal: cancel_at_period_end; subscription cancelled, no charge');
    return { processed: true };
  }

  // Determine price: scheduled_plan/seats if set, else current.
  const plan = (sub.scheduled_plan ?? sub.plan) as PlanId;
  const seats = sub.scheduled_seats ?? sub.seats;

  // Look up price in plan_prices for the locked currency.
  const prices = await db0.plan_prices.findMany({ where: { currency: sub.currency } });
  const priceRow = prices.find((p) => p.plan === plan);
  if (!priceRow) {
    // Missing currency/price row: renewal fails visibly (past_due), never fallback.
    log.warn({ subscriptionId, plan, currency: sub.currency }, 'renewal: no price row; failing visibly');
    await markRenewalFailed(teamId, subscriptionId, sub.billing_user_id, periodEnd);
    return { processed: false };
  }

  const limits = PLAN_LIMITS[plan];
  const amountMinor = periodPrice(plan, seats, {
    baseMinor: Number(priceRow.base_minor),
    extraSeatMinor: priceRow.extra_seat_minor === null ? null : Number(priceRow.extra_seat_minor),
  }, limits, sub.interval as 'month' | 'year');

  if (amountMinor === null) {
    log.warn({ subscriptionId, plan, seats }, 'renewal: invalid plan/seats; failing visibly');
    await markRenewalFailed(teamId, subscriptionId, sub.billing_user_id, periodEnd);
    return { processed: false };
  }

  // Billing holder is required for renewal charging.
  const holderId = sub.billing_user_id;
  if (!holderId) {
    log.warn({ subscriptionId }, 'renewal: no billing holder; failing visibly');
    await markRenewalFailed(teamId, subscriptionId, null, periodEnd);
    return { processed: false };
  }

  // Idempotency key for this renewal.
  const idempotencyKey = `renewal:${subscriptionId}:${periodEnd}`;

  // Check for existing intent: if succeeded or pending, do not charge again.
  const existingIntent = await db0.payment_intents.findFirst({
    where: { team_id: teamId, idempotency_key: idempotencyKey },
  });
  if (existingIntent && existingIntent.status !== 'failed') {
    log.info({ subscriptionId }, 'renewal: intent already exists; skipping charge');
    return { processed: false };
  }

  // Upsert the renewal intent (created_by = holder). Remove updated_at from upsert.
  await db0.payment_intents.upsert({
    where: { tx_ref: `renewal:${subscriptionId}:${periodEnd}` },
    update: { status: 'pending', amount_minor: BigInt(amountMinor), currency: sub.currency, completed_at: null },
    create: {
      team_id: teamId,
      tx_ref: `renewal:${subscriptionId}:${periodEnd}`,
      purpose: 'renewal',
      amount_minor: BigInt(amountMinor),
      currency: sub.currency,
      status: 'pending',
      idempotency_key: idempotencyKey,
      created_by: holderId,
      plan,
      seats,
      interval: sub.interval as 'month' | 'year',
      kind: 'renewal',
    },
  });

  // No saved authorisation: no automatic charge. The pay-link email is a [VERIFY] stub; the pending
  // renewal intent above stays open for a hosted-checkout payment.
  const authorizationRef = sub.provider_authorization_ref;
  if (!authorizationRef) {
    log.info({ subscriptionId }, 'renewal: no saved authorisation; pay link is a [VERIFY] stub');
    return { processed: false };
  }

  // Charge holder's saved authorisation via provider.
  const provider = resolvePaymentProvider();
  const holderUser = holderId ? await db0.users.findUnique({ where: { id: holderId }, select: { email: true } }) : null;
  const customerEmail = holderUser?.email ?? '';
  let authRef: string | undefined;
  try {
    const chargeResult = await provider.chargeAuthorisation({
      authorizationRef,
      amountMinor,
      currency: sub.currency,
      txRef: `renewal:${subscriptionId}:${periodEnd}`,
      customerEmail,
    });
    authRef = chargeResult.authorizationRef;
  } catch (err) {
    // Provider failure = status past_due, grace_ends_at = now + 7 days, day-0 notice.
    log.warn({ subscriptionId, err }, 'renewal: charge authorisation failed; past_due + grace');
    await markRenewalFailed(teamId, subscriptionId, holderId, periodEnd);
    return { processed: false };
  }

  // Store provider authorisation ref in subscription inside shard transaction.
  if (authRef) {
    await shardTransaction(shardFor(teamId), async (tx: ShardTx) => {
      await tx.subscriptions.update({
        where: { id: subscriptionId },
        data: {
          provider_authorization_ref: authRef,
        },
      });
    });
  }

  log.info({ subscriptionId, amountMinor, currency: sub.currency }, 'renewal: charge authorisation sent; webhook job applies');
  return { processed: true };
}

/**
 * Grace reminder job: day 0, 3 and 6 notices to the billing holder; day 7 sets 'restricted'.
 * failureTime = grace_ends_at − 7 days; daysSince = floor((now − failureTime)/1 day).
 * Called once per past_due subscription per day (idempotent per day).
 */
export async function processGraceReminder(job: Job<{ teamId: string }>): Promise<{ processed: boolean }> {
  const { teamId } = job.data;
  const client = forTeam(teamId);

  const sub = await client.subscriptions.findUnique({ where: { team_id: teamId } });
  if (!sub || sub.status !== 'past_due') {
    return { processed: false };
  }

  const graceEnds = sub.grace_ends_at;
  if (!graceEnds) {
    return { processed: false };
  }

  const now = new Date();
  const graceEndsTime = new Date(graceEnds);
  const failureTime = new Date(graceEndsTime.getTime() - 7 * 24 * 60 * 60 * 1000);
  const daysSince = Math.max(0, Math.floor((now.getTime() - failureTime.getTime()) / (24 * 60 * 60 * 1000)));

  // Day 7+: set restricted.
  if (now.getTime() >= graceEndsTime.getTime()) {
    await client.subscriptions.update({
      where: { team_id: teamId },
      data: { status: 'restricted' },
    });
    log.info({ teamId }, 'grace: subscription restricted at day 7');
    return { processed: true };
  }

  // Day 0, 3 and 6 notices through the notification outbox (category 'billing', no amounts/names,
  // dedupe key grace:<subscriptionId>:<day>). Recipient = billing holder.
  const graceRecipient = sub.billing_user_id;
  if (graceRecipient && (daysSince === 0 || daysSince === 3 || daysSince === 6)) {
    await shardTransaction(shardFor(teamId), async (tx: ShardTx) => {
      await enqueueNotification(tx, {
        recipientUserId: graceRecipient,
        category: 'billing.grace_reminder',
        payload: { subscriptionId: sub.id, day: daysSince },
        dedupeKey: `grace:${sub.id}:${daysSince}`,
      });
    });
    log.info({ teamId, day: daysSince }, 'grace: reminder notice enqueued');
  }

  return { processed: true };
}
