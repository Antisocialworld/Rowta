// Webhook job processor (Task 6 + FIX-B + FIX-G + X1, PRD 8.6).
// Re-verifies with the provider (never trusts the payload), checks amount/currency against the
// stored payment_intent, then in ONE shard transaction: ledger row + subscription update +
// activity event + notification enqueue. THEN marks the global payment_intent completed on DB0
// (cannot share the shard transaction). Safe to retry: ledger provider_ref/idempotency_key are
// UNIQUE with ON CONFLICT DO NOTHING.

import type { Job } from 'bullmq';
import { globalDb, shardTransaction, type ShardTx } from '../db/clients.ts';
import { shardFor, type Shard } from '../db/shard.ts';
import { logger } from '../lib/logger.ts';
import { enqueueNotification } from '../notifications/outbox.ts';
import { fromProviderAmount } from '../billing/money.ts';
import { resolvePaymentProvider } from '../billing/provider.ts';
import { applyCoverage } from '../billing/entitlements.ts';

const log = logger.child({ module: 'billing-webhook-job' });

export interface WebhookJobData {
  txRef: string;
  eventType: string;
}

function addInterval(base: Date, interval: 'month' | 'year'): Date {
  const months = interval === 'year' ? 12 : 1;
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(base.getUTCDate(), lastDay), base.getUTCHours(), base.getUTCMinutes(), base.getUTCSeconds()));
}

export async function processWebhookJob(job: Job<WebhookJobData>): Promise<{ processed: boolean }> {
  const { txRef } = job.data;

  // 1. Find the payment intent (DB0, global).
  const db0 = globalDb();
  const intent = await db0.payment_intents.findUnique({ where: { tx_ref: txRef } });
  if (!intent) {
    log.warn({ txRef }, 'webhook for unknown tx_ref; marking webhook event ignored');
    await db0.webhook_events.updateMany({
      where: { tx_ref: txRef, status: 'received' },
      data: { status: 'ignored', processed_at: new Date() },
    });
    return { processed: false };
  }

  // 2. If already completed, skip (a late 'failed' never undoes a completed intent).
  if (intent.status === 'succeeded') {
    log.info({ txRef }, 'intent already completed; webhook ignored');
    return { processed: false };
  }

  // G2-1: A successful payment for an intent whose status is 'expired' must NOT
  // change any account, registry or team. For 'failed' and any other non-pending,
  // non-succeeded status, keep the behaviour that existed before G1-3 (fall through
  // to provider verification).
  if (intent.status === 'expired') {
    log.error({
      intentId: intent.id,
      amountMinor: intent.amount_minor.toString(),
      currency: intent.currency,
    }, 'payment_for_expired_intent');
    await db0.webhook_events.updateMany({
      where: { tx_ref: txRef, status: 'received' },
      data: { status: 'ignored', processed_at: new Date() },
    });
    return { processed: false };
  }

  // 3. Re-verify with the provider (never trust the payload alone).
  const provider = resolvePaymentProvider();
  const providerVerify = await provider.verifyTransaction(txRef);
  const verifiedStatus = providerVerify.status;
  const providerAmount = providerVerify.amountMinor; // provider units (naira for NGN)
  const verifiedCurrency = providerVerify.currency;

  // 4. Provider-reported status must be successful.
  if (verifiedStatus !== 'succeeded') {
    log.warn({ txRef, status: verifiedStatus }, 'provider status not successful');
    await db0.payment_intents.update({
      where: { tx_ref: txRef },
      data: { status: 'failed', completed_at: new Date() },
    });
    await db0.webhook_events.updateMany({
      where: { tx_ref: txRef, status: 'received' },
      data: { status: 'failed', processed_at: new Date() },
    });
    return { processed: false };
  }

  // 4b. Verified tx_ref must match stored intent tx_ref before crediting.
  if (providerVerify.txRef && providerVerify.txRef !== intent.tx_ref) {
    log.error({
      intentId: intent.id,
      amountMinor: intent.amount_minor.toString(),
      currency: intent.currency,
    }, 'tx_ref mismatch');
    await db0.payment_intents.update({
      where: { tx_ref: txRef },
      data: { status: 'failed', completed_at: new Date() },
    });
    await db0.webhook_events.updateMany({
      where: { tx_ref: txRef, status: 'received' },
      data: { status: 'failed', processed_at: new Date() },
    });
    return { processed: false };
  }

  // 5. Convert the provider amount to our storage unit (kobo) and compare with
  //    intent.amount_minor. Provider units are 'major' (naira) for NGN, so every
  //    charge is whole naira; a non-exact conversion or decimals means reject.
  let expectedMinor: number;
  try {
    const converted = fromProviderAmount(providerAmount, intent.currency);
    if (converted === null) {
      throw new Error(`Currency not configured: ${intent.currency}`);
    }
    expectedMinor = converted;
  } catch (err) {
    // Non-exact conversion (e.g. provider sent decimals): reject and log.
    log.warn({ txRef, providerAmount, currency: intent.currency, err }, 'provider amount not representable in minor units');
    await db0.payment_intents.update({
      where: { tx_ref: txRef },
      data: { status: 'failed', completed_at: new Date() },
    });
    await db0.webhook_events.updateMany({
      where: { tx_ref: txRef, status: 'received' },
      data: { status: 'failed', processed_at: new Date() },
    });
    return { processed: false };
  }
  if (BigInt(expectedMinor) < intent.amount_minor) {
    log.error({
      intentId: intent.id,
      amountMinor: intent.amount_minor.toString(),
      currency: intent.currency,
    }, 'amount mismatch: underpayment received');
    await db0.payment_intents.update({
      where: { tx_ref: txRef },
      data: { status: 'failed', completed_at: new Date() },
    });
    await db0.webhook_events.updateMany({
      where: { tx_ref: txRef, status: 'received' },
      data: { status: 'failed', processed_at: new Date() },
    });
    return { processed: false };
  }
  if (verifiedCurrency !== intent.currency || verifiedCurrency !== 'NGN') {
    log.error({
      intentId: intent.id,
      amountMinor: intent.amount_minor.toString(),
      currency: intent.currency,
    }, 'currency mismatch');
    await db0.payment_intents.update({
      where: { tx_ref: txRef },
      data: { status: 'failed', completed_at: new Date() },
    });
    await db0.webhook_events.updateMany({
      where: { tx_ref: txRef, status: 'received' },
      data: { status: 'failed', processed_at: new Date() },
    });
    return { processed: false };
  }

  // 6. Route shard by team and apply in ONE transaction.
  const shard: Shard = shardFor(intent.team_id);
  const isAccountKind = intent.kind?.startsWith('account_') ?? false;
  const applied = await shardTransaction(shard, async (tx: ShardTx) => {
    // 6a. Idempotent ledger row (provider_ref UNIQUE with ON CONFLICT DO NOTHING).
    //     $executeRaw returns the affected-row count; 1 means applied, 0 means already applied.
    const now = new Date();
    const existingSub = await tx.subscriptions.findUnique({ where: { team_id: intent.team_id } });

    // Determine period based on intent kind.
    const targetInterval = (intent.interval ?? 'month') as 'month' | 'year';
    let periodStart: Date;
    let periodEnd: Date;
    let ledgerPlan: string | null = intent.plan;
    let ledgerSeats: number | null = intent.seats;
    let ledgerInterval: string | null = intent.interval;

    if (isAccountKind) {
      // Account-level intents: no subscription row is involved. Route before the
      // "existing subscription" check that throws for non-first_purchase kinds.
      // Assign period on every branch so definite assignment holds; for non-subscribe
      // account kinds the authoritative period state lives on db0, but the ledger still
      // needs concrete values.
      periodStart = now;
      periodEnd = addInterval(now, targetInterval);
      if (intent.kind === 'account_renewal') {
        // account_renewal: period state owned by the db0 update.
      }
      // account_subscribe / account_add_team / account_interval_switch /
      // account_switch_interval / account_add_people: period state is owned by the
      // db0 update (or is a no-op) here.
    } else if (intent.kind === 'first_purchase') {
      periodStart = now;
      periodEnd = addInterval(now, targetInterval);
    } else {
      if (!existingSub) throw new Error(`No subscription for non-first-purchase intent ${intent.id}`);
      if (intent.kind === 'renewal') {
        periodStart = existingSub.period_end;
        periodEnd = addInterval(existingSub.period_end, existingSub.interval as 'month' | 'year');
        ledgerPlan = existingSub.scheduled_plan ?? existingSub.plan;
        ledgerSeats = existingSub.scheduled_seats ?? existingSub.seats;
        ledgerInterval = existingSub.interval;
      } else {
        // upgrade / seats: the charge is for the CURRENT period; the ledger records the NEW plan/seats from the intent.
        periodStart = existingSub.period_start;
        periodEnd = existingSub.period_end;
        ledgerPlan = intent.plan ?? existingSub.plan;
        ledgerSeats = intent.seats ?? existingSub.seats;
        ledgerInterval = existingSub.interval;
      }
    }

    const inserted = await tx.$executeRaw`
      INSERT INTO ledger_entries (
        id, team_id, subscription_id, kind, amount_minor, currency, reason,
        provider_ref, idempotency_key, period_start, period_end, created_at,
        plan, seats, interval
      ) VALUES (
        gen_random_uuid(), ${intent.team_id}::uuid, ${existingSub?.id ?? null}::uuid, 'charge',
        ${intent.amount_minor}, ${intent.currency}::text, 'webhook charge',
        ${txRef}::text, ${intent.idempotency_key ?? txRef}::text,
        ${periodStart}, ${periodEnd}, now(),
        ${ledgerPlan}, ${ledgerSeats}, ${ledgerInterval}
      )
      ON CONFLICT (provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
    `;
    if (inserted !== 1) return false; // skip the rest: no second subscription update, activity event or notification

    // 6b. Apply the payment to the subscription or account, branching on intent.kind.
    if (intent.kind === 'first_purchase') {
      await tx.subscriptions.create({
        data: {
          team_id: intent.team_id,
          plan: intent.plan as string,
          seats: intent.seats ?? 0,
          status: 'active',
          currency: intent.currency,
          period_start: periodStart,
          period_end: periodEnd,
          billing_user_id: intent.created_by,
          interval: intent.interval as 'month' | 'year',
          provider_authorization_ref: providerVerify.authorizationRef ?? null,
        },
      });
    } else if (intent.kind === 'upgrade') {
      await tx.subscriptions.update({
        where: { team_id: intent.team_id },
        data: {
          plan: intent.plan as string,
          seats: intent.seats ?? 0,
          status: 'active',
          updated_at: new Date(),
        },
      });
    } else if (intent.kind === 'seats') {
      await tx.subscriptions.update({
        where: { team_id: intent.team_id },
        data: {
          seats: intent.seats ?? 0,
          updated_at: new Date(),
        },
      });
    } else if (intent.kind === 'renewal') {
      if (!existingSub) throw new Error(`No subscription for renewal intent ${intent.id}`);
      if (existingSub.cancel_at_period_end) {
        await tx.subscriptions.update({
          where: { team_id: intent.team_id },
          data: { status: 'cancelled', updated_at: new Date() },
        });
      } else {
        await tx.subscriptions.update({
          where: { team_id: intent.team_id },
          data: {
            plan: existingSub.scheduled_plan ?? existingSub.plan,
            seats: existingSub.scheduled_seats ?? existingSub.seats,
            scheduled_plan: null,
            scheduled_seats: null,
            status: 'active',
            period_start: periodStart,
            period_end: periodEnd,
            updated_at: new Date(),
          },
        });
      }
    } else if (isAccountKind) {
      // Account-level intents: update owner_accounts (db0, done after this transaction)
      // and team-level state (registry / extra_people) here on the shard.
      if (intent.kind === 'account_add_people') {
        await tx.teams.update({
          where: { id: intent.team_id },
          data: { extra_people: intent.seats ?? 0, updated_at: new Date() },
        });
      }
      // account_subscribe, account_add_team, account_interval_switch:
      // owner_accounts changes are applied on db0 after this transaction.
    }

    // 6c. Activity event (no amounts, no payment data).
    await tx.activity_events.create({
      data: {
        team_id: intent.team_id,
        kind: 'payment.received',
        actor_user_id: intent.created_by,
        audience: 'managers',
        data: { txRef, intentId: intent.id },
      },
    });

    // 6d. Enqueue notification (billing type, no amounts/names).
    await enqueueNotification(tx, {
      recipientUserId: intent.created_by,
      category: 'billing.received',
      payload: { txRef },
      dedupeKey: `billing:${txRef}:${intent.created_by}`,
    });

    return true;
  });

  // Mark the webhook event processed.
  await db0.webhook_events.updateMany({
    where: { tx_ref: txRef, status: 'received' },
    data: { status: 'processed', processed_at: new Date() },
  });

  // Account-level intents: apply owner_accounts changes on DB0 (cannot share the shard transaction).
  // Retry-safe: runs even when the ledger insert was a conflict (applied === false), because the
  // owner_accounts / registry writes are idempotent. owner_accounts has no `interval` column;
  // plan holds monthly/yearly, so interval is never written there.
  if (isAccountKind) {
    const now = new Date();
    if (intent.kind === 'account_subscribe') {
      const targetInterval = (intent.interval ?? 'month') as 'month' | 'year';
      const periodStart = now;
      const periodEnd = addInterval(now, targetInterval);
      await db0.owner_accounts.update({
        where: { user_id: intent.created_by },
        data: {
          status: 'active',
          plan: intent.plan ?? 'monthly',
          period_start: periodStart,
          period_end: periodEnd,
          cancel_at_period_end: false,
          updated_at: now,
        },
      });
    } else if (intent.kind === 'account_renewal') {
      const targetInterval = (intent.interval ?? 'month') as 'month' | 'year';
      const periodStart = now;
      const periodEnd = addInterval(now, targetInterval);
      await db0.owner_accounts.update({
        where: { user_id: intent.created_by },
        data: {
          status: 'active',
          period_start: periodStart,
          period_end: periodEnd,
          grace_ends_at: null,
          lapsed_at: null,
          updated_at: now,
        },
      });
    } else if (intent.kind === 'account_interval_switch' || intent.kind === 'account_switch_interval') {
      await db0.owner_accounts.update({
        where: { user_id: intent.created_by },
        data: { plan: intent.plan ?? 'monthly', updated_at: now },
      });
    } else if (intent.kind === 'account_add_team') {
      // Mark the team registry active; is_extra already set at reservation time.
      await db0.owner_team_registry.update({
        where: { team_id: intent.team_id },
        data: { status: 'active' },
      });
    }
    // account_add_people: extra_people was written on the shard above.
    await applyCoverage(intent.created_by);
  }

  // Mark the intent completed on DB0 (cannot share the shard transaction).
  await db0.payment_intents.update({
    where: { tx_ref: txRef },
    data: { status: 'succeeded', completed_at: new Date() },
  });

  log.info({ txRef, applied }, 'webhook processed successfully');
  return { processed: true };
}
