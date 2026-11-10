// test-shift-cache.ts — pure-logic tests for shift cache eviction & query keys (PRD 8.3, 8.4, 8.5; rules C7, S5).
// Verifies that deleted shifts are immediately removed from in-memory cached lists (calendar, search),
// detail cache is removed, and shift/swap queries are marked for invalidation.
import assert from 'node:assert/strict';
import {
  evictDeletedShiftFromQueryClient,
  removeShiftFromCacheData,
  shiftQueryKeys,
  type ShiftQueryClient,
} from '../src/lib/shift-cache';

function testRemoveShiftFromCalendarData(): void {
  const calendarData = {
    shifts: [
      { id: 'shift-1', label: 'Morning' },
      { id: 'shift-2', label: 'Evening' },
    ],
  };

  const updated = removeShiftFromCacheData(calendarData, 'shift-1');
  assert.ok(updated, 'must return data');
  assert.equal(updated.shifts.length, 1, 'must have exactly 1 shift left');
  assert.equal(updated.shifts[0]?.id, 'shift-2', 'shift-2 must be preserved');
}

function testRemoveShiftFromSearchResults(): void {
  const searchData = {
    members: [{ userId: 'u1', displayName: 'Alex' }],
    shifts: [
      { id: 'shift-1', label: 'Morning' },
      { id: 'shift-3', label: 'Night' },
    ],
    activity: [{ id: 'ev-1', kind: 'shift.created' }],
  };

  const updated = removeShiftFromCacheData(searchData, 'shift-1');
  assert.ok(updated, 'must return data');
  assert.equal(updated.shifts.length, 1, 'must have exactly 1 shift left');
  assert.equal(updated.shifts[0]?.id, 'shift-3', 'shift-3 must be preserved');
  assert.equal(updated.members.length, 1, 'members must remain intact');
  assert.equal(updated.activity.length, 1, 'activity must remain intact');
}

function testRemoveShiftNonExistentIdIsNoop(): void {
  const calendarData = {
    shifts: [{ id: 'shift-1', label: 'Morning' }],
  };

  const updated = removeShiftFromCacheData(calendarData, 'shift-999');
  assert.ok(updated, 'must return data');
  assert.equal(updated.shifts.length, 1, 'shifts length unchanged');
}

function testRemoveShiftHandlesNullUndefined(): void {
  assert.equal(removeShiftFromCacheData(null, 'shift-1'), null);
  assert.equal(removeShiftFromCacheData(undefined, 'shift-1'), undefined);
  assert.deepEqual(removeShiftFromCacheData({ foo: 'bar' }, 'shift-1'), { foo: 'bar' });
}

function testQueryKeyConventions(): void {
  assert.deepEqual(shiftQueryKeys.shiftsRoot(), ['shifts']);
  assert.deepEqual(shiftQueryKeys.teamShifts('t1'), ['shifts', 't1']);
  assert.deepEqual(shiftQueryKeys.calendar('t1', '2026-10-01', '2026-10-31'), ['shifts', 't1', '2026-10-01', '2026-10-31']);
  assert.deepEqual(shiftQueryKeys.detail('t1', 's1'), ['shifts', 't1', 'detail', 's1']);
  assert.deepEqual(shiftQueryKeys.search('t1', 'morning'), ['shifts', 't1', 'search', 'morning']);
  assert.deepEqual(shiftQueryKeys.activity('t1'), ['shifts', 't1', 'activity']);
  assert.deepEqual(shiftQueryKeys.swapsRoot(), ['swaps']);
  assert.deepEqual(shiftQueryKeys.teamsRoot(), ['teams']);
}

async function testEvictDeletedShiftFromQueryClient(): Promise<void> {
  const setQueriesDataCalls: Array<{ filter: unknown; data: unknown }> = [];
  const removeQueriesCalls: unknown[] = [];
  const invalidateCalls: unknown[] = [];

  let cachedCalendar: { shifts: Array<{ id: string }> } | undefined = {
    shifts: [{ id: 's1' }, { id: 's2' }],
  };

  const mockQueryClient: ShiftQueryClient = {
    setQueriesData<T>(filters: { queryKey: readonly unknown[] }, updater: (oldData: T | undefined) => T | undefined) {
      cachedCalendar = updater(cachedCalendar as unknown as T) as unknown as { shifts: Array<{ id: string }> } | undefined;
      setQueriesDataCalls.push({ filter: filters.queryKey, data: cachedCalendar });
    },
    removeQueries(filters) {
      removeQueriesCalls.push(filters.queryKey);
    },
    async invalidateQueries(filters) {
      invalidateCalls.push(filters.queryKey);
    },
  };

  await evictDeletedShiftFromQueryClient(mockQueryClient, 'team-abc', 's1');

  // 1. Verifies in-memory cache update
  assert.equal(setQueriesDataCalls.length, 1);
  assert.deepEqual(setQueriesDataCalls[0]?.filter, ['shifts', 'team-abc']);
  assert.deepEqual(cachedCalendar?.shifts, [{ id: 's2' }], 'deleted shift s1 must be removed from cache immediately');

  // 2. Verifies per-shift detail cache removal
  assert.equal(removeQueriesCalls.length, 1);
  assert.deepEqual(removeQueriesCalls[0], ['shifts', 'team-abc', 'detail', 's1']);

  // 3. Verifies invalidations for shifts, swaps, and teams
  assert.equal(invalidateCalls.length, 3);
  assert.deepEqual(invalidateCalls[0], ['shifts']);
  assert.deepEqual(invalidateCalls[1], ['swaps']);
  assert.deepEqual(invalidateCalls[2], ['teams']);
}

async function runAll(): Promise<void> {
  testRemoveShiftFromCalendarData();
  testRemoveShiftFromSearchResults();
  testRemoveShiftNonExistentIdIsNoop();
  testRemoveShiftHandlesNullUndefined();
  testQueryKeyConventions();
  await testEvictDeletedShiftFromQueryClient();
  console.log('test-shift-cache: 6 assertion suites passed');
}

void runAll();
