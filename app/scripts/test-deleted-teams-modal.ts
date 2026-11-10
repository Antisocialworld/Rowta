// test-deleted-teams-modal.ts — verifies DeletedTeamsModal layout and TeamListScreen trigger (Task D1; rules U1, U7, X1, X3, X4, X6, X14).
// Verifies:
// 1. Pure close decision and trigger visibility helpers (shouldCloseDeletedTeamsModal, shouldShowDeletedTeamsTrigger).
// 2. DeletedTeamsModal.tsx implementation: uses SheetModal, wires Close button in footer outside ScrollView, accessibility pieces.
// 3. TeamListScreen.tsx removes inline deleted section and wires deleted-teams-trigger and DeletedTeamsModal.
// NOTE: Written per standing rules; do not run unless explicitly authorized by the owner.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  shouldCloseDeletedTeamsModal,
  shouldShowDeletedTeamsTrigger,
} from '../src/lib/deleted-teams-logic';

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}

// ---------------------------------------------------------------------------------------------
// 1. Pure logic: close-decision and trigger visibility
// ---------------------------------------------------------------------------------------------
console.log('--- 1. Pure logic: shouldCloseDeletedTeamsModal ---');
check(shouldCloseDeletedTeamsModal(0) === true, 'closes when remaining count is 0');
check(shouldCloseDeletedTeamsModal(-1) === true, 'closes when remaining count is negative');
check(shouldCloseDeletedTeamsModal(1) === false, 'stays open when 1 team remains');
check(shouldCloseDeletedTeamsModal(4) === false, 'stays open when multiple teams remain');

console.log('\n--- 2. Pure logic: shouldShowDeletedTeamsTrigger ---');
check(shouldShowDeletedTeamsTrigger(undefined) === false, 'undefined hides trigger');
check(shouldShowDeletedTeamsTrigger(null) === false, 'null hides trigger');
check(shouldShowDeletedTeamsTrigger([]) === false, 'empty list hides trigger');
check(shouldShowDeletedTeamsTrigger([{ id: 't-1' }]) === true, 'non-empty list shows trigger');

// ---------------------------------------------------------------------------------------------
// 2. Text-scan: DeletedTeamsModal layout and accessibility
// ---------------------------------------------------------------------------------------------
console.log('\n--- 3. DeletedTeamsModal layout & accessibility scan ---');
const MODAL_PATH = resolve(__dirname, '../src/screens/teams/DeletedTeamsModal.tsx');
const SHEET_PATH = resolve(__dirname, '../src/components/SheetModal.tsx');
check(existsSync(MODAL_PATH), 'DeletedTeamsModal.tsx exists');
check(existsSync(SHEET_PATH), 'SheetModal.tsx exists');

const modalSrc = existsSync(MODAL_PATH) ? readFileSync(MODAL_PATH, 'utf8') : '';
const sheetSrc = existsSync(SHEET_PATH) ? readFileSync(SHEET_PATH, 'utf8') : '';

check(modalSrc.includes('<SheetModal'), 'DeletedTeamsModal mounts SheetModal');
check(modalSrc.includes('headingKey="teams.deleted.heading"'), 'DeletedTeamsModal sets headingKey');
check(modalSrc.includes('returnFocusRef={returnFocusRef}'), 'DeletedTeamsModal wires returnFocusRef');
check(modalSrc.includes('testID={`${testID}-close`}'), 'Close button has testID');
check(modalSrc.includes('footer='), 'Close button is passed via footer prop outside scroll area');

check(sheetSrc.includes('accessibilityViewIsModal'), 'SheetModal card sets accessibilityViewIsModal');
check(sheetSrc.includes('onRequestClose'), 'SheetModal wires onRequestClose');
check(sheetSrc.includes("e.key === 'Escape'"), 'SheetModal handles Escape key for web keyboard accessibility');
check(sheetSrc.includes("maxHeight: '85%'"), 'SheetModal card is capped at maxHeight: 85%');
check(sheetSrc.includes('ScrollView'), 'SheetModal uses ScrollView');
check(sheetSrc.includes('flexShrink: 1'), 'SheetModal ScrollView sets flexShrink: 1');

// ---------------------------------------------------------------------------------------------
// 3. Text-scan: TeamListScreen inline section removed & trigger wired
// ---------------------------------------------------------------------------------------------
console.log('\n--- 4. TeamListScreen trigger button scan ---');
const SCREEN_PATH = resolve(__dirname, '../src/screens/teams/TeamListScreen.tsx');
check(existsSync(SCREEN_PATH), 'TeamListScreen.tsx exists');

const screenSrc = existsSync(SCREEN_PATH) ? readFileSync(SCREEN_PATH, 'utf8') : '';

check(!screenSrc.includes('styles.deletedSection'), 'inline deletedSection style is removed');
check(screenSrc.includes('testID="deleted-teams-trigger"'), 'deleted-teams-trigger button exists');
check(screenSrc.includes('<DeletedTeamsModal'), 'DeletedTeamsModal is rendered');
check(screenSrc.includes('testID="deleted-teams-modal"'), 'deleted-teams-modal testID exists');
check(screenSrc.includes('returnFocusRef={deletedTriggerRef}'), 'TeamListScreen wires returnFocusRef to trigger');

if (failures > 0) {
  console.error(`Deleted teams modal check failed with ${failures} error(s).`);
  process.exit(1);
} else {
  console.log('All deleted teams modal checks passed.');
  process.exit(0);
}
