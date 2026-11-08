// Account-level renewal processor (C5).
// ONE renewal per owner account: charge base + extras for the period.
// NOT registered or enabled until C7 — written and tested here only.
// Reuse: enqueueNotification, forTeam/globalDb, HttpError, resolvePaymentProvider, proration.
// Money is integer kobo; BigInt in DB; no floats. NAIRA ONLY.
import type { Job } from 'bullmq';
import { globalDb, forTeam, type ShardClient, type JsonInput } from '../db/clients.ts';
import { logger } from '../lib/logger.ts';
import { resolvePaymentProvider } from './provider.ts';
import { intervalMultiplier, type Interval } from './proration.ts';
import { notifyCoveredTeamAdmins } from './admin-notices.ts';

const log = logger.child({ module: 'billing-account-renewal' });

const GRACE_DAYS = 7;

export interface AccountRenewalJobData {
  ownerUserId: string;
  periodEnd: string;
}

export interface AccountGraceReminderJobData {
  ownerUserId: string;
}

/**
 * Process a renewal for one owner account.
 * Idempotent per (owner, period_end): if the intent already succeeded, skip.
 */
export async function processAccountRenewalJob(
  job: Job<AccountRenewalJobData>,
): Promise<{ processed: boolean }> {
  const { ownerUserId, periodEnd } = job.data;
  const db0 = globalDb();

  const account = await db0.owner_accounts.findUnique({ where: { user_id: ownerUserId } });
  if (!account) {
    log.warn({ ownerUserId }, 'account renewal: account not found');
    return { processed: false };
  }
  if (account.status !== 'active') {
    log.info({ ownerUserId, status: account.status }, 'account renewal: not active; skipping');
    return { processed: false };
  }

  const periodEndDate = new Date(periodEnd);
  if (new Date() < periodEndDate) {
    log.info({ ownerUserId }, 'account renewal: period not yet ended; skipping');
    return { processed: false };
  }

  if (account.cancel_at_period_end) {
    await db0.owner_accounts.update({
      where: { user_id: ownerUserId },
      data: { status: 'cancelled', updated_at: new Date() },
    });
    await applyReadOnlyToAllTeams(ownerUserId);
    await notifyCoveredTeamAdmins(ownerUserId, {
      type: 'ended',
      date: new Date().toISOString().slice(0, 10),
    }).catch(() => undefined);
    log.info({ ownerUserId }, 'account renewal: cancel_at_period_end; account cancelled, no charge');
    return { processed: true };
  }

  // Compute total charge: base + extra teams + extra people.
  const entitlements = await db0.plan_entitlements.findUnique({
    where: { interval: account.plan },
  });
  if (!entitlements) {
    log.warn({ ownerUserId, plan: account.plan }, 'account renewal: no entitlements; failing visibly');
    await markAccountRenewalFailed(ownerUserId, periodEnd);
    return { processed: false };
  }

  const multiplier = intervalMultiplier(account.plan as Interval);
  const baseCharge = Number(entitlements.base_price_minor) * multiplier;

  // Count extra teams and extra people across all teams owned by this user.
  const registries = await db0.owner_team_registry.findMany({
    where: { owner_user_id: ownerUserId, is_extra: true },
  });
  const extraTeamCharge = registries.length * Number(entitlements.extra_team_price_minor) * multiplier;

  let extraPeopleCharge = 0;
  for (const reg of registries) {
    const client = forTeam(reg.team_id);
    const team = await client.teams.findUnique({ where: { id: reg.team_id } });
    const extraPeople = Math.max(0, (team?.extra_people ?? 0) - Number(entitlements.people_per_team));
    extraPeopleCharge += extraPeople * Number(entitlements.extra_person_price_minor) * multiplier;
  }

  const totalCharge = baseCharge + extraTeamCharge + extraPeopleCharge;
  const amountMinor = Math.ceil(totalCharge / 100) * 100; // whole naira

  // Idempotency key per (account, period_end).
  const idempotencyKey = `account_renewal:${ownerUserId}:${periodEnd}`;
  const existingIntent = await db0.payment_intents.findFirst({
    where: { idempotency_key: idempotencyKey },
  });
  if (existingIntent && existingIntent.status !== 'failed') {
    log.info({ ownerUserId }, 'account renewal: intent already exists; skipping charge');
    return { processed: false };
  }

  // Upsert the renewal intent.
  await db0.payment_intents.upsert({
    where: { tx_ref: `account_renewal:${ownerUserId}:${periodEnd}` },
    update: { status: 'pending', amount_minor: BigInt(amountMinor), currency: account.currency, completed_at: null },
    create: {
      team_id: registries[0]?.team_id ?? '', // [VERIFY] associate with primary team
      tx_ref: `account_renewal:${ownerUserId}:${periodEnd}`,
      purpose: 'renewal',
      amount_minor: BigInt(amountMinor),
      currency: account.currency,
      status: 'pending',
      idempotency_key: idempotencyKey,
      created_by: ownerUserId,
      plan: account.plan,
      seats: registries.length,
      interval: account.plan === 'yearly' ? 'year' : 'month',
      kind: 'account_renewal',
    },
  });

  // Charge via saved authorization.
  const authorizationRef = account.provider_authorization_ref;
  if (!authorizationRef) {
    log.info({ ownerUserId }, 'account renewal: no saved authorization; pay-now link flow');
    await enqueueAccountPayNowLink(ownerUserId, amountMinor, account.currency);
    return { processed: false };
  }

  const provider = resolvePaymentProvider();
  try {
    await provider.chargeAuthorisation({
      authorizationRef,
      amountMinor,
      currency: account.currency,
      txRef: `account_renewal:${ownerUserId}:${periodEnd}`,
    });
  } catch (err) {
    log.warn({ ownerUserId, err }, 'account renewal: charge failed; past_due + grace');
    await markAccountRenewalFailed(ownerUserId, periodEnd);
    return { processed: false };
  }

  // Advance the period on success (webhook job will confirm; here we mark pending).
  // The actual period advance happens in the webhook job after provider re-verification.
  log.info({ ownerUserId, amountMinor, currency: account.currency }, 'account renewal: charge sent; webhook applies');
  return { processed: true };
}

/**
 * Mark an account renewal as failed: past_due + 7-day grace + day-0 notice.
 * Read-only for all teams takes effect at day 7 (via applyCoverage or cron).
 */
async function markAccountRenewalFailed(ownerUserId: string, periodEnd: string): Promise<void> {
  await db0Transaction(async (db0) => {
    await db0.owner_accounts.update({
      where: { user_id: ownerUserId },
      data: {
        status: 'past_due',
        grace_ends_at: new Date(Date.now() + GRACE_DAYS * 24 * 60 * 60 * 1000),
      },
    });
  });

  // Enqueue day-0 grace notice.
  await enqueueNotificationTx(ownerUserId, 'billing.account_renewal_failed', {
    ownerUserId,
  }, `account_renewal:${ownerUserId}:${periodEnd}:failed`);
}

/**
 * Grace reminder job: day 0, 3, 6 notices; day 7 sets read_only for all teams.
 * Yearly: reminders 14, 7, 3 days BEFORE renewal (handled by a separate scheduler).
 */
export async function processAccountGraceReminder(
  job: Job<AccountGraceReminderJobData>,
): Promise<{ processed: boolean }> {
  const { ownerUserId } = job.data;
  const db0 = globalDb();

  const account = await db0.owner_accounts.findUnique({ where: { user_id: ownerUserId } });
  if (!account || account.status !== 'past_due') {
    return { processed: false };
  }

  const graceEnds = account.grace_ends_at;
  if (!graceEnds) {
    return { processed: false };
  }

  const now = new Date();
  const graceEndsTime = new Date(graceEnds);
  const failureTime = new Date(graceEndsTime.getTime() - GRACE_DAYS * 24 * 60 * 60 * 1000);
  const daysSince = Math.max(0, Math.floor((now.getTime() - failureTime.getTime()) / (24 * 60 * 60 * 1000)));

  // Day 7+: set read_only for ALL teams owned by this user.
  if (now.getTime() >= graceEndsTime.getTime()) {
    await db0.owner_accounts.update({
      where: { user_id: ownerUserId },
      data: { status: 'read_only' },
    });
    await applyReadOnlyToAllTeams(ownerUserId);
    await notifyCoveredTeamAdmins(ownerUserId, {
      type: 'ended',
      date: now.toISOString().slice(0, 10),
    }).catch(() => undefined);
    log.info({ ownerUserId }, 'account grace: account read_only at day 7');
    return { processed: true };
  }

  // Day 0, 3 and 6 notices.
  if (daysSince === 0 || daysSince === 3 || daysSince === 6) {
    await enqueueNotificationTx(ownerUserId, 'billing.account_grace_reminder', {
      ownerUserId,
      day: daysSince,
    }, `account_grace:${ownerUserId}:${daysSince}`);
    log.info({ ownerUserId, day: daysSince }, 'account grace: reminder notice enqueued');
  }

  return { processed: true };
}

/**
 * Yearly renewal reminders: 14, 7, 3 days BEFORE renewal.
 * Called by a separate cron scheduler (registered at C7).
 */
export async function processAccountYearlyReminder(
  job: Job<{ ownerUserId: string; periodEnd: string }>,
): Promise<{ processed: boolean }> {
  const { ownerUserId, periodEnd } = job.data;
  const db0 = globalDb();

  const account = await db0.owner_accounts.findUnique({ where: { user_id: ownerUserId } });
  if (!account || account.status !== 'active' || account.plan !== 'yearly') {
    return { processed: false };
  }

  const periodEndDate = new Date(periodEnd);
  const now = new Date();
  const daysUntil = Math.max(0, Math.floor((periodEndDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));

  if (daysUntil === 14 || daysUntil === 7 || daysUntil === 3) {
    await enqueueNotificationTx(ownerUserId, 'billing.account_yearly_reminder', {
      ownerUserId,
      daysUntil,
    }, `account_yearly:${ownerUserId}:${periodEnd}:${daysUntil}`);
    log.info({ ownerUserId, daysUntil }, 'account yearly: reminder notice enqueued');
  }

  return { processed: true };
}

/**
 * Trial end / cancel / lapse: read-only continues until the payer subscribes. Nothing is deleted.
 */
export async function processAccountTrialEnd(
  job: Job<{ ownerUserId: string }>,
): Promise<{ processed: boolean }> {
  const { ownerUserId } = job.data;
  const db0 = globalDb();

  const account = await db0.owner_accounts.findUnique({ where: { user_id: ownerUserId } });
  if (!account) {
    return { processed: false };
  }

  const trialEnds = account.trial_ends_at;
  if (!trialEnds) {
    return { processed: false };
  }

  const now = new Date();
  const trialEndsTime = new Date(trialEnds);
  const daysSinceTrialEnd = Math.floor((now.getTime() - trialEndsTime.getTime()) / (24 * 60 * 60 * 1000));

  if (daysSinceTrialEnd >= 0 && account.status === 'trialing') {
    // Trial ended without subscribing: go read_only.
    await db0.owner_accounts.update({
      where: { user_id: ownerUserId },
      data: { status: 'read_only', lapsed_at: now },
    });
    await applyReadOnlyToAllTeams(ownerUserId);
    await enqueueNotificationTx(ownerUserId, 'billing.account_trial_ended', {
      ownerUserId,
    }, `account_trial:${ownerUserId}:ended`);
    await notifyCoveredTeamAdmins(ownerUserId, {
      type: 'ended',
      date: now.toISOString().slice(0, 10),
    }).catch(() => undefined);
  }

  return { processed: true };
}

// -----------------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------------

async function db0Transaction<T>(fn: (db0: ShardClient) => Promise<T>): Promise<T> {
  return fn(globalDb());
}

async function enqueueNotificationTx(
  recipientUserId: string,
  category: string,
  payload: Record<string, unknown>,
  dedupeKey: string,
): Promise<void> {
  const db0 = globalDb();
  // Use a shard-agnostic enqueue: notification_outbox is on db0 (global).
  await db0.notification_outbox.create({
    data: {
      recipient_user_id: recipientUserId,
      category,
      payload: payload as unknown as JsonInput,
      dedupe_key: dedupeKey,
    },
  }).catch(() => undefined);
}

async function applyReadOnlyToAllTeams(ownerUserId: string): Promise<void> {
  const db0 = globalDb();
  const registries = await db0.owner_team_registry.findMany({
    where: { owner_user_id: ownerUserId },
  });
  for (const reg of registries) {
    const client = forTeam(reg.team_id);
    await client.teams.update({
      where: { id: reg.team_id },
      data: { coverage_status: 'read_only', coverage_updated_at: new Date() },
    }).catch(() => undefined);
  }
}

async function enqueueAccountPayNowLink(
  ownerUserId: string,
  amountMinor: number,
  currency: string,
): Promise<void> {
  // Pay-now link flow: manual renewal when no saved authorization.
  // The link URL is generated at the API layer; here we only enqueue the notice.
  await enqueueNotificationTx(ownerUserId, 'billing.account_pay_now_link', {
    ownerUserId,
    amountMinor,
    currency,
  }, `account_pay_now:${ownerUserId}`);
}
