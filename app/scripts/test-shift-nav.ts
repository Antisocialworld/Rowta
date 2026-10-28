// test-shift-nav.ts — pure-logic tests for app/src/state/shift-nav.ts (Phase 4; rules U1, U2).
// Verifies route transitions, back-stack push/pop, and Android Back exit refusal without a UI.
// Run: npx tsx app/scripts/test-shift-nav.ts
import {
  initialShiftNavState,
  shiftNavReducer,
  useShiftNav,
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

// 1. Initial state
expect('initial route is null', initialShiftNavState.route, null);
expect('initial stack is empty', initialShiftNavState.stack, []);

// 2. Open first route from null
const calendarRoute: ShiftRoute = { name: 'calendar' };
const state1 = shiftNavReducer(initialShiftNavState, { type: 'open', route: calendarRoute });
expect('open first route sets route', state1.route, calendarRoute);
expect('open first route leaves stack empty', state1.stack, []);

// 3. Open second route pushes current to stack
const detailRoute: ShiftRoute = { name: 'detail', shiftId: 'shift-123' };
const state2 = shiftNavReducer(state1, { type: 'open', route: detailRoute });
expect('open second route sets route', state2.route, detailRoute);
expect('open second route pushes calendar to stack', state2.stack, [calendarRoute]);

// 4. Open third route
const editRoute: ShiftRoute = { name: 'edit', shiftId: 'shift-123' };
const state3 = shiftNavReducer(state2, { type: 'open', route: editRoute });
expect('open third route sets route', state3.route, editRoute);
expect('open third route stack has two entries', state3.stack, [calendarRoute, detailRoute]);

// 5. Back from third route pops detail
const state4 = shiftNavReducer(state3, { type: 'back' });
expect('back pops to detail', state4.route, detailRoute);
expect('back stack has one entry', state4.stack, [calendarRoute]);

// 6. Back from second route pops calendar
const state5 = shiftNavReducer(state4, { type: 'back' });
expect('back pops to calendar', state5.route, calendarRoute);
expect('back stack is empty', state5.stack, []);

// 7. Back from root route returns null
const state6 = shiftNavReducer(state5, { type: 'back' });
expect('back from root returns null route', state6.route, null);
expect('back from root stack is empty', state6.stack, []);

// 8. Back when already null returns same state
const state7 = shiftNavReducer(state6, { type: 'back' });
expect('back on null returns same state', state7, state6);

// 9. Reset returns initial state from any depth
const stateReset = shiftNavReducer(state3, { type: 'reset' });
expect('reset returns initialShiftNavState', stateReset, initialShiftNavState);

// 10. useShiftNav store integration
useShiftNav.getState().reset();
expect('store starts clean', useShiftNav.getState().route, null);

useShiftNav.getState().open(calendarRoute);
expect('store open calendar', useShiftNav.getState().route, calendarRoute);

useShiftNav.getState().open(detailRoute);
expect('store open detail', useShiftNav.getState().route, detailRoute);

const popped1 = useShiftNav.getState().back();
expect('store back() returns true when popping to calendar', popped1, true);
expect('store route is now calendar', useShiftNav.getState().route, calendarRoute);

const popped2 = useShiftNav.getState().back();
expect('store back() returns true when popping to null', popped2, true);
expect('store route is now null', useShiftNav.getState().route, null);

const popped3 = useShiftNav.getState().back();
expect('store back() returns false when nothing left to pop (refuses exit)', popped3, false);
expect('store remains null', useShiftNav.getState().route, null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

