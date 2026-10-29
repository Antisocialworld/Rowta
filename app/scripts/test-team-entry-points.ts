// TEAM ENTRY POINTS PURE LOGIC TEST (rules U1, U2; Phase 4 & 5).
// Verifies that:
// 1. Owner, Manager and Staff each get Shifts, Activity, Search and Swaps.
// 2. Only Owner and Manager can create shifts.
// 3. Null or unknown role gets none.
// Run from repo root:
//   npm exec --workspace @rowta/app -- tsx scripts/test-team-entry-points.ts
import {
  teamEntryPoints,
  canCreateShift,
  ENTRY_POINT_SHIFTS,
  ENTRY_POINT_ACTIVITY,
  ENTRY_POINT_SEARCH,
  ENTRY_POINT_SWAPS,
} from '../src/lib/team-entry-points';

let failures = 0;
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

// 1. Owner role checks
const ownerPoints = teamEntryPoints('owner');
check(ownerPoints.length === 4, 'owner has 4 entry points');
check(ownerPoints.some((p) => p.id === 'shifts' && p.route.name === 'calendar'), 'owner gets Shifts (calendar)');
check(ownerPoints.some((p) => p.id === 'activity' && p.route.name === 'activity'), 'owner gets Activity');
check(ownerPoints.some((p) => p.id === 'search' && p.route.name === 'search'), 'owner gets Search');
check(ownerPoints.some((p) => p.id === 'swaps' && p.route.name === 'swaps'), 'owner gets Swaps');
check(ownerPoints.canCreateShift === true, 'owner can create shifts (on list)');
check(canCreateShift('owner') === true, 'owner can create shifts (helper)');

// 2. Manager role checks
const managerPoints = teamEntryPoints('manager');
check(managerPoints.length === 4, 'manager has 4 entry points');
check(managerPoints.some((p) => p.id === 'shifts' && p.route.name === 'calendar'), 'manager gets Shifts (calendar)');
check(managerPoints.some((p) => p.id === 'activity' && p.route.name === 'activity'), 'manager gets Activity');
check(managerPoints.some((p) => p.id === 'search' && p.route.name === 'search'), 'manager gets Search');
check(managerPoints.some((p) => p.id === 'swaps' && p.route.name === 'swaps'), 'manager gets Swaps');
check(managerPoints.canCreateShift === true, 'manager can create shifts (on list)');
check(canCreateShift('manager') === true, 'manager can create shifts (helper)');

// 3. Staff role checks
const staffPoints = teamEntryPoints('staff');
check(staffPoints.length === 4, 'staff has 4 entry points');
check(staffPoints.some((p) => p.id === 'shifts' && p.route.name === 'calendar'), 'staff gets Shifts (calendar)');
check(staffPoints.some((p) => p.id === 'activity' && p.route.name === 'activity'), 'staff gets Activity');
check(staffPoints.some((p) => p.id === 'search' && p.route.name === 'search'), 'staff gets Search');
check(staffPoints.some((p) => p.id === 'swaps' && p.route.name === 'swaps'), 'staff gets Swaps');
check(staffPoints.canCreateShift === false, 'staff CANNOT create shifts (on list)');
check(canCreateShift('staff') === false, 'staff CANNOT create shifts (helper)');

// 4. Null, undefined, unknown role checks
const nullPoints = teamEntryPoints(null);
check(nullPoints.length === 0, 'null role gets 0 entry points');
check(nullPoints.canCreateShift === false, 'null role cannot create shifts');
check(canCreateShift(null) === false, 'canCreateShift(null) is false');

const undefinedPoints = teamEntryPoints(undefined);
check(undefinedPoints.length === 0, 'undefined role gets 0 entry points');
check(undefinedPoints.canCreateShift === false, 'undefined role cannot create shifts');
check(canCreateShift(undefined) === false, 'canCreateShift(undefined) is false');

const unknownPoints = teamEntryPoints('guest');
check(unknownPoints.length === 0, 'unknown role gets 0 entry points');
check(unknownPoints.canCreateShift === false, 'unknown role cannot create shifts');
check(canCreateShift('guest') === false, 'canCreateShift("guest") is false');

// 5. TestIDs and route shapes match shift-nav.ts
check(ENTRY_POINT_SHIFTS.testID === 'team-open-shifts', 'shifts testID is team-open-shifts');
check(ENTRY_POINT_ACTIVITY.testID === 'team-open-activity', 'activity testID is team-open-activity');
check(ENTRY_POINT_SEARCH.testID === 'team-open-search', 'search testID is team-open-search');
check(ENTRY_POINT_SWAPS.testID === 'team-open-swaps', 'swaps testID is team-open-swaps');

process.exit(failures === 0 ? 0 : 1);

