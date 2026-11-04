// test-shift-feed.ts — pure-logic tests for app/src/lib/shift-feed.ts and the fast-scroll
// deduplication proof (Phase 4; PRD 8.3, 12 gate row 4; rules U2, U6).
// Proves:
//   1. mergeActivityPages de-duplicates events by ID while preserving order across pages.
//   2. canRequestNextPage allows paging only when idle, with more pages, and gate not busy.
//   3. createPagingGate serialises rapid concurrent requests into exactly one execution.
//   4. Fast-scroll simulation: 20 rapid onEndReached triggers while fetching produce exactly
//      one request per page, zero duplicate cursor requests, logged with timestamps.
// Run: npx tsx app/scripts/test-shift-feed.ts
import {
  activityEventShiftId,
  canRequestNextPage,
  createPagingGate,
  mergeActivityPages,
} from '../src/lib/shift-feed.ts';
import type { ActivityEventPayload } from '@rowta/shared';

let pass = 0;
let fail = 0;

function expect<T>(label: string, actual: T, expected: T): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`PASS: ${label}`);
    pass++;
  } else {
    console.error(`FAIL: ${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    fail++;
  }
}

// ---------------------------------------------------------------------------------------------
// 1. mergeActivityPages
// ---------------------------------------------------------------------------------------------
function makeEvent(id: string, kind = 'shift.created'): ActivityEventPayload {
  return {
    id,
    kind,
    actor: { userId: 'u-1', displayName: 'Ada Lovelace' },
    subjectId: id,
    data: { label: `Shift ${id}` },
    createdAt: new Date().toISOString(),
  };
}

{
  const p1 = [makeEvent('e-1'), makeEvent('e-2')];
  const p2 = [makeEvent('e-2'), makeEvent('e-3'), makeEvent('e-4')]; // e-2 repeated
  const p3 = [makeEvent('e-4'), makeEvent('e-5')]; // e-4 repeated
  const merged = mergeActivityPages([p1, p2, p3]);
  expect('mergeActivityPages de-duplicates across pages', merged.map((e) => e.id), [
    'e-1',
    'e-2',
    'e-3',
    'e-4',
    'e-5',
  ]);
}

{
  const mergedEmpty = mergeActivityPages([[], [], []]);
  expect('mergeActivityPages with empty pages returns empty array', mergedEmpty, []);
}

// ---------------------------------------------------------------------------------------------
// 1b. activityEventShiftId (activity cards open their shift)
// ---------------------------------------------------------------------------------------------
function eventWithSubject(kind: string, subjectId: string | null): ActivityEventPayload {
  return {
    id: 'e-1',
    kind,
    actor: null,
    subjectId,
    data: {},
    createdAt: '2026-11-04T00:00:00.000Z',
  };
}

expect(
  'activityEventShiftId: shift.created with id returns the id',
  activityEventShiftId(eventWithSubject('shift.created', 'shift-1')),
  'shift-1',
);
expect(
  'activityEventShiftId: shift.updated with id returns the id',
  activityEventShiftId(eventWithSubject('shift.updated', 'shift-2')),
  'shift-2',
);
expect(
  'activityEventShiftId: shift.deleted returns null',
  activityEventShiftId(eventWithSubject('shift.deleted', 'shift-3')),
  null,
);
expect(
  'activityEventShiftId: unknown kind returns null',
  activityEventShiftId(eventWithSubject('shift.archived', 'shift-4')),
  null,
);
expect(
  'activityEventShiftId: null subjectId returns null',
  activityEventShiftId(eventWithSubject('shift.updated', null)),
  null,
);
expect(
  'activityEventShiftId: empty-string subjectId returns null',
  activityEventShiftId(eventWithSubject('shift.updated', '')),
  null,
);

// ---------------------------------------------------------------------------------------------
// 2. canRequestNextPage
// ---------------------------------------------------------------------------------------------
expect(
  'canRequestNextPage: true when hasNextPage && !isFetching && !isBusy',
  canRequestNextPage({ hasNextPage: true, isFetchingNextPage: false, isBusy: false }),
  true,
);
expect(
  'canRequestNextPage: false when !hasNextPage',
  canRequestNextPage({ hasNextPage: false, isFetchingNextPage: false, isBusy: false }),
  false,
);
expect(
  'canRequestNextPage: false when isFetchingNextPage',
  canRequestNextPage({ hasNextPage: true, isFetchingNextPage: true, isBusy: false }),
  false,
);
expect(
  'canRequestNextPage: false when isBusy',
  canRequestNextPage({ hasNextPage: true, isFetchingNextPage: false, isBusy: true }),
  false,
);

// ---------------------------------------------------------------------------------------------
// 3. createPagingGate
// ---------------------------------------------------------------------------------------------
async function testGateConcurrency() {
  let calls = 0;
  const gate = createPagingGate(async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 20));
  });

  // Fire 10 rapid calls while the first is running
  const promises: Promise<void>[] = [];
  for (let i = 0; i < 10; i++) {
    promises.push(gate.request());
  }
  await Promise.all(promises);

  expect('createPagingGate collapses 10 concurrent requests into 1', calls, 1);

  // After completion, next request succeeds
  await gate.request();
  expect('createPagingGate allows subsequent request once idle', calls, 2);

  // Handles throwing requests without staying stuck busy
  const throwGate = createPagingGate(async () => {
    throw new Error('boom');
  });
  await throwGate.request();
  expect('createPagingGate is not busy after error', throwGate.isBusy(), false);
}

// ---------------------------------------------------------------------------------------------
// 4. Fast-scroll simulation with request log
// ---------------------------------------------------------------------------------------------
type RequestLogEntry = {
  seq: number;
  timeMs: number;
  cursor: string | null;
  outcome: 'SENT' | 'IGNORED_BUSY' | 'IGNORED_NO_MORE';
};

async function runFastScrollSimulation(): Promise<RequestLogEntry[]> {
  const requestLog: RequestLogEntry[] = [];
  let seq = 0;
  let activeCursor: string | null = null;
  let pagesLeft = 3;
  let isFetching = false;

  const fakeApiFetch = async (cursor: string | null) => {
    isFetching = true;
    requestLog.push({ seq: ++seq, timeMs: Date.now(), cursor, outcome: 'SENT' });
    await new Promise((resolve) => setTimeout(resolve, 30)); // 30ms latency
    pagesLeft--;
    activeCursor = pagesLeft > 0 ? `cursor-page-${4 - pagesLeft}` : null;
    isFetching = false;
  };

  const gate = createPagingGate(() => fakeApiFetch(activeCursor));

  const triggerScrollEvent = () => {
    const allowed = canRequestNextPage({
      hasNextPage: pagesLeft > 0,
      isFetchingNextPage: isFetching,
      isBusy: gate.isBusy(),
    });
    if (!allowed) {
      requestLog.push({
        seq: ++seq,
        timeMs: Date.now(),
        cursor: activeCursor,
        outcome: pagesLeft > 0 ? 'IGNORED_BUSY' : 'IGNORED_NO_MORE',
      });
      return;
    }
    void gate.request();
  };

  // Simulate user fast scrolling: trigger onEndReached rapidly 15 times for page 1
  for (let i = 0; i < 15; i++) {
    triggerScrollEvent();
    await new Promise((r) => setTimeout(r, 5));
  }
  // Wait for page 1 to land
  await new Promise((r) => setTimeout(r, 50));

  // Rapidly scroll 10 times for page 2
  for (let i = 0; i < 10; i++) {
    triggerScrollEvent();
    await new Promise((r) => setTimeout(r, 5));
  }
  await new Promise((r) => setTimeout(r, 50));

  // Rapidly scroll 10 times for page 3 (last page)
  for (let i = 0; i < 10; i++) {
    triggerScrollEvent();
    await new Promise((r) => setTimeout(r, 5));
  }
  await new Promise((r) => setTimeout(r, 50));

  // Rapidly scroll after end of list reached
  for (let i = 0; i < 5; i++) {
    triggerScrollEvent();
  }

  return requestLog;
}

async function main() {
  await testGateConcurrency();

  const log = await runFastScrollSimulation();
  const sentRequests = log.filter((entry) => entry.outcome === 'SENT');
  const ignoredBusy = log.filter((entry) => entry.outcome === 'IGNORED_BUSY');
  const ignoredEnd = log.filter((entry) => entry.outcome === 'IGNORED_NO_MORE');

  expect('simulation sent exactly 3 page requests for 3 pages', sentRequests.length, 3);
  expect(
    'no duplicate requests sent with the same cursor',
    new Set(sentRequests.map((s) => s.cursor)).size,
    sentRequests.length,
  );
  if (ignoredBusy.length > 0) {
    console.log(`PASS: fast scroll deduplication caught and dropped ${ignoredBusy.length} duplicate triggers`);
    pass++;
  } else {
    console.error('FAIL: expected ignored busy triggers during fast scroll');
    fail++;
  }
  if (ignoredEnd.length > 0) {
    console.log(`PASS: end-of-feed triggers safely dropped (${ignoredEnd.length} dropped)`);
    pass++;
  } else {
    console.error('FAIL: expected ignored triggers at end of list');
    fail++;
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();

