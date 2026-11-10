// Teams store + view-machine proof (Phase 3, rules V1, S5, U1, U2; PRD 6.1, 8.2; no device): the
// PURE helpers and the PURE reducer, plus the idempotency-key discipline the create-team form
// depends on (ADR 0012). Run from the repo root:
//   npm exec --workspace @rowta/app -- tsx scripts/test-teams-store.ts
import { inviteRoleOptions, resolveSelectedTeamId, shouldShowDashboard, useTeams } from '../src/state/teams';
import { TEAMS_VIEWS, initialTeamsState, teamsReducer } from '../src/state/teams-view';

let failures = 0;
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

// ---------------------------------------------------------------------------------------------
// Switcher fallback (B1): preferred while still in the list, else the first team, else null
// ---------------------------------------------------------------------------------------------
const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
check(resolveSelectedTeamId(list, 'b') === 'b', 'switcher: keeps the preferred team while it is in the list');
check(resolveSelectedTeamId(list, 'zz') === 'a', 'switcher: falls back to the FIRST team when the preferred one is gone');
check(resolveSelectedTeamId(list, null) === 'a', 'switcher: picks the first team when nothing is preferred');
check(resolveSelectedTeamId([], 'a') === null, 'switcher: null when the list is empty (never invents a team)');
check(resolveSelectedTeamId([], null) === null, 'switcher: null when the list is empty and nothing is preferred');

// ---------------------------------------------------------------------------------------------
// Dashboard visibility helper (Task A, PRD §12, rule U2; Owner decision: always land on Dashboard)
// ---------------------------------------------------------------------------------------------
check(shouldShowDashboard('team-1', false) === true, 'dashboard: shows dashboard when not picking');
check(shouldShowDashboard('team-1', true) === false, 'dashboard: shows team list when user is picking a team');
check(shouldShowDashboard(null, false) === true, 'dashboard: shows dashboard even when no team selected (zero teams)');
check(shouldShowDashboard(null, true) === false, 'dashboard: shows team list when user is picking a team');

// ---------------------------------------------------------------------------------------------
// setSelectedTeamId action (Change 1): sets selectedTeamId only, preserving pickingTeam state
// ---------------------------------------------------------------------------------------------
useTeams.setState({ selectedTeamId: 'team-a', pickingTeam: true });
useTeams.getState().setSelectedTeamId('team-b');
check(useTeams.getState().selectedTeamId === 'team-b', 'setSelectedTeamId: updates selectedTeamId');
check(useTeams.getState().pickingTeam === true, 'setSelectedTeamId: preserves pickingTeam = true');

useTeams.getState().selectTeam('team-c');
check(useTeams.getState().selectedTeamId === 'team-c', 'selectTeam: updates selectedTeamId');
check(useTeams.getState().pickingTeam === false, 'selectTeam: resets pickingTeam to false');

// ---------------------------------------------------------------------------------------------
// Invite role visibility (B1, PRD 8.2): Owner invites Manager + Staff; Manager invites Staff ONLY;
// the Owner role is NEVER assignable through an invite.
// ---------------------------------------------------------------------------------------------
const ownerOptions = inviteRoleOptions('owner');
check(ownerOptions.includes('manager') && ownerOptions.includes('staff'), 'roles: Owner may invite Manager and Staff');
check(!ownerOptions.includes('owner'), 'roles: Owner is never invitable');
const managerOptions = inviteRoleOptions('manager');
check(managerOptions.length === 1 && managerOptions[0] === 'staff', 'roles: Manager sees Staff ONLY');
check(!managerOptions.includes('owner') && !managerOptions.includes('manager'), 'roles: Manager cannot invite Manager or Owner');
const staffOptions = inviteRoleOptions('staff');
check(staffOptions.length === 1 && staffOptions[0] === 'staff', 'roles: a Staff viewer (server edge) is limited to Staff');

// ---------------------------------------------------------------------------------------------
// Idempotency-Key discipline (B1, ADR 0012): ONE key per submit ATTEMPT — reused on retry of the
// same attempt, new when the previous attempt finished or the body changed.
// ---------------------------------------------------------------------------------------------
useTeams.getState().clearCreateKey();
const key1 = useTeams.getState().ensureCreateKey();
check(key1.length > 0, 'idempotency: the first submit generates a key');
const key1again = useTeams.getState().ensureCreateKey();
check(key1again === key1, 'idempotency: a RETRY of the same attempt REUSES the key');
useTeams.getState().clearCreateKey(); // runs on success AND whenever the name field changes
const key2 = useTeams.getState().ensureCreateKey();
check(key2 !== key1, 'idempotency: a NEW attempt (after success or an edit) gets a NEW key');

// ---------------------------------------------------------------------------------------------
// Teams view machine (U1, U2): go pushes, back pops, back at the list REFUSES (the OS exits)
// ---------------------------------------------------------------------------------------------
check(TEAMS_VIEWS.list.focus === 'heading', 'view: the list focuses its heading (U7)');
check(TEAMS_VIEWS.members.focus === 'heading', 'view: members focuses its heading (U7)');
check(TEAMS_VIEWS.teamSettings.focus === 'heading', 'view: teamSettings focuses its heading (U7)');

let state = teamsReducer(initialTeamsState, { type: 'go', view: 'members' });
check(state.view === 'members' && state.stack.length === 1 && state.stack[0] === 'list', 'view: go(members) keeps the list in history');
state = teamsReducer(state, { type: 'back' });
check(state.view === 'list' && state.stack.length === 0, 'view: back() from members returns to the list');
const refused = teamsReducer(state, { type: 'back' });
check(refused === state, 'view: back() at the list REFUSES (Android exits the app, U1)');

// Team settings roundtrip: list -> teamSettings -> list
let settingsNav = teamsReducer(initialTeamsState, { type: 'go', view: 'teamSettings' });
check(settingsNav.view === 'teamSettings' && settingsNav.stack.length === 1 && settingsNav.stack[0] === 'list', 'view: go(teamSettings) keeps list in history');
settingsNav = teamsReducer(settingsNav, { type: 'back' });
check(settingsNav.view === 'list' && settingsNav.stack.length === 0, 'view: back() from teamSettings returns to list');

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
