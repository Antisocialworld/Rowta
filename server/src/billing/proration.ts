// Billing proration module (PRD 8.6). Pure TypeScript functions: no database, no network, no clock
// reads (the current time is always passed in as a parameter).
//
// Money is an INTEGER in the currency's smallest unit (minor units: cents, kobo, ...). Never a float
// at any boundary. All arithmetic is integer: multiply first, then integer-divide.
// Rounding: each term is rounded DOWN independently (Math.floor).
//
// Production prices come from plan_prices rows (the subscription's locked currency) and are passed
// in as a PricingTable. proration.ts contains NO prices — only plan limits (included seats,
// Starter cap 5, seat ceiling).

export type PlanId = 'starter' | 'team' | 'business';
export type Interval = 'month' | 'year';

export interface PlanPriceInput {
  readonly baseMinor: number;        // base price per period (monthly or yearly factor applied by caller)
  readonly extraSeatMinor: number | null; // per extra seat per period, null = hard cap
}

export interface PlanLimits {
  readonly includedSeats: number;
  readonly maxSeats: number;
}

export const SEAT_CEILING_DEFAULT = 200;

export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  starter: { includedSeats: 5, maxSeats: 5 },
  team: { includedSeats: 15, maxSeats: SEAT_CEILING_DEFAULT },
  business: { includedSeats: 40, maxSeats: SEAT_CEILING_DEFAULT },
};

export interface PricingTableEntry {
  readonly price: PlanPriceInput;
  readonly limits: PlanLimits;
}

export interface PricingTable {
  readonly starter: PricingTableEntry;
  readonly team: PricingTableEntry;
  readonly business: PricingTableEntry;
}

export function intervalMultiplier(interval: Interval): number {
  return interval === 'year' ? 12 : 1;
}

/**
 * Price for one period (month or year) at a given seat count.
 * periodPrice(plan, seats) = (base + extraSeatPrice * max(0, seats - included)) * intervalMultiplier
 * Returns null for invalid seats, above ceiling, or above a hard cap (extraSeatMinor === null).
 */
export function periodPrice(
  planId: PlanId,
  seats: number,
  price: PlanPriceInput,
  limits: PlanLimits,
  interval: Interval,
): number | null {
  if (!Number.isInteger(seats) || seats < 0) return null;
  if (seats > limits.maxSeats) return null;
  if (price.extraSeatMinor === null && seats > limits.includedSeats) return null;
  const extraSeats = Math.max(0, seats - limits.includedSeats);
  const extraCost = price.extraSeatMinor ?? 0;
  const base = price.baseMinor + extraCost * extraSeats;
  return base * intervalMultiplier(interval);
}

/**
 * Days elapsed since period start (whole days, floor).
 * elapsed = floor((now - period_start) / 1 day). `now` is a parameter; no clock is read.
 */
export function elapsedDays(periodStart: Date, now: Date): number {
  const diffMs = now.getTime() - periodStart.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

/**
 * Days remaining in the billing period.
 * R = P - elapsed. First day: R = P. Last day: R = 1. After the period ends: R = 0.
 */
export function daysRemaining(periodStart: Date, now: Date, periodDays: number): number {
  if (!Number.isInteger(periodDays) || periodDays <= 0) return 0;
  const elapsed = elapsedDays(periodStart, now);
  return Math.max(0, Math.min(periodDays, periodDays - elapsed));
}

/**
 * Core proration term: floor(price * remainingDays / periodDays).
 * Integer arithmetic: multiply first, then integer-divide; round DOWN.
 * Returns null for invalid input.
 */
export function prorateTerm(
  priceMinor: number,
  remainingDays: number,
  periodDays: number,
): number | null {
  if (!Number.isInteger(priceMinor) || priceMinor < 0) return null;
  if (
    !Number.isInteger(remainingDays) || !Number.isInteger(periodDays)
    || periodDays <= 0 || remainingDays < 0 || remainingDays > periodDays
  ) return null;
  return Math.floor((priceMinor * remainingDays) / periodDays);
}

/**
 * Prorated credit for the old plan.
 * credit = floor(periodPrice(oldPlan, oldSeats) * R / P)
 */
export function creditFor(
  oldPlanId: PlanId,
  oldSeats: number,
  oldPrice: PlanPriceInput,
  oldLimits: PlanLimits,
  remainingDays: number,
  periodDays: number,
  interval: Interval,
): number | null {
  const price = periodPrice(oldPlanId, oldSeats, oldPrice, oldLimits, interval);
  if (price === null) return null;
  return prorateTerm(price, remainingDays, periodDays);
}

/**
 * Prorated charge for the new plan.
 * charge = floor(periodPrice(newPlan, newSeats) * R / P)
 * Returns null if the new plan/seats combination is invalid.
 */
export function chargeFor(
  newPlanId: PlanId,
  newSeats: number,
  newPrice: PlanPriceInput,
  newLimits: PlanLimits,
  remainingDays: number,
  periodDays: number,
  interval: Interval,
): number | null {
  const price = periodPrice(newPlanId, newSeats, newPrice, newLimits, interval);
  if (price === null) return null;
  return prorateTerm(price, remainingDays, periodDays);
}

function isUpgrade(
  oldPlanId: PlanId,
  oldSeats: number,
  newPlanId: PlanId,
  newSeats: number,
): boolean {
  const rank: Record<PlanId, number> = { starter: 1, team: 2, business: 3 };
  if (rank[newPlanId] > rank[oldPlanId]) return true;
  return rank[newPlanId] === rank[oldPlanId] && newSeats > oldSeats;
}

/**
 * Compute the proration for a plan change.
 * chargeToday = charge - credit for upgrades; 0 for downgrades and seat removals.
 * Returns null if either plan/seats is invalid, or a downgrade/seat removal would leave
 * more members than the new plan allows (rejected until the owner removes members).
 */
export function prorationFor(
  oldPlanId: PlanId,
  oldSeats: number,
  newPlanId: PlanId,
  newSeats: number,
  table: PricingTable,
  remainingDays: number,
  periodDays: number,
  interval: Interval,
): { credit: number; charge: number; chargeToday: number } | null {
  if (
    !Number.isInteger(remainingDays) || !Number.isInteger(periodDays)
    || periodDays <= 0 || remainingDays < 0 || remainingDays > periodDays
  ) return null;
  const oldEntry = table[oldPlanId];
  const newEntry = table[newPlanId];
  if (oldEntry === undefined || newEntry === undefined) return null;
  const oldLimits = PLAN_LIMITS[oldPlanId];
  const newLimits = PLAN_LIMITS[newPlanId];
  // A downgrade or seat removal that would leave more members than the new plan allows is rejected.
  if (oldSeats > newLimits.maxSeats) return null;

  const credit = creditFor(
    oldPlanId, oldSeats, oldEntry.price, oldLimits, remainingDays, periodDays, interval,
  );
  const charge = chargeFor(
    newPlanId, newSeats, newEntry.price, newLimits, remainingDays, periodDays, interval,
  );
  if (credit === null || charge === null) return null;

  const chargeToday = isUpgrade(oldPlanId, oldSeats, newPlanId, newSeats)
    ? charge - credit
    : 0;

  return { credit, charge, chargeToday };
}

export function currencyDecimals(code: string): number | null {
  const decimals: Record<string, number> = { USD: 2, EUR: 2, GBP: 2, JPY: 0, NGN: 2 };
  const key = code.toUpperCase();
  const value = decimals[key];
  if (value === undefined) return null;
  return value;
}
