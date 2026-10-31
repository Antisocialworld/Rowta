// test-create-team-modal.ts — verifies CreateTeamModal implementation, schema validation, idempotency discipline, and trigger wiring (Stage M2; rules V1, V5, U1, U5, U7, U8, X3, X14; ADR 0012, ADR 0018, ADR 0021).
// Pure logic and schemas imported; component files text-scanned to avoid Flow parser crash.
// NOTE: Written per standing rules; do not run unless explicitly authorized by the owner.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTeamSchema } from '@rowta/shared';
import { useTeams } from '../src/state/teams';
import { TEAMS_VIEWS } from '../src/state/teams-view';

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}

// ---------------------------------------------------------------------------------------------
// 1. Pure validation: createTeamSchema (rules V1, V3, V8)
// ---------------------------------------------------------------------------------------------
console.log('--- 1. Pure validation: createTeamSchema ---');
const valid = createTeamSchema.safeParse({ name: 'Alpha Squad' });
check(valid.success === true, 'accepts valid team name');
if (valid.success) {
  check(valid.data.name === 'Alpha Squad', 'preserves trimmed valid name');
}

const empty = createTeamSchema.safeParse({ name: '   ' });
check(empty.success === false, 'rejects empty/whitespace team name');

const tooLong = createTeamSchema.safeParse({ name: 'A'.repeat(81) });
check(tooLong.success === false, 'rejects team name longer than 80 chars');

// ---------------------------------------------------------------------------------------------
// 2. Pure state: Idempotency key discipline (ADR 0012)
// ---------------------------------------------------------------------------------------------
console.log('\n--- 2. Idempotency key discipline ---');
useTeams.getState().clearCreateKey();
const key1 = useTeams.getState().ensureCreateKey();
check(typeof key1 === 'string' && key1.length > 0, 'ensureCreateKey produces a non-empty key');
const key1Retry = useTeams.getState().ensureCreateKey();
check(key1Retry === key1, 'retry of the same attempt reuses key');
useTeams.getState().clearCreateKey();
const key2 = useTeams.getState().ensureCreateKey();
check(key2 !== key1, 'new attempt produces a fresh key after clearCreateKey');

// ---------------------------------------------------------------------------------------------
// 3. View machine hygiene: createTeam removed from TeamsView
// ---------------------------------------------------------------------------------------------
console.log('\n--- 3. Teams view machine hygiene ---');
check(!('createTeam' in TEAMS_VIEWS), 'createTeam is removed from TEAMS_VIEWS machine');

// ---------------------------------------------------------------------------------------------
// 4. Text-scan: CreateTeamModal.tsx
// ---------------------------------------------------------------------------------------------
console.log('\n--- 4. CreateTeamModal text-scan ---');
const MODAL_PATH = resolve(__dirname, '../src/screens/teams/CreateTeamModal.tsx');
check(existsSync(MODAL_PATH), 'CreateTeamModal.tsx exists');

const modalSrc = existsSync(MODAL_PATH) ? readFileSync(MODAL_PATH, 'utf8') : '';

check(modalSrc.includes('<SheetModal'), 'CreateTeamModal mounts SheetModal');
check(modalSrc.includes('headingKey="teams.view.create.heading"'), 'sets headingKey to teams.view.create.heading');
check(modalSrc.includes('returnFocusRef={returnFocusRef}'), 'wires returnFocusRef');
check(modalSrc.includes('focusOn(nameRef.current)'), 'auto-focuses team name input on open (U7)');
check(modalSrc.includes('testID="create-team-name"'), 'name input sets testID="create-team-name"');
check(modalSrc.includes('testID="create-team-submit"'), 'submit button sets testID="create-team-submit"');
check(modalSrc.includes('testID="create-team-cancel"'), 'cancel button sets testID="create-team-cancel"');
check(modalSrc.includes('maxLength={80}'), 'name input enforces maxLength={80}');
check(modalSrc.includes('ensureCreateKey()'), 'wires ensureCreateKey for submit');
check(modalSrc.includes('clearCreateKey()'), 'wires clearCreateKey on text change and success');
check(modalSrc.includes("invalidateQueries({ queryKey: ['teams', 'list'] })"), "invalidates ['teams', 'list']");
check(modalSrc.includes("refetchQueries({ queryKey: ['teams', 'list'] })"), "refetches ['teams', 'list']");

// ---------------------------------------------------------------------------------------------
// 5. Text-scan: TeamListScreen.tsx wiring
// ---------------------------------------------------------------------------------------------
console.log('\n--- 5. TeamListScreen trigger and modal mount scan ---');
const SCREEN_PATH = resolve(__dirname, '../src/screens/teams/TeamListScreen.tsx');
check(existsSync(SCREEN_PATH), 'TeamListScreen.tsx exists');

const screenSrc = existsSync(SCREEN_PATH) ? readFileSync(SCREEN_PATH, 'utf8') : '';

check(screenSrc.includes('ref={createTriggerRef}'), 'createTriggerRef attached to create button');
check(screenSrc.includes('testID="team-create-entry"'), 'team-create-entry button preserved');
check(screenSrc.includes('setCreateModalOpen(true)'), 'trigger opens CreateTeamModal');
check(screenSrc.includes('<CreateTeamModal'), 'TeamListScreen mounts CreateTeamModal');
check(screenSrc.includes('returnFocusRef={createTriggerRef}'), 'passes returnFocusRef={createTriggerRef} to CreateTeamModal');

if (failures > 0) {
  console.error(`Create team modal checks failed with ${failures} error(s).`);
  process.exit(1);
} else {
  console.log('All create team modal checks passed.');
  process.exit(0);
}

