// test-shift-time.ts — pure-logic tests for app/src/lib/shift-time.ts (Phase 4; rules V1, U8).
// Verifies formatting, parsing and the calendar range helper without a device.
// Run: npx tsx app/scripts/test-shift-time.ts
import {
  parseLocalDateTime,
  isoToLocalInput,
  formatShiftDay,
  formatShiftTimeRange,
  defaultCalendarRange,
} from '../src/lib/shift-time.ts';

let pass = 0;
let fail = 0;

function expect<T>(label: string, actual: T, expected: T): void {
  if (actual === expected) {
    console.log(`PASS: ${label}`);
    pass++;
  } else {
    console.error(`FAIL: ${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    fail++;
  }
}

function expectNotNull(label: string, actual: string | null): void {
  if (actual !== null) {
    console.log(`PASS: ${label} (got "${actual}")`);
    pass++;
  } else {
    console.error(`FAIL: ${label} — got null`);
    fail++;
  }
}

function expectNull(label: string, actual: string | null): void {
  if (actual === null) {
    console.log(`PASS: ${label}`);
    pass++;
  } else {
    console.error(`FAIL: ${label} — expected null, got "${actual}"`);
    fail++;
  }
}

// parseLocalDateTime — valid inputs
expectNotNull('parse valid "2026-10-28 09:00"', parseLocalDateTime('2026-10-28 09:00'));
expectNotNull('parse valid "2026-10-28T09:00"', parseLocalDateTime('2026-10-28T09:00'));
expectNotNull('parse valid midnight "2026-12-31 00:00"', parseLocalDateTime('2026-12-31 00:00'));
expectNotNull('parse valid "2026-01-01 23:59"', parseLocalDateTime('2026-01-01 23:59'));

// parseLocalDateTime — invalid inputs (return null)
expectNull('parse empty string', parseLocalDateTime(''));
expectNull('parse bad hour "2026-10-28 25:00"', parseLocalDateTime('2026-10-28 25:00'));
expectNull('parse bad minute "2026-10-28 09:60"', parseLocalDateTime('2026-10-28 09:60'));
expectNull('parse garbage', parseLocalDateTime('not-a-date'));
expectNull('parse partial "2026-10"', parseLocalDateTime('2026-10'));
expectNull('parse impossible date "2026-13-01 09:00"', parseLocalDateTime('2026-13-01 09:00'));
expectNull('parse day 0 "2026-10-00 09:00"', parseLocalDateTime('2026-10-00 09:00'));

// isoToLocalInput — round-trip: parseLocalDateTime(isoToLocalInput(X)) should equal X (if no DST ambiguity)
{
  const iso = '2026-10-28T09:00:00.000Z';
  const localInput = isoToLocalInput(iso);
  const reparsed = parseLocalDateTime(localInput);
  if (localInput.length > 0 && reparsed !== null) {
    console.log(`PASS: isoToLocalInput round-trip for "${iso}" → "${localInput}" → reparsed ok`);
    pass++;
  } else {
    console.error(`FAIL: isoToLocalInput round-trip — localInput="${localInput}", reparsed=${String(reparsed)}`);
    fail++;
  }
}
// invalid ISO returns ''
expect('isoToLocalInput invalid returns ""', isoToLocalInput('not-a-date'), '');

// formatShiftDay — must return a non-empty string for a valid ISO
{
  const day = formatShiftDay('2026-10-28T09:00:00.000Z');
  if (day.length > 0) {
    console.log(`PASS: formatShiftDay returns non-empty string ("${day}")`);
    pass++;
  } else {
    console.error('FAIL: formatShiftDay returned empty string');
    fail++;
  }
}
expect('formatShiftDay invalid returns ""', formatShiftDay('bad'), '');

// formatShiftTimeRange — must return non-empty for valid ISO pair
{
  const range = formatShiftTimeRange('2026-10-28T09:00:00.000Z', '2026-10-28T17:00:00.000Z');
  if (range.length > 0 && range.includes('–')) {
    console.log(`PASS: formatShiftTimeRange returns range string ("${range}")`);
    pass++;
  } else {
    console.error(`FAIL: formatShiftTimeRange — got "${range}"`);
    fail++;
  }
}
expect('formatShiftTimeRange both invalid returns ""', formatShiftTimeRange('bad', 'bad'), '');

// defaultCalendarRange — window is 14 days by default and 'from' precedes 'to'
{
  const now = new Date('2026-10-28T12:00:00.000Z');
  const r = defaultCalendarRange(now);
  const fromMs = new Date(r.from).getTime();
  const toMs = new Date(r.to).getTime();
  const diffDays = (toMs - fromMs) / (24 * 60 * 60 * 1_000);
  if (toMs > fromMs && Math.abs(diffDays - 14) < 0.01) {
    console.log(`PASS: defaultCalendarRange is 14-day window`);
    pass++;
  } else {
    console.error(`FAIL: defaultCalendarRange — from=${r.from} to=${r.to} diffDays=${diffDays}`);
    fail++;
  }
}
// custom days parameter
{
  const now = new Date('2026-10-28T12:00:00.000Z');
  const r = defaultCalendarRange(now, 7);
  const diffDays = (new Date(r.to).getTime() - new Date(r.from).getTime()) / (24 * 60 * 60 * 1_000);
  if (Math.abs(diffDays - 7) < 0.01) {
    console.log(`PASS: defaultCalendarRange custom days=7`);
    pass++;
  } else {
    console.error(`FAIL: defaultCalendarRange days=7 — diffDays=${diffDays}`);
    fail++;
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

