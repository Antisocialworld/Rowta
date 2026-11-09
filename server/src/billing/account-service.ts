// Account-level billing service (C4).
// Quote, checkout, cancel for owner-account actions.
// NOT wired into live paths yet — called by account-routes and tests.
// Money is integer kobo; BigInt in DB; no floats. NAIRA ONLY.
// Every charge rounded to whole naira (multiples of 100 kobo).
import { randomUUID } from 'node:crypto';
import { globalDb } from '../db/clients.ts';
import { HttpError } from '../middleware/error.ts';
import { resolvePaymentProvider } from './provider.ts';
import { prorateTerm } from './proration.ts';
import { type AccountAction } from './account-schema.ts';
import { loadOwnerAccount, loadPlanEntitlements } from './entitlements.ts';
import { notifyCoveredTeamAdmins } from './admin-notices.ts';

export interface QuoteResult {
  readonly action: AccountAction;
  readonly amountMinor: number; // kobo, whole naira
  readonly currency: string;
  readonly description: string;
  readonly interval: string;
  readonly effectiveFrom: 'now' | 'next_renewal';
}

function roundToNaira(kobo: number): number {
  return Math.ceil(kobo / 100) * 100;
}

export async function quote(
  userId: string,
  input: { action: AccountAction; interval?: 'monthly' | 'yearly'; teamId?: string; people?: number },
): Promise<QuoteResult> {
  const account = await loadOwnerAccount(userId);
  if (!account) {
    throw new HttpError(404, 'billing.no_account', 'No owner account.');
  }

  const interval = input.interval ?? account.plan;

  // Subscribe works for any account state (read_only, past_due, cancelled, trial ended):
  // load entitlements by the chosen interval, not by account status.
  // Other actions require an active or trialing account.
  let entitlements: Awaited<ReturnType<typeof loadPlanEntitlements>>;
  if (input.action === 'subscribe') {
    entitlements = await loadPlanEntitlements(interval);
  } else {
    entitlements = account.status === 'active' || account.status === 'trialing'
      ? await loadPlanEntitlements(account.plan)
      : null;
  }
  if (!entitlements) {
    throw new HttpError(422, 'billing.no_entitlements', 'Plan entitlements not configured.');
  }

  const now = new Date();
  const periodStart = account.periodStart ?? now;
  const periodEnd = account.periodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const periodDays = Math.max(1, Math.floor((periodEnd.getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000)));
  const remainingDays = Math.max(0, Math.floor((periodEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));

  const includedPeople = account.status === 'trialing' ? entitlements.trialPeople : entitlements.peoplePerTeam;

  let amountMinor = 0;
  let description = '';
  let effectiveFrom: 'now' | 'next_renewal' = 'now';

  switch (input.action) {
    case 'subscribe': {
      amountMinor = roundToNaira(entitlements.basePriceMinor);
      description = `Subscribe ${interval} — ₦${(amountMinor / 100).toFixed(2)}`;
      effectiveFrom = 'now';
      break;
    }
    case 'add_team': {
      if (!input.teamId) {
        throw new HttpError(422, 'billing.team_required', 'Team ID is required for adding a team.');
      }
      const price = prorateTerm(entitlements.extraTeamPriceMinor, remainingDays, periodDays) ?? entitlements.extraTeamPriceMinor;
      amountMinor = roundToNaira(price);
      if (amountMinor > 0 && amountMinor < entitlements.minAddonChargeMinor) {
        amountMinor = entitlements.minAddonChargeMinor;
      }
      effectiveFrom = 'now';
      description = `Add extra team — ₦${(amountMinor / 100).toFixed(2)}`;
      break;
    }
    case 'add_people': {
      if (!input.teamId) {
        throw new HttpError(422, 'billing.team_required', 'Team ID is required for adding people.');
      }
      const people = input.people ?? 0;
      const extra = Math.max(0, people - includedPeople);
      const price = extra > 0
        ? prorateTerm(extra * entitlements.extraPersonPriceMinor, remainingDays, periodDays) ?? extra * entitlements.extraPersonPriceMinor
        : 0;
      amountMinor = roundToNaira(price);
      if (extra > 0 && amountMinor < entitlements.minAddonChargeMinor) {
        amountMinor = entitlements.minAddonChargeMinor;
      }
      effectiveFrom = extra > 0 ? 'now' : 'next_renewal';
      description = `Add ${extra} extra person(s) — ₦${(amountMinor / 100).toFixed(2)}`;
      break;
    }
    case 'switch_interval': {
      const targetEntitlements = await loadPlanEntitlements(interval);
      if (!targetEntitlements) {
        throw new HttpError(422, 'billing.no_entitlements', 'Plan entitlements not configured.');
      }
      const currentPrice = entitlements.basePriceMinor;
      const newPrice = targetEntitlements.basePriceMinor;
      if (newPrice === currentPrice) {
        throw new HttpError(422, 'billing.same_interval', 'Interval is already the current one.');
      }
      const diff = newPrice - currentPrice;
      if (diff < 0) {
        throw new HttpError(
          422,
          'billing.switch_not_available_yet',
          'You can switch to monthly when your yearly plan ends.',
        );
      }
      const price = prorateTerm(diff, remainingDays, periodDays) ?? diff;
      amountMinor = roundToNaira(price);
      effectiveFrom = 'next_renewal';
      description = `Switch to ${interval} — ₦${(amountMinor / 100).toFixed(2)}`;
      break;
    }
  }

  return { action: input.action, amountMinor, currency: account.currency, description, interval, effectiveFrom };
}

export async function checkout(
  userId: string,
  input: { action: AccountAction; interval?: 'monthly' | 'yearly'; teamId?: string; people?: number },
  idempotencyKey: string,
): Promise<{ checkoutUrl: string; txRef: string; amountMinor: number; currency: string }> {
  const quoteResult = await quote(userId, input);
  const account = await loadOwnerAccount(userId);
  if (!account) throw new HttpError(404, 'billing.no_account', 'No owner account.');
  const db0 = globalDb();

  // Idempotency: replay with same key returns existing intent (scoped to the same user).
  const existingKey = await db0.payment_intents.findFirst({
    where: { idempotency_key: idempotencyKey, created_by: userId },
  });
  if (existingKey) {
    const provider = resolvePaymentProvider();
    return {
      checkoutUrl: await provider.checkoutUrlFor(existingKey.tx_ref),
      txRef: existingKey.tx_ref,
      amountMinor: Number(existingKey.amount_minor),
      currency: existingKey.currency,
    };
  }

  const txRef = `tx-${randomUUID()}`;
  const provider = resolvePaymentProvider();

  // customerEmail comes from the users table, never ''.
  const user = await db0.users.findUnique({ where: { id: userId }, select: { email: true } });
  const customerEmail = user?.email ?? '';
  const checkout = await provider.createCheckout({
    amountMinor: quoteResult.amountMinor,
    currency: account.currency,
    txRef,
    customerEmail,
  });

  // Resolve team_id for the intent: action's teamId, or owner's first registered team.
  let teamId = input.teamId;
  if (!teamId) {
    const reg = await db0.owner_team_registry.findFirst({
      where: { owner_user_id: userId },
      orderBy: { created_at: 'asc' },
    });
    teamId = reg?.team_id ?? undefined;
  }
  if (!teamId) {
    throw new HttpError(422, 'billing.no_team', 'No team to associate the charge with.');
  }

  const intent = await db0.payment_intents.create({
    data: {
      team_id: teamId,
      tx_ref: checkout.txRef,
      purpose: 'account_action',
      amount_minor: BigInt(quoteResult.amountMinor),
      currency: account.currency,
      status: 'pending',
      idempotency_key: idempotencyKey,
      created_by: userId,
      plan: quoteResult.interval,
      seats: input.people ?? 0,
      interval: quoteResult.interval === 'yearly' ? 'year' : 'month',
      kind: `account_${input.action}`,
    },
  });

  return {
    checkoutUrl: checkout.checkoutUrl,
    txRef: intent.tx_ref,
    amountMinor: Number(intent.amount_minor),
    currency: intent.currency,
  };
}

export async function cancelAccount(
  userId: string,
  idempotencyKey: string,
): Promise<{ cancelled: boolean }> {
  const db0 = globalDb();

  const account = await loadOwnerAccount(userId);
  if (!account) {
    throw new HttpError(404, 'billing.no_account', 'No owner account.');
  }

  const existingKey = await db0.payment_intents.findFirst({
    where: { idempotency_key: idempotencyKey, created_by: userId },
  });
  if (existingKey) {
    return { cancelled: true };
  }

  await db0.owner_accounts.update({
    where: { user_id: userId },
    data: { cancel_at_period_end: true, updated_at: new Date() },
  });

  const cancelDate = account.periodEnd
    ? new Date(account.periodEnd).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  await notifyCoveredTeamAdmins(userId, { type: 'cancelled', date: cancelDate }).catch(() => undefined);

  return { cancelled: true };
}

export async function resumeAccount(
  userId: string,
  idempotencyKey: string,
): Promise<{ resumed: boolean }> {
  const db0 = globalDb();

  const account = await loadOwnerAccount(userId);
  if (!account) {
    throw new HttpError(404, 'billing.no_account', 'No owner account.');
  }

  const existingKey = await db0.payment_intents.findFirst({
    where: { idempotency_key: idempotencyKey, created_by: userId },
  });
  if (existingKey) {
    return { resumed: true };
  }

  if (!account.cancelAtPeriodEnd) {
    // Already not cancelled at period end; nothing to resume.
    return { resumed: true };
  }

  const now = new Date();
  if (!account.periodEnd || new Date(account.periodEnd) <= now) {
    throw new HttpError(409, 'billing.cannot_resume', 'This period has ended or your account is cancelled.');
  }

  await db0.owner_accounts.update({
    where: { user_id: userId },
    data: { cancel_at_period_end: false, updated_at: new Date() },
  });

  const resumeDate = new Date().toISOString().slice(0, 10);
  await notifyCoveredTeamAdmins(userId, { type: 'kept', date: resumeDate }).catch(() => undefined);

  return { resumed: true };
}

/** Validate that only the account owner can call these endpoints. */
export async function assertAccountOwner(userId: string, targetUserId: string): Promise<void> {
  if (userId !== targetUserId) {
    throw new HttpError(403, 'billing.account_owner_only', 'Only the account owner can manage billing.');
  }
}
