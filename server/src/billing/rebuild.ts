// rebuildFromLedger (Task 6, PRD 8.6).
// Rebuilds subscription state (plan, seats, interval, currency, status, period) from ledger rows
// only. A test proves it equals the stored state. Ledger columns plan/seats/interval (added in
// Task 3) carry the per-charge plan/seats/interval; no personal data, no card data.

import { forTeam } from '../db/clients.ts';

export interface RebuiltSubscription {
  readonly plan: string;
  readonly seats: number;
  readonly interval: 'month' | 'year';
  readonly currency: string;
  readonly status: 'active' | 'past_due' | 'restricted' | 'cancelled';
  readonly periodStart: Date | null;
  readonly periodEnd: Date | null;
}

/**
 * Rebuild subscription state from ledger rows only.
 * Sign convention: charge > 0 (team owes), credit and refund < 0, adjustment either sign but never 0.
 * The latest non-cancelled charge defines the current plan/seats/interval/currency.
 * Status is 'active' unless a later ledger row marks otherwise.
 */
export async function rebuildFromLedger(
  teamId: string,
): Promise<{ rebuilt: RebuiltSubscription; ledgerCount: number }> {
  const client = forTeam(teamId);

  const rows = await client.$queryRaw<{
    id: string;
    kind: string;
    amount_minor: number;
    currency: string;
    plan: string | null;
    seats: number | null;
    interval: string | null;
    period_start: Date | null;
    period_end: Date | null;
    created_at: Date;
  }[]>`
    SELECT id, kind, amount_minor, currency, plan, seats, interval, period_start, period_end, created_at
    FROM ledger_entries
    WHERE team_id = ${teamId}::uuid
    ORDER BY created_at DESC, id DESC
  `;

  const ledgerCount = rows.length;

  // Start from defaults.
  let plan = 'starter';
  let seats = 0;
  let interval: 'month' | 'year' = 'month';
  let currency = 'NGN';
  let status: 'active' | 'past_due' | 'restricted' | 'cancelled' = 'active';
  let periodStart: Date | null = null;
  let periodEnd: Date | null = null;

  // Apply rows in chronological order (oldest first) so the last charge wins.
  for (const row of [...rows].reverse()) {
    currency = row.currency;
    if (row.plan) plan = row.plan;
    if (row.seats !== null && row.seats !== undefined) seats = row.seats;
    if (row.interval === 'month' || row.interval === 'year') interval = row.interval;
    if (row.period_start) periodStart = row.period_start;
    if (row.period_end) periodEnd = row.period_end;
    if (row.kind === 'charge') status = 'active';
    if (row.kind === 'refund') status = 'cancelled';
  }

  return {
    rebuilt: { plan, seats, interval, currency, status, periodStart, periodEnd },
    ledgerCount,
  };
}
