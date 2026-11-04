// DASHBOARD SHIFTS PURE HELPERS (Phase 8; PRD 6.1, 8.3, 12).
// Pure logic for deriving "Your next shift" and "This week" from a single calendar range query.
// No network or React dependencies; testable in plain Node (scripts/test-dashboard-shifts.ts).
import type { ActivityEventPayload, ShiftView, SwapRequestView } from '@rowta/shared';

/**
 * Role gating for pending swaps card (PRD 6.1 line 122).
 * Owners and Managers can view and manage pending swap requests; Staff cannot.
 */
export function canViewPendingSwaps(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'manager';
}

/**
 * Filter pending swaps and take up to `limit` items (default 3) for the dashboard card.
 */
export function pickPendingSwaps(
  swaps: readonly SwapRequestView[],
  limit = 3,
): { count: number; items: SwapRequestView[] } {
  const pending = swaps.filter((s) => s.status === 'pending');
  return {
    count: pending.length,
    items: pending.slice(0, limit),
  };
}

/**
 * Limit recent activity events for the dashboard card (default 5).
 */
export function pickRecentActivity(
  events: readonly ActivityEventPayload[],
  limit = 5,
): ActivityEventPayload[] {
  return events.slice(0, limit);
}

/**
 * Find the latest dataUpdatedAt epoch timestamp across all active queries.
 */
export function getLatestUpdatedTimestamp(...timestamps: (number | null | undefined)[]): number {
  let max = 0;
  for (const t of timestamps) {
    if (typeof t === 'number' && !Number.isNaN(t) && t > max) {
      max = t;
    }
  }
  return max;
}

/**
 * Derives the single calendar range for the dashboard:
 * from Monday of current week (local time) through 21 days (covering current week + next 14 days).
 * 21 days is safely below CALENDAR_RANGE_MAX_DAYS (42).
 */
export function getDashboardCalendarRange(now: Date = new Date()): { from: string; to: string; weekStart: Date; weekEnd: Date } {
  const day = now.getDay(); // 0 = Sunday, 1 = Monday ... 6 = Saturday
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset, 0, 0, 0, 0);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1_000);
  const to = new Date(weekStart.getTime() + 21 * 24 * 60 * 60 * 1_000);

  return {
    from: weekStart.toISOString(),
    to: to.toISOString(),
    weekStart,
    weekEnd,
  };
}

/**
 * Pick the earliest shift assigned to currentUserId that has not ended yet (PRD 6.1).
 * If a shift is currently in progress (startsAt <= now < endsAt), it is included.
 * Shifts that ended in the past (endsAt <= now) are excluded.
 * Shifts belonging to other members are excluded.
 */
export function pickNextShift(
  shifts: readonly ShiftView[],
  currentUserId: string,
  now: Date = new Date(),
): ShiftView | null {
  const nowMs = now.getTime();
  const eligible = shifts.filter((s) => {
    if (s.assignedUserId !== currentUserId) return false;
    const endsMs = new Date(s.endsAt).getTime();
    return endsMs > nowMs;
  });

  if (eligible.length === 0) return null;

  return eligible.slice().sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0] ?? null;
}

/**
 * Filter shifts belonging to currentUserId that fall within the current week [weekStart, weekEnd).
 */
export function filterThisWeekShifts(
  shifts: readonly ShiftView[],
  currentUserId: string,
  weekStart: Date,
  weekEnd: Date,
): { shifts: ShiftView[]; count: number } {
  const startMs = weekStart.getTime();
  const endMs = weekEnd.getTime();

  const userShifts = shifts.filter((s) => {
    if (s.assignedUserId !== currentUserId) return false;
    const sStart = new Date(s.startsAt).getTime();
    return sStart >= startMs && sStart < endMs;
  });

  userShifts.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  return {
    shifts: userShifts,
    count: userShifts.length,
  };
}

/**
 * Remove the shift already shown as "Your next shift" from the "Your week" list, by id.
 * Returns a new array and never mutates the input.
 */
export function excludeShiftById(
  shifts: readonly ShiftView[],
  shiftId: string | null | undefined,
): ShiftView[] {
  if (!shiftId) return shifts.slice();
  return shifts.filter((s) => s.id !== shiftId);
}

/**
 * Format dataUpdatedAt epoch ms as HH:MM in device local time (en-GB).
 */
export function formatLastUpdatedTime(timestamp: number | null | undefined): string {
  if (!timestamp || Number.isNaN(timestamp)) return '';
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

