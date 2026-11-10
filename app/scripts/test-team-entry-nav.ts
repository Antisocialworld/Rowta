// TEAM ENTRY NAVIGATION PURE LOGIC TEST (rules U1, U2; Phase 4 & 5).
// Verifies that opening each of the four team entry points (calendar, activity, search, swaps)
// from the team root (route: null) correctly sets the route, and that calling back() returns to
// the team root (route: null), with subsequent back() refusing (returning false) so the OS exits.
// Run from repo root:
//   npm exec --workspace @rowta/app -- tsx scripts/test-team-entry-nav.ts
import { useShiftNav, type ShiftRoute } from '../src/state/shift-nav';

let failures = 0;
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

const ROUTES: readonly ShiftRoute[] = [
  { name: 'calendar' },
  { name: 'activity' },
  { name: 'swaps' },
];

for (const targetRoute of ROUTES) {
  // 1. Reset to initial team view (null route)
  useShiftNav.getState().reset();
  check(useShiftNav.getState().route === null, `[${targetRoute.name}] store starts at null (team view)`);
  check(useShiftNav.getState().stack.length === 0, `[${targetRoute.name}] stack starts empty`);

  // 2. Open route
  useShiftNav.getState().open(targetRoute);
  check(
    useShiftNav.getState().route?.name === targetRoute.name,
    `[${targetRoute.name}] open sets route to ${targetRoute.name}`,
  );
  check(useShiftNav.getState().stack.length === 0, `[${targetRoute.name}] stack remains empty on first open`);

  // 3. Back returns to team view (route: null)
  const moved = useShiftNav.getState().back();
  check(moved === true, `[${targetRoute.name}] back() returns true (popped successfully)`);
  check(useShiftNav.getState().route === null, `[${targetRoute.name}] route is now null (returned to team view)`);
  check(useShiftNav.getState().stack.length === 0, `[${targetRoute.name}] stack is empty`);

  // 4. Back at root refuses (returns false so Android can exit)
  const refused = useShiftNav.getState().back();
  check(refused === false, `[${targetRoute.name}] back() at root returns false (refuses exit)`);
  check(useShiftNav.getState().route === null, `[${targetRoute.name}] route remains null`);
}

process.exit(failures === 0 ? 0 : 1);

