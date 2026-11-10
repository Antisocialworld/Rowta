// test-shift-access.ts — pure-logic tests for app/src/lib/shift-access.ts (Phase 4; PRD 4, S5).
// The server re-checks every write; these tests prove the UI mirror never over-grants.
// Run: npx tsx app/scripts/test-shift-access.ts
import { canManageShifts, isShiftNotFoundError } from '../src/lib/shift-access.ts';

let pass = 0;
let fail = 0;

function expect<T>(label: string, actual: T, expected: T): void {
  if (actual === expected) {
    console.log(`PASS: ${label}`);
    pass++;
  } else {
    console.error(`FAIL: ${label} — got ${String(actual)}, expected ${String(expected)}`);
    fail++;
  }
}

// Owner and manager see management controls
expect('owner can manage', canManageShifts('owner'), true);
expect('manager can manage', canManageShifts('manager'), true);

// Staff never sees management controls
expect('staff cannot manage', canManageShifts('staff'), false);

// Unknown / missing roles (list still loading) offer nothing
expect('null role cannot manage', canManageShifts(null), false);
expect('undefined role cannot manage', canManageShifts(undefined), false);
expect('empty string cannot manage', canManageShifts(''), false);
expect('arbitrary string cannot manage', canManageShifts('superadmin'), false);

// Only the server's 404 shift.notFound code gets the friendly detail state
expect('shift.notFound is the friendly not-found state', isShiftNotFoundError({ code: 'shift.notFound' }), true);
expect('generic.error is not the not-found state', isShiftNotFoundError({ code: 'generic.error' }), false);
expect('client.network is not the not-found state', isShiftNotFoundError({ code: 'client.network' }), false);
expect('a plain Error is not the not-found state', isShiftNotFoundError(new Error('boom')), false);
expect('a string is not the not-found state', isShiftNotFoundError('shift.notFound'), false);
expect('null is not the not-found state', isShiftNotFoundError(null), false);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

