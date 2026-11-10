// test-sheet-modal.ts — verifies SheetModal layout math, state derivation, and accessibility contract (Stage S1; rules U1, U7, X1, X3, X4, X6, X14; ADR 0018, ADR 0021).
// Pure logic and layout calculations imported; components text-scanned to avoid Flow parser crash.
// NOTE: Written per standing rules; do not run unless explicitly authorized by the owner.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SHEET_CENTERING_PADDING,
  SHEET_DIALOG_PADDING,
  SHEET_MAX_HEIGHT_PERCENT,
  computeSheetInnerWidth,
} from '../src/lib/sheet-layout';
import { deletedTeamsViewState } from '../src/lib/deleted-teams-logic';

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}

// ---------------------------------------------------------------------------------------------
// 1. Pure layout math: viewport budgeting for 360x800 and 320x568
// ---------------------------------------------------------------------------------------------
console.log('--- 1. Pure layout: SheetModal width & height budget ---');
// Constants
check(SHEET_CENTERING_PADDING === 8, 'SHEET_CENTERING_PADDING is 8px (spacing.small)');
check(SHEET_DIALOG_PADDING === 16, 'SHEET_DIALOG_PADDING is 16px (spacing.base)');
check(SHEET_MAX_HEIGHT_PERCENT === 85, 'SHEET_MAX_HEIGHT_PERCENT is 85%');

// 360x800 phone budget:
// Inner width = 360 - 2 * 8 - 2 * 16 = 360 - 16 - 32 = 312px
const width360 = computeSheetInnerWidth(360);
check(width360 === 312, `computeSheetInnerWidth(360) is 312px (got ${width360})`);

// 320x568 phone budget:
// Inner width = 320 - 2 * 8 - 2 * 16 = 320 - 16 - 32 = 272px
const width320 = computeSheetInnerWidth(320);
check(width320 === 272, `computeSheetInnerWidth(320) is 272px (got ${width320})`);

// Height budget calculations:
// 800 * 0.85 = 680px max height
// 568 * 0.85 = 482.8px max height
const maxH800 = (800 * SHEET_MAX_HEIGHT_PERCENT) / 100;
const maxH568 = (568 * SHEET_MAX_HEIGHT_PERCENT) / 100;
check(maxH800 === 680, `max height at 800px viewport is 680px (got ${maxH800})`);
check(maxH568 === 482.8, `max height at 568px viewport is 482.8px (got ${maxH568})`);

// ---------------------------------------------------------------------------------------------
// 2. Pure logic: deletedTeamsViewState (poll error preservation)
// ---------------------------------------------------------------------------------------------
console.log('\n--- 2. Pure logic: deletedTeamsViewState ---');
check(
  deletedTeamsViewState({ count: 2, isLoading: false, isError: false }) === 'list',
  'returns list when count > 0',
);
check(
  deletedTeamsViewState({ count: 2, isLoading: true, isError: false }) === 'list',
  'returns list while refreshing/polling (isLoading) when items already present',
);
check(
  deletedTeamsViewState({ count: 2, isLoading: false, isError: true }) === 'list',
  'poll-error fix: returns list when isError is true but count > 0 (preserves visible data)',
);
check(
  deletedTeamsViewState({ count: 0, isLoading: false, isError: true }) === 'error',
  'returns error when count === 0 and isError is true',
);
check(
  deletedTeamsViewState({ count: 0, isLoading: true, isError: false }) === 'loading',
  'returns loading when count === 0 and isLoading is true',
);
check(
  deletedTeamsViewState({ count: 0, isLoading: false, isError: false }) === 'empty',
  'returns empty when count === 0, not loading and not error',
);

// ---------------------------------------------------------------------------------------------
// 3. Text-scan: SheetModal component contract
// ---------------------------------------------------------------------------------------------
console.log('\n--- 3. SheetModal component text-scan ---');
const SHEET_PATH = resolve(__dirname, '../src/components/SheetModal.tsx');
check(existsSync(SHEET_PATH), 'SheetModal.tsx exists');

const sheetSrc = existsSync(SHEET_PATH) ? readFileSync(SHEET_PATH, 'utf8') : '';

check(sheetSrc.includes('accessibilityViewIsModal'), 'modal card sets accessibilityViewIsModal');
check(sheetSrc.includes('onRequestClose={onClose}'), 'Modal wires onRequestClose');
check(sheetSrc.includes("Platform.OS !== 'web'"), 'guards web event listener');
check(sheetSrc.includes("e.key === 'Escape'"), 'handles Escape key dismissal on web');
check(sheetSrc.includes('focusOn(headingRef.current)'), 'focuses heading on open');
check(sheetSrc.includes('returnFocusRef?.current'), 'returns focus to trigger ref on close');
check(sheetSrc.includes("maxHeight: '85%'"), 'modal card caps height at 85%');
check(sheetSrc.includes('SHEET_CENTERING_PADDING'), 'scrim uses centering padding');
check(sheetSrc.includes('SHEET_DIALOG_PADDING'), 'card uses dialog padding');
check(sheetSrc.includes('ScrollView'), 'body content wrapped in ScrollView');
check(sheetSrc.includes('flexShrink: 1'), 'body ScrollView has flexShrink: 1');
check(sheetSrc.includes('{footer ? <View style={styles.footer}>{footer}</View> : null}'), 'footer is pinned outside ScrollView');
check(sheetSrc.includes("anchor === 'top'"), 'supports anchor top vs center');

// ---------------------------------------------------------------------------------------------
// 4. Text-scan: Button ref forwarding
// ---------------------------------------------------------------------------------------------
console.log('\n--- 4. Button ref forwarding text-scan ---');
const BUTTON_PATH = resolve(__dirname, '../src/components/Button.tsx');
check(existsSync(BUTTON_PATH), 'Button.tsx exists');
const buttonSrc = existsSync(BUTTON_PATH) ? readFileSync(BUTTON_PATH, 'utf8') : '';
check(buttonSrc.includes('ref?: Ref<unknown>;'), 'ButtonProps declares optional ref prop');
check(buttonSrc.includes('handleRef'), 'Button implements handleRef forwarding');

if (failures > 0) {
  console.error(`SheetModal checks failed with ${failures} error(s).`);
  process.exit(1);
} else {
  console.log('All SheetModal checks passed.');
  process.exit(0);
}

