// Billing service (Task 5).
// Holder-only billing logic: checkout, plan change, seats change, cancel, status.
// All amounts are integer minor units; no floats. Uses proration.ts for calculations.
// Prices come from plan_prices (the subscription's locked currency); this module contains NO prices.

import { randomUUID } from 'node:crypto';
import { globalDb, forTeam } from '../db/clients.ts';
import { HttpError } from '../middleware/error.ts';
import { can, type Role } from '../security/policy.ts';
import { type PlanId } from './schema.ts';
import { daysRemaining, prorationFor, type PricingTable, PLAN_LIMITS } from './proration.ts';
import { resolvePaymentProvider } from './provider.ts';

/** camelCase plan price used by the billing code (mapped from the plan_prices row at the database boundary). */
export interface PriceRow {
  readonly plan: string;
  readonly currency: string;
  readonly baseMinor: number;
  readonly extraSeatMinor: number | null;
}

/** camelCase currency config used by the billing code (mapped from the currencies row). */
export interface CurrencyRow {
  readonly code: string;
  readonly minorUnit: number;
  readonly providerSupported: boolean;
  readonly enabled: boolean;
}

/** Map a Prisma currencies row to the camelCase currency config used by proration/money. */
export function toCurrencyRow(row: { code: string; minor_unit: number; provider_supported: boolean; enabled: boolean }): CurrencyRow {
  return {
    code: row.code,
    minorUnit: row.minor_unit,
    providerSupported: row.provider_supported,
    enabled: row.enabled,
  };
}

/** Map a Prisma plan_prices row to the camelCase price input used by proration. */
export function toPlanPriceInput(row: { plan: string; currency: string; base_minor: bigint; extra_seat_minor: bigint | null }): { plan: string; currency: string; baseMinor: number; extraSeatMinor: number | null } {
  return {
    plan: row.plan,
    currency: row.currency,
    baseMinor: Number(row.base_minor),
    extraSeatMinor: row.extra_seat_minor === null ? null : Number(row.extra_seat_minor),
  };
}

/** Build a PricingTable from DB rows for the subscription's locked currency. */
export function buildPricingTable(prices: PriceRow[]): PricingTable | null {
  const byPlan = new Map<string, PriceRow>();
  for (const p of prices) byPlan.set(p.plan, p);
  const starter = byPlan.get('starter');
  const team = byPlan.get('team');
  const business = byPlan.get('business');
  if (!starter || !team || !business) return null; // not sold: missing a plan price
  const table: PricingTable = {
    starter: { price: starter, limits: PLAN_LIMITS.starter },
    team: { price: team, limits: PLAN_LIMITS.team },
    business: { price: business, limits: PLAN_LIMITS.business },
  };
  return table;
}

/** A currency is SOLD only if enabled, provider_supported, and plan_prices has a row for every plan. */
export function isCurrencySold(currency: CurrencyRow, prices: PriceRow[]): boolean {
  if (!currency.enabled || !currency.providerSupported) return false;
  const plans = new Set(prices.filter((p) => p.currency === currency.code).map((p) => p.plan));
  return plans.has('starter') && plans.has('team') && plans.has('business');
}

/** Count active non-owner members (a seat = active non-owner membership). */
export async function countBillableSeats(teamId: string): Promise<number> {
  const client = forTeam(teamId);
  const res = await client.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count FROM memberships
    WHERE team_id = ${teamId}::uuid AND role <> 'owner' AND removed_at IS NULL
  `;
  return res[0]?.count ?? 0;
}

/** Start checkout: legacy per-team checkout disabled; owner decided: use account billing. */
export async function startCheckout(
  _userId: string,
  _teamId: string,
  _input: { plan: PlanId; seats: number; interval: 'month' | 'year' },
  _idempotencyKey: string,
): Promise<{ checkoutUrl: string; txRef: string; amountMinor: number; currency: string }> {
  throw new HttpError(410, 'billing.checkout_moved', 'This checkout has moved. Use account billing.');
}

/** Change plan: upgrade → pay chargeToday now (via intent, applied by webhook job); downgrade → schedule at period end. */
export async function changePlan(
  userId: string,
  teamId: string,
  input: { plan: PlanId },
  idempotencyKey: string,
): Promise<{ credit: number; charge: number; chargeToday: number; scheduled: boolean; checkoutUrl?: string }> {
  const shardClient = forTeam(teamId);
  const db0 = globalDb();

  const sub = await shardClient.subscriptions.findUnique({ where: { team_id: teamId } });
  if (!sub) throw new HttpError(404, 'billing.not_found', 'No subscription for this team.');
  if (sub.billing_user_id !== userId) {
    throw new HttpError(403, 'billing.holder_only', 'Only the billing holder can change the plan.');
  }

  // Interval change rejected (interval is locked for the subscription's life).
  if (input.plan === sub.plan) {
    // Same plan, just seats may change via changeSeats; a plan change to the same plan is a no-op.
    throw new HttpError(422, 'billing.same_plan', 'Plan change to the same plan is not allowed.');
  }

  const prices = await db0.plan_prices.findMany({ where: { currency: sub.currency } });
  const priceInputs = prices.map(toPlanPriceInput);
  const table = buildPricingTable(priceInputs);
  if (!table) throw new HttpError(422, 'billing.currency_not_sold', 'This currency is not sold.');

  const billableSeats = await countBillableSeats(teamId);
  const newLimits = table[input.plan].limits;
  if (billableSeats > newLimits.maxSeats) {
    throw new HttpError(422, 'billing.new_plan_cap', 'Downgrade rejected: more members than the new plan allows.');
  }

  // F9: R and P from period_start / period_end using Task 1 clock function.
  const now = new Date();
  const periodDays = Math.max(1, Math.floor((sub.period_end.getTime() - sub.period_start.getTime()) / (24 * 60 * 60 * 1000)));
  const remainingDays = daysRemaining(sub.period_start, now, periodDays);

  // Direction by plan rank and seat count, NOT by chargeToday > 0.
  const rank: Record<PlanId, number> = { starter: 1, team: 2, business: 3 };
  const isUpgrade = rank[input.plan] > rank[sub.plan as PlanId];

  let newSeats = sub.seats;
  if (!isUpgrade) {
    // Downgrade: newSeats = min(sub.seats, newLimits.maxSeats), must be >= current billable members.
    newSeats = Math.min(sub.seats, newLimits.maxSeats);
    if (newSeats < billableSeats) {
      throw new HttpError(422, 'billing.new_plan_cap', 'Downgrade rejected: more members than the new plan allows.');
    }
  }

  const result = prorationFor(
    sub.plan as PlanId, sub.seats, input.plan, newSeats, table, remainingDays, periodDays, sub.interval as 'month' | 'year',
  );
  if (!result) throw new HttpError(422, 'billing.proration_failed', 'Proration failed.');

  if (isUpgrade) {
    if (result.chargeToday > 0) {
      // Upgrade: create checkout + intent for chargeToday; webhook job applies new plan/seats after verified success.
      const txRef = `tx-${randomUUID()}`;
      const provider = resolvePaymentProvider();
      const payer = await db0.users.findUnique({ where: { id: userId } });
      if (!payer) throw new HttpError(404, 'user.not_found', 'User not found.');
      const checkout = await provider.createCheckout({
        amountMinor: result.chargeToday,
        currency: sub.currency,
        txRef,
        customerEmail: payer.email,
      });
      await db0.payment_intents.create({
        data: {
          team_id: teamId,
          tx_ref: checkout.txRef,
          purpose: 'plan_change',
          amount_minor: BigInt(result.chargeToday),
          currency: sub.currency,
          status: 'pending',
          idempotency_key: idempotencyKey,
          created_by: userId,
          plan: input.plan,
          seats: sub.seats,
          interval: sub.interval as 'month' | 'year',
          kind: 'upgrade',
        },
      });
      return { credit: result.credit, charge: result.charge, chargeToday: result.chargeToday, scheduled: false, checkoutUrl: checkout.checkoutUrl };
    }
    // chargeToday is 0: upgrade within included seats, no payment needed (PRD 8.6: charge 0 now, scheduled change stored).
    return { credit: result.credit, charge: result.charge, chargeToday: 0, scheduled: false };
  }

  // Downgrade: schedule at period end (charge 0 now).
  await shardClient.subscriptions.update({
    where: { team_id: teamId },
    data: { scheduled_plan: input.plan, scheduled_seats: newSeats },
  });
  return { credit: result.credit, charge: result.charge, chargeToday: 0, scheduled: true };
}

/** Change seats: extra seats only Team/Business; within included seats charge is 0. */
export async function changeSeats(
  userId: string,
  teamId: string,
  input: { seats: number },
  idempotencyKey: string,
): Promise<{ credit: number; charge: number; chargeToday: number; scheduled: boolean; checkoutUrl?: string }> {
  const shardClient = forTeam(teamId);
  const db0 = globalDb();

  const sub = await shardClient.subscriptions.findUnique({ where: { team_id: teamId } });
  if (!sub) throw new HttpError(404, 'billing.not_found', 'No subscription for this team.');
  if (sub.billing_user_id !== userId) {
    throw new HttpError(403, 'billing.holder_only', 'Only the billing holder can change seats.');
  }

  // FIX-H: reject seats below current billable members.
  const billableSeats = await countBillableSeats(teamId);
  if (input.seats < billableSeats) {
    throw new HttpError(422, 'billing.seats_below_members', 'Seat count below current billable members.');
  }

  if (input.seats > 200) throw new HttpError(422, 'billing.seat_ceiling', 'Seat ceiling of 200 exceeded.');
  if (sub.plan === 'starter' && input.seats > 5) throw new HttpError(422, 'billing.starter_cap', 'Starter supports at most 5 seats.');

  const prices = await db0.plan_prices.findMany({ where: { currency: sub.currency } });
  const priceInputs = prices.map(toPlanPriceInput);
  const table = buildPricingTable(priceInputs);
  if (!table) throw new HttpError(422, 'billing.currency_not_sold', 'This currency is not sold.');

  const newLimits = table[sub.plan as PlanId].limits;
  if (input.seats > newLimits.maxSeats) {
    throw new HttpError(422, 'billing.new_plan_cap', 'Seat count exceeds plan ceiling.');
  }

  // FIX-D: R and P from period_start / period_end using Task 1 clock function.
  const now = new Date();
  const periodDays = Math.max(1, Math.floor((sub.period_end.getTime() - sub.period_start.getTime()) / (24 * 60 * 60 * 1000)));
  const remainingDays = daysRemaining(sub.period_start, now, periodDays);

  const result = prorationFor(
    sub.plan as PlanId, sub.seats, sub.plan as PlanId, input.seats, table, remainingDays, periodDays, sub.interval as 'month' | 'year',
  );
  if (!result) throw new HttpError(422, 'billing.proration_failed', 'Proration failed.');

  const isUp = input.seats > sub.seats;
  if (isUp) {
    // Seat increase: create checkout + intent for chargeToday; webhook job applies new seats after verified success.
    const txRef = `tx-${randomUUID()}`;
    const provider = resolvePaymentProvider();
    const payer = await db0.users.findUnique({ where: { id: userId } });
    if (!payer) throw new HttpError(404, 'user.not_found', 'User not found.');
    const checkout = await provider.createCheckout({
      amountMinor: result.chargeToday,
      currency: sub.currency,
      txRef,
      customerEmail: payer.email,
    });
    await db0.payment_intents.create({
      data: {
        team_id: teamId,
        tx_ref: checkout.txRef,
        purpose: 'seats',
        amount_minor: BigInt(result.chargeToday),
        currency: sub.currency,
        status: 'pending',
        idempotency_key: idempotencyKey,
        created_by: userId,
        plan: sub.plan,
        seats: input.seats,
        interval: sub.interval as 'month' | 'year',
        kind: 'seats',
      },
    });
    return { credit: result.credit, charge: result.charge, chargeToday: result.chargeToday, scheduled: false, checkoutUrl: checkout.checkoutUrl };
  }

  // Seat removal: schedule at period end (charge 0 now).
  await shardClient.subscriptions.update({
    where: { team_id: teamId },
    data: { scheduled_seats: input.seats },
  });
  return { credit: result.credit, charge: result.charge, chargeToday: 0, scheduled: true };
}

/** Cancel: access continues to period end, no further charge. Idempotent. */
export async function cancel(
  userId: string,
  teamId: string,
  _input: { confirm: 'cancel' },
  idempotencyKey: string,
): Promise<{ cancelled: boolean }> {
  const shardClient = forTeam(teamId);
  const db0 = globalDb();

  const sub = await shardClient.subscriptions.findUnique({ where: { team_id: teamId } });
  if (!sub) throw new HttpError(404, 'billing.not_found', 'No subscription for this team.');
  if (sub.billing_user_id !== userId) {
    throw new HttpError(403, 'billing.holder_only', 'Only the billing holder can cancel.');
  }

  // Idempotency: replay with same key returns without side effects.
  const existingKey = await db0.payment_intents.findFirst({ where: { team_id: teamId, idempotency_key: idempotencyKey } });
  if (existingKey) {
    return { cancelled: true };
  }

  await shardClient.subscriptions.update({
    where: { team_id: teamId },
    data: { cancel_at_period_end: true },
  });
  return { cancelled: true };
}

/** Polling status: return pending intent even when no subscription exists.
 * Only the team's owner-role member or the billing holder may call it; Manager/Staff get 403. */
export async function getStatus(
  userId: string,
  teamId: string,
): Promise<{
  subscription: { plan: string; seats: number; status: string; interval: string; currency: string; billing_user_id: string | null } | null;
  coverageStatus: string;
  ownerDisplayName: string | null;
}> {
  const shardClient = forTeam(teamId);
  const db0 = globalDb();

  // Team row: coverage status + owner (created_by).
  const team = await shardClient.teams.findUnique({ where: { id: teamId } });
  if (!team) throw new HttpError(404, 'team.notFound', 'Team not found.');

  // Membership check + policy: only the team Admin (owner role) may view status-only billing.
  const membership = await shardClient.memberships.findUnique({
    where: { team_id_user_id: { team_id: teamId, user_id: userId } },
  });
  if (!membership || membership.removed_at !== null) {
    throw new HttpError(404, 'team.notFound', 'Team not found.');
  }
  if (!can({ id: userId }, { ...membership, role: membership.role as Role }, 'view_billing', { accountOwnerId: team.created_by ?? undefined })) {
    throw new HttpError(403, 'billing.holder_only', 'Only the team Admin may view billing status.');
  }

  // Owner display name (no amounts, no payment data).
  let ownerDisplayName: string | null = null;
  if (team.created_by) {
    const owner = await db0.users.findUnique({ where: { id: team.created_by }, select: { display_name: true } });
    ownerDisplayName = owner?.display_name ?? null;
  }

  // Subscription (legacy per-team row; basic fields only, no amounts).
  const sub = await shardClient.subscriptions.findUnique({ where: { team_id: teamId } });

  return {
    subscription: sub
      ? {
          plan: sub.plan,
          seats: sub.seats,
          status: sub.status,
          interval: sub.interval,
          currency: sub.currency,
          billing_user_id: sub.billing_user_id,
        }
      : null,
    coverageStatus: team.coverage_status ?? 'covered',
    ownerDisplayName,
  };
}
