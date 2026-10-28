// test-shift-access.ts — pure-logic tests for app/src/lib/shift-access.ts (Phase 4; PRD 4, S5).
// The server re-checks every write; these tests prove the UI mirror never over-grants.
// Run: npx tsx app/scripts/test-shift-access.ts
import { canManageShifts } from '../src/lib/shift-access.ts';

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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

