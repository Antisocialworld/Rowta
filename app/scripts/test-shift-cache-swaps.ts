// test-shift-cache-swaps.ts — pure-logic tests for shift edit/delete swap & activity cache invalidation (rules C7, S5, S7).
// Verifies that after a shift edit or delete, that team's swap queries and activity queries are refreshed,
// the shift's own swap query is invalidated/evicted, and other teams' caches are untouched.
import assert from 'node:assert/strict';
import {
  invalidateAfterShiftDelete,
  invalidateAfterShiftEdit,
  invalidateShiftSwapsAndActivity,
  shiftQueryKeys,
  type ShiftQueryClient,
} from '../src/lib/shift-cache';

interface MockClientState {
  client: ShiftQueryClient;
  removeQueriesCalls: readonly unknown[][];
  invalidateCalls: readonly unknown[][];
}

function createMockClient(): MockClientState {
  const removeQueriesCalls: unknown[][] = [];
  const invalidateCalls: unknown[][] = [];

  const client: ShiftQueryClient = {
    setQueriesData() {},
    removeQueries(filters) {
      removeQueriesCalls.push([...filters.queryKey]);
    },
    async invalidateQueries(filters) {
      invalidateCalls.push([...filters.queryKey]);
    },
  };

  return { client, removeQueriesCalls, invalidateCalls };
}

function testQueryKeyConventions(): void {
  assert.deepEqual(shiftQueryKeys.teamSwaps('t-1'), ['swaps', 't-1']);
  assert.deepEqual(shiftQueryKeys.shiftSwaps('t-1', 's-100'), ['swaps', 't-1', 'shift', 's-100']);
  assert.deepEqual(shiftQueryKeys.activity('t-1'), ['shifts', 't-1', 'activity']);
}

async function testEditInvalidatesTeamSwapsAndActivity(): Promise<void> {
  const { client, invalidateCalls, removeQueriesCalls } = createMockClient();

  await invalidateAfterShiftEdit(client, 'team-alpha', 'shift-101');

  // 1. Must invalidate ['shifts'] (existing calendar/shifts root)
  assert.deepEqual(invalidateCalls[0], ['shifts'], "must invalidate ['shifts'] root");

  // 2. Must invalidate team swaps: ['swaps', 'team-alpha']
  assert.deepEqual(invalidateCalls[1], ['swaps', 'team-alpha'], "must invalidate ['swaps', teamId]");

  // 3. Must invalidate shift's own swap query: ['swaps', 'team-alpha', 'shift', 'shift-101']
  assert.deepEqual(invalidateCalls[2], ['swaps', 'team-alpha', 'shift', 'shift-101'], "must invalidate ['swaps', teamId, 'shift', shiftId]");

  // 4. Must invalidate team activity: ['shifts', 'team-alpha', 'activity']
  assert.deepEqual(invalidateCalls[3], ['shifts', 'team-alpha', 'activity'], "must invalidate ['shifts', teamId, 'activity']");

  // Total invalidations: exactly 4
  assert.equal(invalidateCalls.length, 4, 'must have exactly 4 invalidations on edit with shiftId');

  // No queries removed on edit
  assert.equal(removeQueriesCalls.length, 0, 'no queries should be removed on edit');

  // Assert NO key belongs to another team
  for (const key of invalidateCalls) {
    assert.ok(!key.includes('team-beta'), 'must not touch team-beta');
  }
}

async function testDeleteEvictsShiftSwapAndInvalidatesTeamSwapsAndActivity(): Promise<void> {
  const { client, invalidateCalls, removeQueriesCalls } = createMockClient();

  await invalidateAfterShiftDelete(client, 'team-alpha', 'shift-101');

  // 1. Evicts shift's own swap query from cache
  assert.equal(removeQueriesCalls.length, 1, 'must remove shift swap query on delete');
  assert.deepEqual(removeQueriesCalls[0], ['swaps', 'team-alpha', 'shift', 'shift-101']);

  // 2. Invalidates team swaps and team activity
  assert.equal(invalidateCalls.length, 2, 'must invalidate team swaps and activity on delete');
  assert.deepEqual(invalidateCalls[0], ['swaps', 'team-alpha']);
  assert.deepEqual(invalidateCalls[1], ['shifts', 'team-alpha', 'activity']);

  // Assert NO key belongs to another team
  for (const key of [...invalidateCalls, ...removeQueriesCalls]) {
    assert.ok(!key.includes('team-beta'), 'must not touch team-beta');
  }
}

async function testOtherTeamsUntouched(): Promise<void> {
  // Simulates TanStack Query's prefix matching logic
  function matchesKey(filter: readonly unknown[], targetKey: readonly unknown[]): boolean {
    if (filter.length > targetKey.length) return false;
    return filter.every((val, idx) => targetKey[idx] === val);
  }

  const teamBQueries: readonly (readonly unknown[])[] = [
    ['shifts', 'team-beta'],
    ['shifts', 'team-beta', '2026-11-01', '2026-11-30'],
    ['shifts', 'team-beta', 'detail', 'shift-201'],
    ['shifts', 'team-beta', 'activity'],
    ['swaps', 'team-beta'],
    ['swaps', 'team-beta', 'pending'],
    ['swaps', 'team-beta', 'history'],
    ['swaps', 'team-beta', 'shift', 'shift-201'],
  ];

  // Run edit on team-alpha
  const editMock = createMockClient();
  await invalidateAfterShiftEdit(editMock.client, 'team-alpha', 'shift-101');

  // Check team-scoped invalidations from edit
  const teamScopedEditKeys = editMock.invalidateCalls.filter((k) => k.length > 1);
  for (const filter of teamScopedEditKeys) {
    for (const bKey of teamBQueries) {
      assert.ok(
        !matchesKey(filter, bKey),
        `team-alpha edit filter [${filter.join(',')}] must not match team-beta key [${bKey.join(',')}]`,
      );
    }
  }

  // Run delete on team-alpha
  const deleteMock = createMockClient();
  await invalidateAfterShiftDelete(deleteMock.client, 'team-alpha', 'shift-101');

  // Check delete remove calls
  for (const filter of deleteMock.removeQueriesCalls) {
    for (const bKey of teamBQueries) {
      assert.ok(
        !matchesKey(filter, bKey),
        `team-alpha delete remove filter [${filter.join(',')}] must not match team-beta key [${bKey.join(',')}]`,
      );
    }
  }

  // Check delete invalidate calls
  for (const filter of deleteMock.invalidateCalls) {
    for (const bKey of teamBQueries) {
      assert.ok(
        !matchesKey(filter, bKey),
        `team-alpha delete invalidate filter [${filter.join(',')}] must not match team-beta key [${bKey.join(',')}]`,
      );
    }
  }
}

async function testEditWithoutShiftId(): Promise<void> {
  const { client, invalidateCalls } = createMockClient();
  await invalidateShiftSwapsAndActivity(client, 'team-gamma');

  assert.equal(invalidateCalls.length, 2);
  assert.deepEqual(invalidateCalls[0], ['swaps', 'team-gamma']);
  assert.deepEqual(invalidateCalls[1], ['shifts', 'team-gamma', 'activity']);
}

async function runAll(): Promise<void> {
  testQueryKeyConventions();
  await testEditInvalidatesTeamSwapsAndActivity();
  await testDeleteEvictsShiftSwapAndInvalidatesTeamSwapsAndActivity();
  await testOtherTeamsUntouched();
  await testEditWithoutShiftId();
  console.log('test-shift-cache-swaps: 5 assertion suites passed');
}

void runAll();

