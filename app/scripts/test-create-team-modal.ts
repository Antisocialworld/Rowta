// test-create-team-modal.ts — verifies CreateTeamModal implementation, schema validation, idempotency discipline, and trigger wiring (Stage M2; rules V1, V5, U1, U5, U7, U8, X3, X14; ADR 0012, ADR 0018, ADR 0021).
// Pure logic and schemas imported; component files text-scanned to avoid Flow parser crash.
// NOTE: Written per standing rules; do not run unless explicitly authorized by the owner.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTeamSchema } from '@rowta/shared';
import { ApiError } from '../src/lib/api';
import {
  CreateTeamIdempotencySession,
  canReuseCreateKey,
  classifyCreateTeamOutcome,
  isDefinitive4xxError,
  isIndeterminateError,
  shouldClearOnModalClose,
  shouldClearOnNameChange,
  shouldClearOnOutcome,
} from '../src/lib/create-team-idempotency';
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
// 2. Pure helper: Idempotency-Key discipline (ADR 0012, B1)
// ---------------------------------------------------------------------------------------------
console.log('\n--- 2. Pure helper: Idempotency-Key discipline (success, 4xx, network, timeout, same/changed name) ---');

// Helper classification checks
check(classifyCreateTeamOutcome('success') === 'success', "classifyCreateTeamOutcome('success') === 'success'");
check(classifyCreateTeamOutcome(new ApiError(422, 'validation.failed', '')) === '4xx', "classifyCreateTeamOutcome(422) === '4xx'");
check(classifyCreateTeamOutcome(new ApiError(0, 'client.network', '')) === 'network_error', "classifyCreateTeamOutcome(network) === 'network_error'");
check(classifyCreateTeamOutcome(new ApiError(0, 'client.timeout', '')) === 'timeout', "classifyCreateTeamOutcome(timeout) === 'timeout'");
check(classifyCreateTeamOutcome(new ApiError(500, 'server.internal', '')) === '5xx', "classifyCreateTeamOutcome(500) === '5xx'");

check(isIndeterminateError(new ApiError(0, 'client.network', '')), 'classifies status 0 client.network as indeterminate');
check(isIndeterminateError(new ApiError(0, 'client.timeout', '')), 'classifies status 0 client.timeout as indeterminate');
check(isIndeterminateError(new ApiError(408, 'request.timeout', '')), 'classifies 408 as indeterminate');
check(isIndeterminateError(new ApiError(500, 'server.internal', '')), 'classifies 500 as indeterminate');
check(isIndeterminateError(new ApiError(503, 'service.unavailable', '')), 'classifies 503 as indeterminate');
check(!isIndeterminateError(new ApiError(422, 'validation.failed', '')), '422 is not indeterminate');
check(!isIndeterminateError(new ApiError(400, 'request.bad', '')), '400 is not indeterminate');

check(isDefinitive4xxError(new ApiError(422, 'validation.failed', '')), 'classifies 422 as definitive 4xx');
check(isDefinitive4xxError(new ApiError(400, 'request.bad', '')), 'classifies 400 as definitive 4xx');
check(!isDefinitive4xxError(new ApiError(408, 'request.timeout', '')), '408 timeout is excluded from definitive 4xx');
check(!isDefinitive4xxError(new ApiError(500, 'server.internal', '')), '500 is not 4xx');

check(shouldClearOnOutcome('success') === true, 'shouldClearOnOutcome: true on success');
check(shouldClearOnOutcome('4xx') === true, 'shouldClearOnOutcome: true on 4xx');
check(shouldClearOnOutcome('network_error') === false, 'shouldClearOnOutcome: false on network_error (retains key)');
check(shouldClearOnOutcome('timeout') === false, 'shouldClearOnOutcome: false on timeout (retains key)');
check(shouldClearOnOutcome('5xx') === false, 'shouldClearOnOutcome: false on 5xx (retains key)');

check(shouldClearOnModalClose('network_error') === false, 'shouldClearOnModalClose: keeps key on close after network error');
check(shouldClearOnModalClose('timeout') === false, 'shouldClearOnModalClose: keeps key on close after timeout');
check(shouldClearOnModalClose('5xx') === false, 'shouldClearOnModalClose: keeps key on close after 5xx');
check(shouldClearOnModalClose('4xx') === true, 'shouldClearOnModalClose: clears key on close after 4xx');
check(shouldClearOnModalClose('success') === true, 'shouldClearOnModalClose: clears key on close after success');
check(shouldClearOnModalClose(null) === true, 'shouldClearOnModalClose: clears key on close if no attempt made');

check(canReuseCreateKey('k-1', 'Alpha', 'Alpha') === true, 'canReuseCreateKey: true when key, name match');
check(canReuseCreateKey('k-1', 'Alpha', 'Beta') === false, 'canReuseCreateKey: false when name differs');
check(canReuseCreateKey(null, 'Alpha', 'Alpha') === false, 'canReuseCreateKey: false when key is null');
check(canReuseCreateKey('k-1', null, 'Alpha') === false, 'canReuseCreateKey: false when name was null');

check(shouldClearOnNameChange('Alpha', 'Alpha') === false, 'shouldClearOnNameChange: false when name unchanged');
check(shouldClearOnNameChange('Alpha', 'Beta') === true, 'shouldClearOnNameChange: true when name changed');
check(shouldClearOnNameChange(null, 'Beta') === false, 'shouldClearOnNameChange: false when no prior name');

// Session lifecycle walkthrough:
// A. Scenario: Success clears key and recorded name
const session = new CreateTeamIdempotencySession();
let keyGenCounter = 1;
const genKey = () => `key-${keyGenCounter++}`;

const k1 = session.ensureKey('Team Alpha', genKey);
check(k1 === 'key-1', 'session: generated key-1 for Team Alpha');
check(session.getKey() === 'key-1', 'session: records active key');
check(session.getName() === 'Team Alpha', 'session: records active name');
const outSuccess = session.recordOutcome('success');
check(outSuccess === 'success', 'session: records success outcome');
check(session.getKey() === null, 'session: success clears key');
check(session.getName() === null, 'session: success clears recorded name');

// B. Scenario: 4xx definitive error clears key and recorded name
const k2 = session.ensureKey('Team Beta', genKey);
check(k2 === 'key-2', 'session: generated key-2 for Team Beta');
const out4xx = session.recordOutcome(new ApiError(422, 'validation.failed', 'req-422'));
check(out4xx === '4xx', 'session: records 4xx outcome');
check(session.getKey() === null, 'session: 4xx clears key');
check(session.getName() === null, 'session: 4xx clears recorded name');

// C. Scenario: Network error KEEPS key and name, survives modal close, and reuses on reopen
const k3 = session.ensureKey('Team Gamma', genKey);
check(k3 === 'key-3', 'session: generated key-3 for Team Gamma');
const outNet = session.recordOutcome(new ApiError(0, 'client.network', ''));
check(outNet === 'network_error', 'session: records network_error outcome');
check(session.getKey() === 'key-3', 'session: network error KEEPS key');
check(session.getName() === 'Team Gamma', 'session: network error KEEPS recorded name');
check(session.onModalClose() === false, 'session: modal close returns false (not cleared)');
check(session.getKey() === 'key-3', 'session: key survives modal close');
// Reopening modal with same name 'Team Gamma'
const k3Reopened = session.ensureKey('Team Gamma', genKey);
check(k3Reopened === 'key-3', 'session: reopening modal with same name after network error REUSES key-3');

// D. Scenario: Timeout KEEPS key and name, survives modal close, and reuses on reopen
session.clear();
const k4 = session.ensureKey('Team Delta', genKey);
check(k4 === 'key-4', 'session: generated key-4 for Team Delta');
const outTime = session.recordOutcome(new ApiError(0, 'client.timeout', ''));
check(outTime === 'timeout', 'session: records timeout outcome');
check(session.getKey() === 'key-4', 'session: timeout error KEEPS key');
check(session.getName() === 'Team Delta', 'session: timeout error KEEPS recorded name');
check(session.onModalClose() === false, 'session: modal close returns false (not cleared)');
check(session.getKey() === 'key-4', 'session: key survives modal close after timeout');
// Reopening modal with same name 'Team Delta'
const k4Reopened = session.ensureKey('Team Delta', genKey);
check(k4Reopened === 'key-4', 'session: reopening modal with same name after timeout REUSES key-4');

// E. Scenario: Changed name clears key and issues fresh key
const nameChangeCleared = session.onNameChange('Team Epsilon');
check(nameChangeCleared === true, 'session: onNameChange to a different name clears previous key');
check(session.getKey() === null, 'session: key is null after name change');
const k5 = session.ensureKey('Team Epsilon', genKey);
check(k5 === 'key-5', 'session: generated fresh key-5 for new name Team Epsilon');
check(k5 !== k4, 'session: fresh key is distinct from previous key-4');

// F. Store verification in useTeams
useTeams.getState().clearCreateKey();
const storeKey1 = useTeams.getState().ensureCreateKey('Team Store');
check(typeof storeKey1 === 'string' && storeKey1.length > 0, 'useTeams: ensureCreateKey generates key');
const storeKeyRetry = useTeams.getState().ensureCreateKey('Team Store');
check(storeKeyRetry === storeKey1, 'useTeams: ensureCreateKey reuses key for same name');
// Record indeterminate outcome in store
useTeams.getState().recordCreateOutcome(new ApiError(500, 'server.internal', 'req-500'));
check(useTeams.getState().createIdempotencyKey === storeKey1, 'useTeams: 5xx keeps key in store');
check(useTeams.getState().createKeyName === 'Team Store', 'useTeams: 5xx keeps name in store');
// Ensure key with same name again returns the stored key
const storeKeyAfter5xx = useTeams.getState().ensureCreateKey('Team Store');
check(storeKeyAfter5xx === storeKey1, 'useTeams: reopening/retrying same name reuses key after 5xx');
// Name change in store
useTeams.getState().clearCreateKey();
const storeKeyFresh = useTeams.getState().ensureCreateKey('Team Store New');
check(storeKeyFresh !== storeKey1, 'useTeams: new name gets fresh key');

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
check(modalSrc.includes('ensureCreateKey('), 'wires ensureCreateKey for submit');
check(modalSrc.includes('clearCreateKey()'), 'wires clearCreateKey on text change and success');
check(modalSrc.includes('shouldClearOnModalClose'), 'wires shouldClearOnModalClose helper');
check(modalSrc.includes('shouldClearOnNameChange'), 'wires shouldClearOnNameChange helper');
check(modalSrc.includes('recordCreateOutcome'), 'wires recordCreateOutcome helper');
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
