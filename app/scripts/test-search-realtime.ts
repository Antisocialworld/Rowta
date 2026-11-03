// test-search-realtime.ts — unit tests for real-time search debouncing and evaluation logic.
// Rules U1, U7, X14; PRD 8.4; ADR 0018.

import {
  evaluateSearchQuery,
  createDebouncedRunner,
  getVisibleSearchResults,
  SEARCH_DEBOUNCE_MS,
  type TimerImplementation,
} from '../src/lib/search-debounce';

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}

// ---------------------------------------------------------------------------------------------
// 1. Pure query evaluation: evaluateSearchQuery
// ---------------------------------------------------------------------------------------------
console.log('--- 1. Pure query evaluation ---');

// Fewer than 2 chars (after trim)
check(evaluateSearchQuery('', null).type === 'empty', 'empty string evaluates to empty');
check(evaluateSearchQuery('   ', null).type === 'empty', 'whitespace-only evaluates to empty');
check(evaluateSearchQuery('a', null).type === 'empty', 'single char evaluates to empty');
check(evaluateSearchQuery(' a ', null).type === 'empty', 'single char with spaces evaluates to empty');

// Identical trimmed query
check(
  evaluateSearchQuery('alice', 'alice').type === 'no_change',
  'exact same query evaluates to no_change',
);
check(
  evaluateSearchQuery('  alice   ', 'alice').type === 'no_change',
  'same query with surrounding whitespace evaluates to no_change',
);

// New valid query
const valid1 = evaluateSearchQuery('al', null);
check(
  valid1.type === 'search' && (valid1 as { query: string }).query === 'al',
  'two characters evaluates to search with trimmed query',
);

const valid2 = evaluateSearchQuery('  bob smith  ', 'alice');
check(
  valid2.type === 'search' && (valid2 as { query: string }).query === 'bob smith',
  'new trimmed query evaluates to search',
);

// ---------------------------------------------------------------------------------------------
// 2. Debounced runner: mock timer testing
// ---------------------------------------------------------------------------------------------
console.log('\n--- 2. Debounced runner with mock timer ---');

type ScheduledTask = { id: number; fn: () => void; time: number };

function createMockTimer() {
  let currentTime = 0;
  let nextId = 1;
  const tasks = new Map<number, ScheduledTask>();

  const timerImpl: TimerImplementation = {
    setTimeout(fn: () => void, ms: number) {
      const id = nextId++;
      tasks.set(id, { id, fn, time: currentTime + ms });
      return id;
    },
    clearTimeout(id: unknown) {
      tasks.delete(Number(id));
    },
  };

  return {
    timerImpl,
    advanceBy(ms: number) {
      currentTime += ms;
      const ready: ScheduledTask[] = [];
      for (const task of tasks.values()) {
        if (task.time <= currentTime) {
          ready.push(task);
        }
      }
      // Sort by trigger time
      ready.sort((a, b) => a.time - b.time);
      for (const task of ready) {
        if (tasks.has(task.id)) {
          tasks.delete(task.id);
          task.fn();
        }
      }
    },
    get pendingCount() {
      return tasks.size;
    },
  };
}

const mock = createMockTimer();
const runner = createDebouncedRunner(SEARCH_DEBOUNCE_MS, mock.timerImpl);

// A. 300ms pause fires the callback
let runCount = 0;
runner.run(() => {
  runCount++;
});

check(runCount === 0, 'callback not called immediately');
check(runner.isPending === true, 'runner is pending');

mock.advanceBy(200);
check(runCount === 0, 'callback not called after 200ms');

mock.advanceBy(100);
check(runCount === 1, 'callback called after 300ms total');
check(runner.isPending === false, 'runner is no longer pending');

// B. Next keystroke cancels previous pending run
let lastExecuted = '';
runner.run(() => {
  lastExecuted = 'first';
});
mock.advanceBy(150);
check(lastExecuted === '', 'first call not executed at 150ms');

runner.run(() => {
  lastExecuted = 'second';
});
// Advance past initial 300ms mark (150ms from second run, 300ms from first run)
mock.advanceBy(150);
check(lastExecuted === '', 'first call was cancelled, second not yet ready at 150ms');

mock.advanceBy(150);
check(lastExecuted === 'second', 'second call executed after full 300ms');

// C. Immediate execution (Enter key / immediate: true)
const execState = { immediate: false, flushed: false, cancelled: false };
runner.run(() => {
  execState.immediate = true;
}, true);
check(execState.immediate === true, 'run with immediate=true executes synchronously');
check(runner.isPending === false, 'runner not pending after immediate run');

// D. flush() executes pending run immediately
runner.run(() => {
  execState.flushed = true;
});
check(execState.flushed === false, 'pending before flush');
runner.flush();
check(execState.flushed === true, 'executed immediately on flush()');
check(runner.isPending === false, 'not pending after flush()');

// E. cancel() cancels pending run
runner.run(() => {
  execState.cancelled = true;
});
runner.cancel();
mock.advanceBy(500);
check(execState.cancelled === false, 'cancelled task never executes');
check(runner.isPending === false, 'not pending after cancel');

// ---------------------------------------------------------------------------------------------
// 3. Visible results decision: getVisibleSearchResults
// ---------------------------------------------------------------------------------------------
console.log('\n--- 3. Visible results decision ---');

const mockResults = {
  members: [{ userId: 'u1', displayName: 'Alice', role: 'staff' }],
  shifts: [],
  activity: [],
};

// empty text
check(
  getVisibleSearchResults('', mockResults) === null,
  'empty text yields null visible results',
);

// 1 character
check(
  getVisibleSearchResults('a', mockResults) === null,
  '1 character yields null visible results',
);

// whitespace
check(
  getVisibleSearchResults('   ', mockResults) === null,
  'whitespace-only yields null visible results',
);

// valid query
check(
  getVisibleSearchResults('alice', mockResults) === mockResults,
  'valid query yields search results',
);

// query then cleared
check(
  getVisibleSearchResults(null, mockResults) === null,
  'cleared query (null) yields null visible results',
);

// ---------------------------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------------------------
if (failures > 0) {
  console.error(`\nFAILED: ${failures} assertions failed.`);
  process.exit(1);
} else {
  console.log('\nALL PASS: 23/23 checks passed.');
}
