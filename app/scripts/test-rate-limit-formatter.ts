// RATE LIMIT FORMATTER TEST (Task 2d)
// Proves the human-readable wait formatter for 429 Retry-After countdowns:
// - under 60 seconds: "N seconds" (singular: "1 second")
// - under 1 hour: "N minutes" (round UP)
// - otherwise: "N hours" (round UP, singular/plural correct)
// - 0 and negative: null (must not show a countdown)
// Run: npx tsx app/scripts/test-rate-limit-formatter.ts

import { formatRetryIn, formatRetryWait } from '../src/lib/countdown';

let failures = 0;
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

function main(): void {
  console.log('--- formatRetryWait tests ---');
  // 1: 1 second
  check(formatRetryWait(1) === '1 second', '1 second returns "1 second" (singular)');
  // 59: 59 seconds
  check(formatRetryWait(59) === '59 seconds', '59 seconds returns "59 seconds" (plural)');
  // 60: 1 minute (under 1 hour, round UP: 60/60 = 1)
  check(formatRetryWait(60) === '1 minute', '60 seconds returns "1 minute" (singular)');
  // 61: 2 minutes (under 1 hour, round UP: ceil(61/60) = 2)
  check(formatRetryWait(61) === '2 minutes', '61 seconds returns "2 minutes" (plural, round UP)');
  // 3599: 60 minutes (under 1 hour, round UP: ceil(3599/60) = 60)
  check(formatRetryWait(3599) === '60 minutes', '3599 seconds returns "60 minutes" (round UP)');
  // 3600: 1 hour (otherwise, 3600/3600 = 1)
  check(formatRetryWait(3600) === '1 hour', '3600 seconds returns "1 hour" (singular)');
  // 3601: 2 hours (otherwise, ceil(3601/3600) = 2)
  check(formatRetryWait(3601) === '2 hours', '3601 seconds returns "2 hours" (plural, round UP)');
  // 7200: 2 hours (otherwise, 7200/3600 = 2)
  check(formatRetryWait(7200) === '2 hours', '7200 seconds returns "2 hours" (plural)');
  // 0: null (must not show a countdown)
  check(formatRetryWait(0) === null, '0 seconds returns null (no countdown)');
  // negative: null (must not show a countdown)
  check(formatRetryWait(-1) === null, '-1 seconds returns null (no countdown)');
  check(formatRetryWait(-60) === null, '-60 seconds returns null (no countdown)');

  console.log('--- formatRetryIn tests ---');
  check(formatRetryIn(1) === 'Try again in 1 second.', '1 second formatRetryIn');
  check(formatRetryIn(59) === 'Try again in 59 seconds.', '59 seconds formatRetryIn');
  check(formatRetryIn(60) === 'Try again in 1 minute.', '60 seconds formatRetryIn');
  check(formatRetryIn(61) === 'Try again in 2 minutes.', '61 seconds formatRetryIn');
  check(formatRetryIn(3599) === 'Try again in 60 minutes.', '3599 seconds formatRetryIn');
  check(formatRetryIn(3600) === 'Try again in 1 hour.', '3600 seconds formatRetryIn');
  check(formatRetryIn(3601) === 'Try again in 2 hours.', '3601 seconds formatRetryIn');
  check(formatRetryIn(7200) === 'Try again in 2 hours.', '7200 seconds formatRetryIn');
  check(formatRetryIn(0) === null, '0 seconds formatRetryIn is null');
  check(formatRetryIn(-1) === null, '-1 seconds formatRetryIn is null');
  check(formatRetryIn(null) === null, 'null formatRetryIn is null');
  check(formatRetryIn(undefined) === null, 'undefined formatRetryIn is null');

  if (failures > 0) {
    console.error(`FAILED: ${failures} check(s) failed.`);
    process.exit(1);
  } else {
    console.log('ALL RATE LIMIT FORMATTER TESTS PASSED');
  }
}

main();
