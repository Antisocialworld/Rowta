// test-live-updates.ts — verifies live polling intervals & cache invalidations (Task 1; PRD 4, 6.1; rules U1, U3, S5).
// Verifies:
// 1. Passive screens poll every 15s with refetchIntervalInBackground: false (Your teams, Members, Team settings).
// 2. Team creation invalidates and refetches ['teams', 'list'].
// 3. Invite acceptance invalidates and refetches ['teams', 'list'] at once without manual dismissal.
// NOTE: Write, do not run per standing rules.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}

console.log('--- 1. Static verification of 15s polling on passive screens ---');
const teamListPath = resolve(__dirname, '../src/screens/teams/TeamListScreen.tsx');
const teamListSrc = readFileSync(teamListPath, 'utf8');

const membersPath = resolve(__dirname, '../src/screens/teams/MembersScreen.tsx');
const membersSrc = readFileSync(membersPath, 'utf8');

const settingsPath = resolve(__dirname, '../src/screens/teams/TeamSettingsScreen.tsx');
const settingsSrc = readFileSync(settingsPath, 'utf8');

const createTeamPath = resolve(__dirname, '../src/screens/teams/CreateTeamScreen.tsx');
const createTeamSrc = readFileSync(createTeamPath, 'utf8');

check(
  teamListSrc.includes('useTeamsList({ refetchInterval: 15_000, refetchIntervalInBackground: false })'),
  'TeamListScreen configures useTeamsList with 15s interval and background pause',
);

check(
  membersSrc.includes('useTeam(selectedTeamId, { refetchInterval: 15_000, refetchIntervalInBackground: false })'),
  'MembersScreen configures useTeam with 15s interval and background pause',
);

check(
  settingsSrc.includes('useTeam(selectedTeamId, { refetchInterval: 15_000, refetchIntervalInBackground: false })'),
  'TeamSettingsScreen configures useTeam with 15s interval and background pause',
);

console.log('\n--- 2. Team creation cache invalidation ---');
check(
  createTeamSrc.includes("invalidateQueries({ queryKey: ['teams', 'list'] })"),
  "CreateTeamScreen invalidates ['teams', 'list'] query key",
);
check(
  createTeamSrc.includes("refetchQueries({ queryKey: ['teams', 'list'] })"),
  "CreateTeamScreen refetches ['teams', 'list'] query key immediately",
);

console.log('\n--- 3. Invite acceptance cache invalidation ---');
check(
  teamListSrc.includes("inviteResult?.kind === 'joined'"),
  "TeamListScreen observes inviteResult for 'joined' outcome",
);
check(
  teamListSrc.includes("invalidateQueries({ queryKey: ['teams', 'list'] })"),
  "TeamListScreen invalidates ['teams', 'list'] query key on invite accept",
);
check(
  teamListSrc.includes("refetchQueries({ queryKey: ['teams', 'list'] })"),
  "TeamListScreen refetches ['teams', 'list'] query key on invite accept",
);

console.log(failures === 0 ? '\nALL LIVE UPDATE CHECKS PASSED' : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);

