// test-dashboard-shifts.ts — unit tests for app/src/lib/dashboard-shifts.ts (Phase 8; PRD 6.1).
// Run: npx tsx app/scripts/test-dashboard-shifts.ts
import type { ActivityEventPayload, ShiftView, SwapRequestView } from '@rowta/shared';
import { greetingKeyForHour } from '../src/lib/dashboard-greeting.ts';
import { teamContextLabel } from '../src/lib/team-context.ts';
import {
  canViewPendingSwaps,
  filterThisWeekShifts,
  formatLastUpdatedTime,
  getDashboardCalendarRange,
  getLatestUpdatedTimestamp,
  pickNextShift,
  pickPendingSwaps,
  pickRecentActivity,
} from '../src/lib/dashboard-shifts.ts';

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

function expectNotNull(label: string, actual: unknown): void {
  if (actual !== null && actual !== undefined) {
    console.log(`PASS: ${label}`);
    pass++;
  } else {
    console.error(`FAIL: ${label} — expected not null/undefined`);
    fail++;
  }
}

const userId = 'user-test-1111';
const otherId = 'user-test-2222';
const teamId = 'team-test-aaaa';

function mockShift(id: string, assigned: string, starts: string, ends: string): ShiftView {
  return {
    id,
    teamId,
    assignedUserId: assigned,
    startsAt: starts,
    endsAt: ends,
    label: `Shift ${id}`,
    notes: null,
    createdAt: starts,
    updatedAt: starts,
  };
}

// 1. Calendar range calculations
{
  const refDate = new Date('2026-11-04T12:00:00Z'); // Wednesday
  const range = getDashboardCalendarRange(refDate);

  // Range from must be earlier than to
  expect('range.from < range.to', new Date(range.from).getTime() < new Date(range.to).getTime(), true);

  // Range span must be 21 days (<= 42 days CALENDAR_RANGE_MAX_DAYS)
  const daysSpan = (new Date(range.to).getTime() - new Date(range.from).getTime()) / (24 * 60 * 60 * 1_000);
  expect('range covers exactly 21 days', daysSpan, 21);
}

// 2. pickNextShift tests
{
  const now = new Date('2026-11-04T12:00:00Z');

  // a) No shifts
  expect('no shifts returns null', pickNextShift([], userId, now), null);

  // b) Only other users' shifts
  const otherShift = mockShift('s1', otherId, '2026-11-04T13:00:00Z', '2026-11-04T17:00:00Z');
  expect('other users shifts returns null', pickNextShift([otherShift], userId, now), null);

  // c) Shift already ended in past
  const endedShift = mockShift('s2', userId, '2026-11-04T08:00:00Z', '2026-11-04T11:59:00Z');
  expect('already ended shift returns null', pickNextShift([endedShift], userId, now), null);

  // d) Shift currently in progress (starts before now, ends after now)
  const inProgressShift = mockShift('s3', userId, '2026-11-04T10:00:00Z', '2026-11-04T18:00:00Z');
  const pickedInProgress = pickNextShift([endedShift, inProgressShift], userId, now);
  expectNotNull('in-progress shift is picked', pickedInProgress);
  expect('picked shift is in-progress shift', pickedInProgress?.id, 's3');

  // e) Future shift later today vs tomorrow
  const futureToday = mockShift('s4', userId, '2026-11-04T14:00:00Z', '2026-11-04T20:00:00Z');
  const futureTomorrow = mockShift('s5', userId, '2026-11-05T09:00:00Z', '2026-11-05T17:00:00Z');
  const pickedFuture = pickNextShift([futureTomorrow, futureToday], userId, now);
  expect('earliest future shift is picked first', pickedFuture?.id, 's4');
}

// 3. filterThisWeekShifts tests
{
  const refDate = new Date('2026-11-04T12:00:00Z');
  const { weekStart, weekEnd } = getDashboardCalendarRange(refDate);

  const shiftInWeek1 = mockShift('w1', userId, new Date(weekStart.getTime() + 10 * 3600_000).toISOString(), new Date(weekStart.getTime() + 18 * 3600_000).toISOString());
  const shiftInWeek2 = mockShift('w2', userId, new Date(weekStart.getTime() + 30 * 3600_000).toISOString(), new Date(weekStart.getTime() + 38 * 3600_000).toISOString());
  const shiftNextWeek = mockShift('w3', userId, new Date(weekEnd.getTime() + 2 * 3600_000).toISOString(), new Date(weekEnd.getTime() + 10 * 3600_000).toISOString());
  const shiftOtherUser = mockShift('w4', otherId, new Date(weekStart.getTime() + 10 * 3600_000).toISOString(), new Date(weekStart.getTime() + 18 * 3600_000).toISOString());

  const res = filterThisWeekShifts([shiftInWeek2, shiftNextWeek, shiftOtherUser, shiftInWeek1], userId, weekStart, weekEnd);
  expect('this week count is 2', res.count, 2);
  expect('shifts sorted by start time', res.shifts[0]?.id, 'w1');
  expect('shifts sorted by start time second', res.shifts[1]?.id, 'w2');
}

// 4. formatLastUpdatedTime tests
{
  expect('empty on null/undefined', formatLastUpdatedTime(null), '');
  expect('empty on 0', formatLastUpdatedTime(0), '');

  const sampleMs = new Date('2026-11-04T14:35:00').getTime();
  const formatted = formatLastUpdatedTime(sampleMs);
  expectNotNull('formats valid time string', formatted);
  expect('formatted string length is 5 (HH:MM)', formatted.length, 5);
}

// 5. canViewPendingSwaps role gating
{
  expect('owner can view pending swaps', canViewPendingSwaps('owner'), true);
  expect('manager can view pending swaps', canViewPendingSwaps('manager'), true);
  expect('staff cannot view pending swaps', canViewPendingSwaps('staff'), false);
  expect('null role cannot view pending swaps', canViewPendingSwaps(null), false);
  expect('undefined role cannot view pending swaps', canViewPendingSwaps(undefined), false);
  expect('unknown role cannot view pending swaps', canViewPendingSwaps('viewer'), false);
}

// 6. pickPendingSwaps filtering and limiting
{
  function mockSwap(id: string, status: 'pending' | 'approved' | 'rejected' | 'cancelled'): SwapRequestView {
    return {
      id,
      teamId,
      shiftId: `shift-${id}`,
      requestedBy: userId,
      targetUserId: otherId,
      status,
      decidedBy: null,
      decidedAt: null,
      createdAt: '2026-11-04T12:00:00Z',
      updatedAt: '2026-11-04T12:00:00Z',
    };
  }

  // a) empty list
  const emptyRes = pickPendingSwaps([]);
  expect('empty swaps count is 0', emptyRes.count, 0);
  expect('empty swaps items length is 0', emptyRes.items.length, 0);

  // b) mixed statuses
  const swaps = [
    mockSwap('sw1', 'pending'),
    mockSwap('sw2', 'approved'),
    mockSwap('sw3', 'pending'),
    mockSwap('sw4', 'rejected'),
    mockSwap('sw5', 'pending'),
    mockSwap('sw6', 'cancelled'),
    mockSwap('sw7', 'pending'),
  ];
  const pendingRes = pickPendingSwaps(swaps, 3);
  expect('total pending count is 4', pendingRes.count, 4);
  expect('limited to 3 items', pendingRes.items.length, 3);
  expect('first item is sw1', pendingRes.items[0]?.id, 'sw1');
  expect('second item is sw3', pendingRes.items[1]?.id, 'sw3');
  expect('third item is sw5', pendingRes.items[2]?.id, 'sw5');
}

// 7. pickRecentActivity limiting
{
  function mockActivity(id: string): ActivityEventPayload {
    return {
      id,
      kind: 'shift.created',
      createdAt: '2026-11-04T12:00:00Z',
      actor: { userId, displayName: 'Test User' },
      subjectId: `shift-${id}`,
      data: { label: `Shift ${id}` },
    };
  }

  const events: ActivityEventPayload[] = [
    mockActivity('a1'),
    mockActivity('a2'),
    mockActivity('a3'),
    mockActivity('a4'),
    mockActivity('a5'),
    mockActivity('a6'),
    mockActivity('a7'),
  ];

  const recent = pickRecentActivity(events, 5);
  expect('sliced to 5 items', recent.length, 5);
  expect('first event matches', recent[0]?.id, 'a1');
  expect('fifth event matches', recent[4]?.id, 'a5');
}

// 8. greetingKeyForHour boundaries
{
  expect('hour 0 is evening', greetingKeyForHour(0), 'dashboard.greeting.evening');
  expect('hour 4 is evening', greetingKeyForHour(4), 'dashboard.greeting.evening');
  expect('hour 5 is morning', greetingKeyForHour(5), 'dashboard.greeting.morning');
  expect('hour 11 is morning', greetingKeyForHour(11), 'dashboard.greeting.morning');
  expect('hour 12 is afternoon', greetingKeyForHour(12), 'dashboard.greeting.afternoon');
  expect('hour 16 is afternoon', greetingKeyForHour(16), 'dashboard.greeting.afternoon');
  expect('hour 17 is evening', greetingKeyForHour(17), 'dashboard.greeting.evening');
  expect('hour 23 is evening', greetingKeyForHour(23), 'dashboard.greeting.evening');
}

// 9. teamContextLabel suffix rules
{
  expect('adds team to a plain name', teamContextLabel('marketing'), 'marketing team');
  expect('keeps a name ending in Team', teamContextLabel('Delete Test Team'), 'Delete Test Team');
  expect('keeps a name starting with Team', teamContextLabel('Team Alpha'), 'Team Alpha');
  expect('adds team when the word is only a prefix', teamContextLabel('teamwork'), 'teamwork team');
  expect('keeps an uppercase TEAM word', teamContextLabel('OPS TEAM'), 'OPS TEAM');
}

// 10. getLatestUpdatedTimestamp
{
  expect('returns 0 when no timestamps provided', getLatestUpdatedTimestamp(), 0);
  expect('handles null and undefined', getLatestUpdatedTimestamp(null, undefined, 0), 0);
  expect(
    'picks highest timestamp',
    getLatestUpdatedTimestamp(1000, 5000, 3000, null, undefined),
    5000,
  );
}

console.log(`\nResults: ${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
