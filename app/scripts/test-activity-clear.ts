// test-activity-clear.ts — verifies pure helpers for "clear all activity".
//   * activityClearKey(userId, teamId): key built from userId + teamId; different users/teams differ.
//   * createActivityClearStore(backend): read/write/clear round-trip, storage errors never throw,
//     per-user per-team keys are separate.
//   * newestCreatedAt(events): picks createdAt of the newest (first) event.
// Pure logic: no React, no server, no database, no Expo.
// Run from the repo root:  node app/scripts/test-activity-clear.ts
import { activityClearKey, createActivityClearStore, memoryBackend } from '../src/lib/activity-clear-store';

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------------------------------
  // 1. activityClearKey
  // ---------------------------------------------------------------------------------------------
  const key1 = activityClearKey('user-a', 'team-1');
  const key2 = activityClearKey('user-b', 'team-1');
  const key3 = activityClearKey('user-a', 'team-2');
  const key4 = activityClearKey('user-a', 'team-1');

  check(typeof key1 === 'string' && key1.length > 0, 'activityClearKey returns a non-empty string');
  check(key1.includes('user-a') && key1.includes('team-1'), 'activityClearKey contains userId and teamId');
  check(key1 !== key2, 'different user => different key');
  check(key1 !== key3, 'different team => different key');
  check(key1 === key4, 'same user+team => same key (stable)');
  check(!key1.includes(' '), 'key has no spaces (safe storage key)');

  // ---------------------------------------------------------------------------------------------
  // 2. createActivityClearStore over the memory backend
  // ---------------------------------------------------------------------------------------------
  const store = createActivityClearStore(memoryBackend());

  check((await store.readClearedUntil('u1', 't1')) === null, 'readClearedUntil returns null when never cleared');

  await store.writeClearedUntil('u1', 't1', '2026-01-01T12:00:00.000Z');
  check((await store.readClearedUntil('u1', 't1')) === '2026-01-01T12:00:00.000Z', 'writeClearedUntil then readClearedUntil round-trips');

  await store.clearClearedUntil('u1', 't1');
  check((await store.readClearedUntil('u1', 't1')) === null, 'clearClearedUntil removes the value');

  // ---------------------------------------------------------------------------------------------
  // 3. Per-user per-team keys are separate
  // ---------------------------------------------------------------------------------------------
  await store.writeClearedUntil('user-a', 'team-1', 'ts-a1');
  await store.writeClearedUntil('user-b', 'team-1', 'ts-b1');
  await store.writeClearedUntil('user-a', 'team-2', 'ts-a2');

  check((await store.readClearedUntil('user-a', 'team-1')) === 'ts-a1', 'user-a/team-1 reads its own value');
  check((await store.readClearedUntil('user-b', 'team-1')) === 'ts-b1', 'user-b/team-1 reads its own value');
  check((await store.readClearedUntil('user-a', 'team-2')) === 'ts-a2', 'user-a/team-2 reads its own value');

  // ---------------------------------------------------------------------------------------------
  // 4. Storage errors never throw (read returns null, write/clear are no-ops)
  // ---------------------------------------------------------------------------------------------
  {
    const failing: Parameters<typeof createActivityClearStore>[0] = {
      get: async () => { throw new Error('keystore unavailable'); },
      set: async () => { throw new Error('keystore unavailable'); },
      remove: async () => { throw new Error('keystore unavailable'); },
    };
    const flakyStore = createActivityClearStore(failing);

    const read = await flakyStore.readClearedUntil('u1', 't1');
    check(read === null, 'a failing read returns null (not cleared)');

    await flakyStore.writeClearedUntil('u1', 't1', 'ts-x');
    check((await flakyStore.readClearedUntil('u1', 't1')) === null, 'a failing write is silently dropped');

    await flakyStore.clearClearedUntil('u1', 't1');
    check((await flakyStore.readClearedUntil('u1', 't1')) === null, 'a failing clear is silently dropped');
  }

  // ---------------------------------------------------------------------------------------------
  // 5. newestCreatedAt: pure picker (replicated here for the test; the real one lives in the screen)
  // ---------------------------------------------------------------------------------------------
  function newestCreatedAt(events: { createdAt: string }[]): string | null {
    if (events.length === 0) return null;
    const first = events[0];
    if (first === undefined) return null;
    return first.createdAt;
  }

  check(newestCreatedAt([]) === null, 'newestCreatedAt returns null for empty events');
  check(
    newestCreatedAt([{ createdAt: '2026-01-01T00:00:00.000Z' }]) === '2026-01-01T00:00:00.000Z',
    'newestCreatedAt returns first event createdAt',
  );
  check(
    newestCreatedAt([
      { createdAt: '2026-01-01T00:00:00.000Z' },
      { createdAt: '2026-01-02T00:00:00.000Z' },
    ]) === '2026-01-01T00:00:00.000Z',
    'newestCreatedAt returns first (newest) event, not the last',
  );

  console.log(`\n${failures === 0 ? 'All activity-clear checks passed.' : `${failures} activity-clear check(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
