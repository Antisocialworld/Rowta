// DATE PICKER PURE LOGIC TESTS (Phase 4; rules U7, U8, V1, X6).
// Verifies pure calendar mathematics without external date libraries:
// 1. Month lengths (31, 30, 28, 29)
// 2. Leap year rules (4, 100, 400 year rules)
// 3. Month boundaries and year transitions (+1, -1)
// 4. Week start day (Monday vs Sunday alignment)
// 5. Clamping and time order validations
// 6. Round-trip parsing and formatting with parseLocalInput & parseLocalDateTime
// Run:
//   npm exec --workspace @rowta/app -- tsx scripts/test-date-picker.ts
import {
  buildMonthGrid,
  clampEndToStart,
  combineDateTime,
  formatLocalInput,
  getDaysInMonth,
  isEndBeforeStart,
  isLeapYear,
  moveMonth,
  parseLocalInput,
} from '../src/lib/date-picker';
import { parseLocalDateTime } from '../src/lib/shift-time';

let failures = 0;
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

// 1. Leap year calculations
check(isLeapYear(2024) === true, '2024 is a leap year (divisible by 4)');
check(isLeapYear(2028) === true, '2028 is a leap year (divisible by 4)');
check(isLeapYear(2026) === false, '2026 is not a leap year');
check(isLeapYear(2025) === false, '2025 is not a leap year');
check(isLeapYear(2000) === true, '2000 is a leap year (divisible by 400)');
check(isLeapYear(1900) === false, '1900 is not a leap year (divisible by 100 but not 400)');
check(isLeapYear(2100) === false, '2100 is not a leap year (divisible by 100 but not 400)');

// 2. Month lengths
check(getDaysInMonth(2026, 1) === 31, 'January 2026 has 31 days');
check(getDaysInMonth(2026, 2) === 28, 'February 2026 has 28 days (non-leap)');
check(getDaysInMonth(2024, 2) === 29, 'February 2024 has 29 days (leap)');
check(getDaysInMonth(2026, 3) === 31, 'March 2026 has 31 days');
check(getDaysInMonth(2026, 4) === 30, 'April 2026 has 30 days');
check(getDaysInMonth(2026, 5) === 31, 'May 2026 has 31 days');
check(getDaysInMonth(2026, 6) === 30, 'June 2026 has 30 days');
check(getDaysInMonth(2026, 7) === 31, 'July 2026 has 31 days');
check(getDaysInMonth(2026, 8) === 31, 'August 2026 has 31 days');
check(getDaysInMonth(2026, 9) === 30, 'September 2026 has 30 days');
check(getDaysInMonth(2026, 10) === 31, 'October 2026 has 31 days');
check(getDaysInMonth(2026, 11) === 30, 'November 2026 has 30 days');
check(getDaysInMonth(2026, 12) === 31, 'December 2026 has 31 days');

// 3. Month boundaries & transitions
const decNext = moveMonth(2026, 12, 1);
check(decNext.year === 2027 && decNext.month === 1, 'Dec 2026 + 1 month moves to Jan 2027');

const janPrev = moveMonth(2026, 1, -1);
check(janPrev.year === 2025 && janPrev.month === 12, 'Jan 2026 - 1 month moves to Dec 2025');

const octPlusThree = moveMonth(2026, 10, 3);
check(octPlusThree.year === 2027 && octPlusThree.month === 1, 'Oct 2026 + 3 months moves to Jan 2027');

const marchMinusFive = moveMonth(2026, 3, -5);
check(marchMinusFive.year === 2025 && marchMinusFive.month === 10, 'Mar 2026 - 5 months moves to Oct 2025');

// 4. Week start & month grid structure
// October 2026 starts on a Thursday (day of week 4).
// In Monday-start (weekStart=1): leading days = 3 (Mon, Tue, Wed from Sep 28, 29, 30).
const oct2026Grid = buildMonthGrid(2026, 10, 1);
check(oct2026Grid.length >= 5, 'October 2026 grid has at least 5 weeks');
const firstWeek = oct2026Grid[0];
check(firstWeek !== undefined && firstWeek.length === 7, 'Each week row in the grid has exactly 7 days');

const firstCell = firstWeek?.[0];
check(
  firstCell !== undefined &&
    firstCell.year === 2026 &&
    firstCell.month === 9 &&
    firstCell.day === 28 &&
    !firstCell.isCurrentMonth,
  'First cell of Oct 2026 Monday-start grid is Sep 28 (leading day)',
);

// Verify all 31 days of October are present and marked isCurrentMonth=true
const currentDays = oct2026Grid.flatMap((w) => w).filter((c) => c.isCurrentMonth);
check(currentDays.length === 31, 'Grid contains exactly 31 current month days for October');
const day1 = currentDays[0];
const day31 = currentDays[30];
check(
  day1 !== undefined && day31 !== undefined && day1.day === 1 && day31.day === 31,
  'Current month days run contiguously 1 to 31',
);

// Sunday-start grid (weekStart=0)
const oct2026SunGrid = buildMonthGrid(2026, 10, 0);
const firstSunWeek = oct2026SunGrid[0];
const firstSunCell = firstSunWeek?.[0];
check(
  firstSunCell !== undefined &&
    firstSunCell.year === 2026 &&
    firstSunCell.month === 9 &&
    firstSunCell.day === 27,
  'First cell of Oct 2026 Sunday-start grid is Sep 27',
);

// 5. Clamping and time order validations
check(
  isEndBeforeStart('2026-10-28 14:00', '2026-10-28 10:00') === true,
  'isEndBeforeStart: detects end time before start time on same day',
);
check(
  isEndBeforeStart('2026-10-28 14:00', '2026-10-28 14:00') === true,
  'isEndBeforeStart: detects equal start and end as invalid (zero duration)',
);
check(
  isEndBeforeStart('2026-10-28 09:00', '2026-10-28 17:00') === false,
  'isEndBeforeStart: valid shift time is not before start',
);
check(
  isEndBeforeStart('2026-10-28 09:00', '2026-10-29 09:00') === false,
  'isEndBeforeStart: next day end is not before start',
);

// Empty end sets to start + 8 hours on same day if it fits
const emptyEndClamped = clampEndToStart('2026-10-28 09:00', '');
check(
  emptyEndClamped === '2026-10-28 17:00',
  `clampEndToStart with empty end sets same day 8hr duration (${emptyEndClamped})`,
);

// Empty end exceeding midnight clamps to same day 23:59
const emptyEndLateClamped = clampEndToStart('2026-10-28 18:00', '');
check(
  emptyEndLateClamped === '2026-10-28 23:59',
  `clampEndToStart with empty end exceeding midnight clamps to same day 23:59 (${emptyEndLateClamped})`,
);

// End before start is clamped to start + 1hr
const endBeforeClamped = clampEndToStart('2026-10-28 14:00', '2026-10-28 10:00');
check(
  endBeforeClamped === '2026-10-28 15:00',
  `clampEndToStart with end before start clamps to start + 1hr (${endBeforeClamped})`,
);

// Valid end is preserved
const validEndKept = clampEndToStart('2026-10-28 09:00', '2026-10-28 18:00');
check(
  validEndKept === '2026-10-28 18:00',
  `clampEndToStart preserves valid end (${validEndKept})`,
);

// 6. Round-trip parsing & formatting
const sampleInputs = [
  '2026-10-28 09:00',
  '2024-02-29 23:55',
  '2026-01-01 00:00',
  '2026-12-31 23:59',
];

for (const input of sampleInputs) {
  const parsed = parseLocalInput(input);
  check(parsed !== null, `parseLocalInput parses valid string: ${input}`);
  if (parsed) {
    const formatted = formatLocalInput(parsed);
    check(formatted === input, `formatLocalInput round-trips: ${formatted} === ${input}`);
    const iso = parseLocalDateTime(formatted);
    check(iso !== null, `parseLocalDateTime accepts round-tripped output (${iso})`);
  }
}

// Invalid strings rejected by parseLocalInput
check(parseLocalInput('invalid') === null, 'parseLocalInput rejects non-date string');
check(parseLocalInput('2026-02-29 10:00') === null, 'parseLocalInput rejects Feb 29 on non-leap year');
check(parseLocalInput('2026-04-31 10:00') === null, 'parseLocalInput rejects Apr 31 (month has 30 days)');
check(parseLocalInput('2026-10-28 24:00') === null, 'parseLocalInput rejects hour 24');
check(parseLocalInput('2026-10-28 10:60') === null, 'parseLocalInput rejects minute 60');

// combineDateTime helper
check(combineDateTime('2026-10-28', 9, 30) === '2026-10-28 09:30', 'combineDateTime formats correctly');
check(combineDateTime('2026-10-28', 0, 5) === '2026-10-28 00:05', 'combineDateTime pads zeros');

console.log(`\nDate picker tests finished with ${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
