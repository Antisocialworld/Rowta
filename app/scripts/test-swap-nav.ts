// test-swap-nav.ts — pure-logic tests for navigation to swaps route (Phase 5; rules U1, U2).
import {
  initialShiftNavState,
  shiftNavReducer,
  type ShiftRoute,
} from '../src/state/shift-nav.ts';

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

// 1. Open swaps from null
const swapsRoute: ShiftRoute = { name: 'swaps' };
const state1 = shiftNavReducer(initialShiftNavState, { type: 'open', route: swapsRoute });
expect('open swaps from root sets route', state1.route, swapsRoute);
expect('open swaps from root leaves stack empty', state1.stack, []);

// 2. Open swaps from calendar pushes calendar
const calendarRoute: ShiftRoute = { name: 'calendar' };
const calendarState = shiftNavReducer(initialShiftNavState, { type: 'open', route: calendarRoute });
const state2 = shiftNavReducer(calendarState, { type: 'open', route: swapsRoute });
expect('open swaps from calendar sets route', state2.route, swapsRoute);
expect('open swaps from calendar pushes calendar to stack', state2.stack, [calendarRoute]);

// 3. Back from swaps pops to calendar
const state3 = shiftNavReducer(state2, { type: 'back' });
expect('back from swaps restores calendar route', state3.route, calendarRoute);
expect('back from swaps leaves stack empty', state3.stack, []);

// 4. Open swaps from shift detail pushes detail
const detailRoute: ShiftRoute = { name: 'detail', shiftId: 'shift-999' };
const detailState = shiftNavReducer(calendarState, { type: 'open', route: detailRoute });
const state4 = shiftNavReducer(detailState, { type: 'open', route: swapsRoute });
expect('open swaps from detail sets route', state4.route, swapsRoute);
expect('open swaps from detail pushes calendar and detail', state4.stack, [calendarRoute, detailRoute]);

// 5. Back from swaps returns to detail
const state5 = shiftNavReducer(state4, { type: 'back' });
expect('back from swaps restores detail', state5.route, detailRoute);
expect('stack retains calendar', state5.stack, [calendarRoute]);

console.log(`test-swap-nav: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

