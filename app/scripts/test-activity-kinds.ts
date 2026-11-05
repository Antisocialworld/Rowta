// test-activity-kinds.ts — verifies every activity kind maps to the correct verb key and tone.
// Pure logic: activityKindInfo from ActivityRow.tsx, no React, no server, no database.
// Run from the repo root:  node app/scripts/test-activity-kinds.ts
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}

// ---------------------------------------------------------------------------------------------
// 1. Text-scan: ActivityRow.tsx exports activityKindInfo and maps all known kinds
// ---------------------------------------------------------------------------------------------
const MODAL_PATH = resolve(__dirname, '../src/screens/shifts/ActivityRow.tsx');
const src = readFileSync(MODAL_PATH, 'utf8');
check(src.includes('export function activityKindInfo'), 'ActivityRow exports activityKindInfo');

const expected = [
  ['swap.requested', 'activity.kind.swapRequested', 'warning'],
  ['swap.approved', 'activity.kind.swapApproved', 'success'],
  ['swap.rejected', 'activity.kind.swapRejected', 'error'],
  ['swap.cancelled', 'activity.kind.swapCancelled', 'error'],
  ['team.deleted', 'activity.kind.teamDeleted', 'error'],
  ['team.transferred', 'activity.kind.teamTransferred', 'primary'],
  ['team.restored', 'activity.kind.teamRestored', 'success'],
  ['shift.created', 'activity.kind.created', 'success'],
  ['shift.updated', 'activity.kind.updated', 'primary'],
  ['shift.deleted', 'activity.kind.deleted', 'error'],
];

for (const [kind, verbKey, tone] of expected) {
  check(
    src.includes(`'${kind}': { verbKey: '${verbKey}', tone: '${tone}' }`),
    `ActivityRow maps ${kind} -> ${verbKey} / ${tone}`,
  );
}

// Unknown kind falls back to 'changed a shift' / 'other'
check(
  src.includes("return { verbKey: 'activity.kind.other', tone: 'other' };"),
  'activityKindInfo falls back to activity.kind.other for unknown kinds',
);

console.log(`\n${failures === 0 ? 'All activity-kind checks passed.' : `${failures} activity-kind check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
