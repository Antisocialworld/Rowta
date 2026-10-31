// test-team-settings-screen.ts — pure tests for Team Settings access, navigation, and separation of concerns (PRD 4, 6.1; rules U1, U2, U5, S5).
// Verifies:
// 1. Who sees the Team settings button (owner yes; manager and staff no; null/undefined no).
// 2. The navigation state machine: go('teamSettings') pushes list, back() returns to list.
// 3. Members screen keeps only people and no longer exposes delete or transfer.
// Run from repo root:
//   npm exec --workspace @rowta/app -- tsx scripts/test-team-settings-screen.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canManageTeamSettings } from '../src/lib/team-role';
import { TEAMS_VIEWS, initialTeamsState, teamsReducer } from '../src/state/teams-view';

let failures = 0;
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

// ---------------------------------------------------------------------------------------------
// 1. Who sees the Team settings button (owner yes; manager and staff no)
// ---------------------------------------------------------------------------------------------
console.log('--- 1. Visibility of Team settings button on Your teams ---');
check(canManageTeamSettings('owner') === true, 'owner sees Team settings button');
check(canManageTeamSettings('manager') === false, 'manager does NOT see Team settings button');
check(canManageTeamSettings('staff') === false, 'staff does NOT see Team settings button');
check(canManageTeamSettings(null) === false, 'null role does NOT see Team settings button');
check(canManageTeamSettings(undefined) === false, 'undefined role does NOT see Team settings button');
check(canManageTeamSettings('unknown') === false, 'unknown role does NOT see Team settings button');

// ---------------------------------------------------------------------------------------------
// 2. Navigation state machine for teamSettings
// ---------------------------------------------------------------------------------------------
console.log('\n--- 2. Navigation state machine for teamSettings ---');
check(TEAMS_VIEWS.teamSettings.title === 'teams.view.settings.title', 'TEAMS_VIEWS.teamSettings title matches catalog key');
check(TEAMS_VIEWS.teamSettings.heading === 'teams.view.settings.heading', 'TEAMS_VIEWS.teamSettings heading matches catalog key');
check(TEAMS_VIEWS.teamSettings.focus === 'heading', 'TEAMS_VIEWS.teamSettings autofocuses heading (U7)');

const openedSettings = teamsReducer(initialTeamsState, { type: 'go', view: 'teamSettings' });
check(openedSettings.view === 'teamSettings', 'go("teamSettings") sets view to teamSettings');
check(openedSettings.stack.length === 1 && openedSettings.stack[0] === 'list', 'go("teamSettings") pushes list onto stack');

const returnedFromSettings = teamsReducer(openedSettings, { type: 'back' });
check(returnedFromSettings.view === 'list', 'back() from teamSettings returns to list');
check(returnedFromSettings.stack.length === 0, 'stack is empty after returning to list');

// ---------------------------------------------------------------------------------------------
// 3. Members screen no longer exposes delete or transfer
// ---------------------------------------------------------------------------------------------
console.log('\n--- 3. Members screen no longer exposes delete or transfer ---');
const membersPath = resolve(__dirname, '../src/screens/teams/MembersScreen.tsx');
const membersSource = readFileSync(membersPath, 'utf8');

const settingsPath = resolve(__dirname, '../src/screens/teams/TeamSettingsScreen.tsx');
const settingsSource = readFileSync(settingsPath, 'utf8');

check(!membersSource.includes('TransferOwnershipModal'), 'MembersScreen does NOT import or render TransferOwnershipModal');
check(!membersSource.includes('DeleteTeamModal'), 'MembersScreen does NOT import or render DeleteTeamModal');
check(!membersSource.includes('handleTransfer'), 'MembersScreen does NOT contain handleTransfer');
check(!membersSource.includes('handleDelete'), 'MembersScreen does NOT contain handleDelete');
check(!membersSource.includes('members-transfer-ownership'), 'MembersScreen does NOT expose transfer ownership button');
check(!membersSource.includes('members-delete-team'), 'MembersScreen does NOT expose delete team button');

check(settingsSource.includes('TransferOwnershipModal'), 'TeamSettingsScreen renders TransferOwnershipModal');
check(settingsSource.includes('DeleteTeamModal'), 'TeamSettingsScreen renders DeleteTeamModal');
check(settingsSource.includes('handleTransfer'), 'TeamSettingsScreen contains handleTransfer');
check(settingsSource.includes('handleDelete'), 'TeamSettingsScreen contains handleDelete');
check(settingsSource.includes('settings-transfer-ownership'), 'TeamSettingsScreen exposes settings-transfer-ownership button');
check(settingsSource.includes('settings-delete-team'), 'TeamSettingsScreen exposes settings-delete-team button');
check(settingsSource.includes('settings-danger-section'), 'TeamSettingsScreen contains danger section');

// ---------------------------------------------------------------------------------------------
// 4. Unauthorized EmptyState copy for non-Admin viewers (FIX 1)
// ---------------------------------------------------------------------------------------------
console.log('\n--- 4. Unauthorized EmptyState copy for non-Admin viewers ---');
const enPath = resolve(__dirname, '../src/i18n/en.ts');
const enSource = readFileSync(enPath, 'utf8');

check(enSource.includes("'teams.settings.adminOnly': 'Only the Admin can open Team settings.'"), 'en.ts contains teams.settings.adminOnly key with exact copy');
check(settingsSource.includes('bodyKey="teams.settings.adminOnly"'), 'TeamSettingsScreen uses bodyKey="teams.settings.adminOnly" for non-Admin EmptyState');
check(!settingsSource.includes('bodyKey="teams.deletedOrRemoved"'), 'TeamSettingsScreen does NOT use teams.deletedOrRemoved for non-Admin EmptyState');

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

