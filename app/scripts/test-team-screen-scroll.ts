// test-team-screen-scroll.ts — verifies that all five teams screens use the shared scroll wrapper (Task B; rules U1, U3, U7, X6, X7).
// Verifies:
// 1. TeamScreenLayout.tsx exists and implements ScrollView with flexGrow: 1, keyboardShouldPersistTaps="handled",
//    generous bottom padding (spacing.veryLarge), and maxWidth CONTENT_MAX_WIDTH.
// 2. All five teams screens (TeamListScreen, MembersScreen, TeamSettingsScreen, InviteScreen, CreateTeamScreen)
//    import and use TeamScreenLayout instead of non-scrollable Views.
// NOTE: Written per standing rules; do not run unless explicitly authorized by the owner.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}

const TEAMS_DIR = resolve(__dirname, '../src/screens/teams');
const SHARED_WRAPPER = resolve(TEAMS_DIR, 'TeamScreenLayout.tsx');

console.log('--- 1. Shared scroll wrapper implementation ---');
check(existsSync(SHARED_WRAPPER), 'TeamScreenLayout.tsx exists in app/src/screens/teams/');

const wrapperSrc = existsSync(SHARED_WRAPPER) ? readFileSync(SHARED_WRAPPER, 'utf8') : '';
check(wrapperSrc.includes('ScrollView'), 'TeamScreenLayout uses ScrollView');
check(wrapperSrc.includes('keyboardShouldPersistTaps="handled"'), 'TeamScreenLayout handles keyboard taps');
check(wrapperSrc.includes('flexGrow: 1'), 'TeamScreenLayout sets flexGrow: 1 on scroll content');
check(wrapperSrc.includes('spacing.veryLarge'), 'TeamScreenLayout provides generous bottom padding (spacing.veryLarge)');
check(wrapperSrc.includes('CONTENT_MAX_WIDTH'), 'TeamScreenLayout enforces CONTENT_MAX_WIDTH column cap');

console.log('\n--- 2. Five teams screens scroll wrapper compliance ---');
const screens = [
  { file: 'TeamListScreen.tsx', testID: 'team-list-screen' },
  { file: 'MembersScreen.tsx', testID: 'team-members-screen' },
  { file: 'TeamSettingsScreen.tsx', testID: 'team-settings-screen' },
  { file: 'InviteScreen.tsx', testID: 'team-invite-screen' },
  { file: 'CreateTeamScreen.tsx', testID: 'team-create-screen' },
];

for (const { file, testID } of screens) {
  const filePath = resolve(TEAMS_DIR, file);
  check(existsSync(filePath), `${file} exists`);
  const src = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';

  check(
    src.includes("import { TeamScreenLayout } from './TeamScreenLayout';"),
    `${file} imports TeamScreenLayout`,
  );
  check(
    src.includes('<TeamScreenLayout') && src.includes('</TeamScreenLayout>'),
    `${file} wraps screen contents with <TeamScreenLayout>`,
  );
  check(
    src.includes(`testID="${testID}"`),
    `${file} preserves screen testID "${testID}"`,
  );
  check(
    !src.includes('<SafeAreaView'),
    `${file} does not use bare non-scrollable <SafeAreaView>`,
  );
}

if (failures > 0) {
  console.error(`\nFailed with ${failures} assertion failures.`);
  process.exit(1);
} else {
  console.log('\nAll five teams screens use TeamScreenLayout and meet scrolling requirements.');
}

