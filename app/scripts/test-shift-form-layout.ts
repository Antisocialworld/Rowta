// test-shift-form-layout.ts — verifies that ShiftCreateEditScreen stacks date inputs and pick buttons vertically (R1c; rules U1, U7, X6).
// Verifies:
// 1. ShiftCreateEditScreen.tsx exists.
// 2. The date field container is not a horizontal row (timeInputRow no longer exists and date fields are not row-oriented).
// 3. Both testIDs shift-starts-picker-btn and shift-ends-picker-btn still exist.
// 4. Both date input testIDs shift-starts-input and shift-ends-input still exist.
// 5. DateTimePickerModal is still imported and rendered.
// NOTE: Written per standing rules; do not run unless explicitly authorized by the owner.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}

const SCREEN_PATH = resolve(__dirname, '../src/screens/shifts/ShiftCreateEditScreen.tsx');

console.log('--- 1. ShiftCreateEditScreen existence and layout ---');
check(existsSync(SCREEN_PATH), 'ShiftCreateEditScreen.tsx exists');

const src = existsSync(SCREEN_PATH) ? readFileSync(SCREEN_PATH, 'utf8') : '';

// 2. Assert no horizontal row wrapper around date input and pick button
check(!src.includes('timeInputRow'), 'timeInputRow style is removed');
check(!src.includes('timeInputFlex'), 'timeInputFlex style is removed');

// Assert that date field containers stack vertically (dateFieldGroup with alignItems: flex-start)
check(src.includes('dateFieldGroup'), 'dateFieldGroup is used to wrap date input and picker button');
check(!/dateFieldGroup:\s*\{[^}]*flexDirection:\s*['"]row['"]/s.test(src), 'dateFieldGroup does not use flexDirection: "row"');

// 3. Assert all required testIDs exist
console.log('\n--- 2. Required testIDs intact ---');
check(src.includes('testID="shift-starts-picker-btn"'), 'shift-starts-picker-btn testID exists');
check(src.includes('testID="shift-ends-picker-btn"'), 'shift-ends-picker-btn testID exists');
check(src.includes('testID="shift-starts-input"'), 'shift-starts-input testID exists');
check(src.includes('testID="shift-ends-input"'), 'shift-ends-input testID exists');

// 4. Assert modal rendering intact
console.log('\n--- 3. DateTimePickerModal rendering ---');
check(src.includes('<DateTimePickerModal'), 'DateTimePickerModal is rendered in JSX');
check(src.includes('testID="shift-date-time-picker"'), 'shift-date-time-picker testID exists');

if (failures > 0) {
  console.error(`Shift form layout check failed with ${failures} error(s).`);
  process.exit(1);
} else {
  console.log('All shift form layout checks passed.');
  process.exit(0);
}

