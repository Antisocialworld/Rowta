// SHIFT TIME FORMATTING AND PARSING (Phase 4; rules U8, V1, X8).
//
// The server stores and exchanges absolute instants (ISO 8601 with an offset). The app's forms use
// the device's local wall clock, because that is what a manager types; these pure helpers are the
// only place that converts between the two. Everything here is testable without a device
// (scripts/test-shift-logic.ts).
//
// formatShiftDay / formatShiftTimeRange format SERVER instants for display, never translating the
// server's own words. parseLocalDateTime returns null for anything that is not a real local
// wall-clock time, so the form can show a format message instead of inventing a date.

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Parse `YYYY-MM-DD HH:MM` (device local time) to an ISO instant, or null when invalid. */
export function parseLocalDateTime(value: string): string | null {
  const match = LOCAL_INPUT.exec(value.trim());
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (hour > 23 || minute > 59) return null;
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }
  return date.toISOString();
}

/** Format an ISO instant as `YYYY-MM-DD HH:MM` in device local time (form initial value). */
export function isoToLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The day line for a card: "Wed 28 Oct" in device local time. */
export function formatShiftDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(date);
}

/** The time line for a card: "09:00 – 17:00" in device local time. */
export function formatShiftTimeRange(startIso: string, endIso: string): string {
  const format = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';
  return `${format.format(start)}\u2013${format.format(end)}`;
}

/** A calendar window of `days` days starting at the start of today, device local time. */
export function defaultCalendarRange(now: Date = new Date(), days = 14): { from: string; to: string } {
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const to = new Date(from.getTime() + days * 24 * 60 * 60 * 1_000);
  return { from: from.toISOString(), to: to.toISOString() };
}
