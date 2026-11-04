// test-search-modal.ts — verifies SearchModal implementation, top-anchor layout, state store, and trigger integration (Stage M4a; rules U1, U7, X14; PRD 6.1, 8.4; ADR 0018, ADR 0021).
// Pure logic, state stores, and schemas imported; component files text-scanned to avoid Flow parser crash.
// NOTE: Written per standing rules; do not run unless explicitly authorized by the owner.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { SEARCH_QUERY_MIN_LENGTH, searchResultsSchema } from '@rowta/shared';
import { useSearchModal } from '../src/state/search-modal';
import { initialShiftNavState, shiftNavReducer } from '../src/state/shift-nav';

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}

// ---------------------------------------------------------------------------------------------
// 1. Pure validation: search schema and minimum length
// ---------------------------------------------------------------------------------------------
console.log('--- 1. Pure validation: search schema ---');
check(SEARCH_QUERY_MIN_LENGTH === 2, 'SEARCH_QUERY_MIN_LENGTH is 2 characters');

const validPayload = searchResultsSchema.safeParse({
  members: [{ userId: 'u-1', displayName: 'Sam', role: 'staff' }],
  shifts: [],
  activity: [],
});
check(validPayload.success === true, 'searchResultsSchema accepts valid search results payload');

// ---------------------------------------------------------------------------------------------
// 2. Pure state: useSearchModal store
// ---------------------------------------------------------------------------------------------
console.log('\n--- 2. Pure state: useSearchModal store ---');
useSearchModal.getState().close();
check(useSearchModal.getState().visible === false, 'initially closed');
check(useSearchModal.getState().returnFocusRef === null, 'initial returnFocusRef is null');

const triggerRef = { current: {} };
useSearchModal.getState().open(triggerRef);
check(useSearchModal.getState().visible === true, 'open() sets visible: true');
check(useSearchModal.getState().returnFocusRef === triggerRef, 'open() records returnFocusRef');

useSearchModal.getState().close();
check(useSearchModal.getState().visible === false, 'close() sets visible: false');
check(useSearchModal.getState().returnFocusRef === null, 'close() clears returnFocusRef');

// ---------------------------------------------------------------------------------------------
// 3. Shift navigation machine: search route removed
// ---------------------------------------------------------------------------------------------
console.log('\n--- 3. Shift navigation machine hygiene ---');
const calState = shiftNavReducer(initialShiftNavState, { type: 'open', route: { name: 'calendar' } });
check(calState.route?.name === 'calendar', 'calendar route opens cleanly');
const backState = shiftNavReducer(calState, { type: 'back' });
check(backState.route === null, 'back returns to null route');

// ---------------------------------------------------------------------------------------------
// 4. Text-scan: SearchModal.tsx
// ---------------------------------------------------------------------------------------------
console.log('\n--- 4. SearchModal text-scan ---');
const MODAL_PATH = resolve(__dirname, '../src/screens/shifts/SearchModal.tsx');
check(existsSync(MODAL_PATH), 'SearchModal.tsx exists');

const modalSrc = existsSync(MODAL_PATH) ? readFileSync(MODAL_PATH, 'utf8') : '';
check(modalSrc.includes('<SheetModal'), 'SearchModal mounts SheetModal');
check(modalSrc.includes('anchor="top"'), 'SearchModal specifies anchor="top"');
check(modalSrc.includes('headingKey="teams.view.search.heading"'), 'sets headingKey');
check(modalSrc.includes('testID="search-input"'), 'input sets testID="search-input"');
check(modalSrc.includes('clearTestID="search-clear"'), 'input wires clear control clearTestID="search-clear"');
check(modalSrc.includes('testID="search-close"'), 'close button sets testID="search-close"');
check(modalSrc.includes('focusOn(inputRef.current)'), 'auto-focuses search input on open (U7)');
check(modalSrc.includes("openShift({ name: 'detail'"), 'navigates to shift detail on item press');
check(modalSrc.includes('handleClose()'), 'closes modal upon item selection');

// ---------------------------------------------------------------------------------------------
// 5. Text-scan: TeamsRouter.tsx mounts SearchModal
// ---------------------------------------------------------------------------------------------
console.log('\n--- 5. TeamsRouter text-scan ---');
const ROUTER_PATH = resolve(__dirname, '../src/screens/TeamsRouter.tsx');
check(existsSync(ROUTER_PATH), 'TeamsRouter.tsx exists');
const routerSrc = existsSync(ROUTER_PATH) ? readFileSync(ROUTER_PATH, 'utf8') : '';
check(routerSrc.includes('<SearchModal />'), 'TeamsRouter mounts <SearchModal />');

// ---------------------------------------------------------------------------------------------
// 6. Text-scan: Trigger buttons wire openSearchModal
// ---------------------------------------------------------------------------------------------
console.log('\n--- 6. Trigger buttons text-scan ---');
const membersSrc = readFileSync(resolve(__dirname, '../src/screens/teams/MembersScreen.tsx'), 'utf8');
check(membersSrc.includes('openSearchModal(searchTriggerRef)'), 'MembersScreen wires openSearchModal with ref');
check(membersSrc.includes('testID="members-open-search"'), 'MembersScreen keeps testID="members-open-search"');

const calendarSrc = readFileSync(resolve(__dirname, '../src/screens/shifts/CalendarScreen.tsx'), 'utf8');
check(calendarSrc.includes('openSearchModal(searchTriggerRef)'), 'CalendarScreen wires openSearchModal with ref');

if (failures > 0) {
  console.error(`Search modal checks failed with ${failures} error(s).`);
  process.exit(1);
} else {
  console.log('All search modal checks passed.');
  process.exit(0);
}

