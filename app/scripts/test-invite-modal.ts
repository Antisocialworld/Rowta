// test-invite-modal.ts — verifies InviteModal implementation, state management, schema validation, and pending invites integration (Stage M3; rules V1, V5, U1, U5, U7, U8, X3, X14; PRD 6.1, 8.2; ADR 0018, ADR 0021).
// Pure logic, state stores, and schemas imported; component files text-scanned to avoid Flow parser crash.
// NOTE: Written per standing rules; do not run unless explicitly authorized by the owner.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { inviteMemberSchema } from '@rowta/shared';
import { inviteRoleOptions } from '../src/state/teams';
import { TEAMS_VIEWS } from '../src/state/teams-view';
import { useInviteModal } from '../src/state/invite-modal';

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}

// ---------------------------------------------------------------------------------------------
// 1. Pure validation: inviteMemberSchema (rules V1, V3)
// ---------------------------------------------------------------------------------------------
console.log('--- 1. Pure validation: inviteMemberSchema ---');
const validStaff = inviteMemberSchema.safeParse({ email: 'worker@example.com', role: 'staff' });
check(validStaff.success === true, 'accepts valid email and staff role');

const validManager = inviteMemberSchema.safeParse({ email: 'lead@example.com', role: 'manager' });
check(validManager.success === true, 'accepts valid email and manager role');

const invalidEmail = inviteMemberSchema.safeParse({ email: 'not-an-email', role: 'staff' });
check(invalidEmail.success === false, 'rejects malformed email');

const invalidRole = inviteMemberSchema.safeParse({ email: 'lead@example.com', role: 'owner' });
check(invalidRole.success === false, 'rejects owner role in invite schema');

// ---------------------------------------------------------------------------------------------
// 2. Pure state: inviteRoleOptions
// ---------------------------------------------------------------------------------------------
console.log('\n--- 2. Pure state: inviteRoleOptions ---');
const ownerOpts = inviteRoleOptions('owner');
check(ownerOpts.includes('manager') && ownerOpts.includes('staff'), 'owner can invite manager and staff');
check(!ownerOpts.includes('owner'), 'owner cannot invite owner');

const managerOpts = inviteRoleOptions('manager');
check(managerOpts.length === 1 && managerOpts[0] === 'staff', 'manager can only invite staff');

// ---------------------------------------------------------------------------------------------
// 3. Pure state: useInviteModal store
// ---------------------------------------------------------------------------------------------
console.log('\n--- 3. Pure state: useInviteModal store ---');
useInviteModal.getState().close();
check(useInviteModal.getState().visible === false, 'initially closed');
check(useInviteModal.getState().trigger === null, 'initial trigger is null');

const dummyRef = { current: {} };
useInviteModal.getState().open('members', dummyRef);
check(useInviteModal.getState().visible === true, 'open() sets visible: true');
check(useInviteModal.getState().trigger === 'members', "open('members') records trigger");
check(useInviteModal.getState().returnFocusRef === dummyRef, 'open records returnFocusRef');

useInviteModal.getState().close();
check(useInviteModal.getState().visible === false, 'close() sets visible: false');
check(useInviteModal.getState().trigger === null, 'close() clears trigger');
check(useInviteModal.getState().returnFocusRef === null, 'close() clears returnFocusRef');

// ---------------------------------------------------------------------------------------------
// 4. View machine hygiene: invite removed from TEAMS_VIEWS
// ---------------------------------------------------------------------------------------------
console.log('\n--- 4. Teams view machine hygiene ---');
check(!('invite' in TEAMS_VIEWS), 'invite is removed from TEAMS_VIEWS machine');

// ---------------------------------------------------------------------------------------------
// 5. Text-scan: InviteModal.tsx
// ---------------------------------------------------------------------------------------------
console.log('\n--- 5. InviteModal text-scan ---');
const MODAL_PATH = resolve(__dirname, '../src/screens/teams/InviteModal.tsx');
check(existsSync(MODAL_PATH), 'InviteModal.tsx exists');

const modalSrc = existsSync(MODAL_PATH) ? readFileSync(MODAL_PATH, 'utf8') : '';
check(modalSrc.includes('<SheetModal'), 'InviteModal mounts SheetModal');
check(modalSrc.includes('headingKey="teams.view.invite.heading"'), 'sets headingKey');
check(modalSrc.includes('testID="invite-email"'), 'email input sets testID="invite-email"');
check(modalSrc.includes('testID="invite-submit"'), 'submit button sets testID="invite-submit"');
check(modalSrc.includes('testID="invite-cancel"'), 'cancel button sets testID="invite-cancel"');
check(modalSrc.includes('focusOn(emailRef.current)'), 'auto-focuses email input on open (U7)');
check(modalSrc.includes('useInviteModal'), 'connects to useInviteModal store');
check(modalSrc.includes("invalidateQueries({ queryKey: ['teams'] })"), "invalidates ['teams'] cache");

// ---------------------------------------------------------------------------------------------
// 6. Text-scan: MembersScreen.tsx pending invites and trigger
// ---------------------------------------------------------------------------------------------
console.log('\n--- 6. MembersScreen text-scan ---');
const MEMBERS_PATH = resolve(__dirname, '../src/screens/teams/MembersScreen.tsx');
check(existsSync(MEMBERS_PATH), 'MembersScreen.tsx exists');

const membersSrc = existsSync(MEMBERS_PATH) ? readFileSync(MEMBERS_PATH, 'utf8') : '';
check(membersSrc.includes("t('action.pendingInvites')"), 'renders pending invites section header');
check(membersSrc.includes('testID={`invite-${invite.id}`}'), 'renders invite card testID');
check(membersSrc.includes('testID={`invite-revoke-${invite.id}`}'), 'renders revoke button testID');
check(membersSrc.includes('testID="members-open-invite"'), 'renders members-open-invite trigger');
check(membersSrc.includes("openInviteModal('members'"), 'wires openInviteModal from members');

// ---------------------------------------------------------------------------------------------
// 7. Text-scan: TeamsRouter.tsx mounts InviteModal
// ---------------------------------------------------------------------------------------------
console.log('\n--- 7. TeamsRouter text-scan ---');
const ROUTER_PATH = resolve(__dirname, '../src/screens/TeamsRouter.tsx');
check(existsSync(ROUTER_PATH), 'TeamsRouter.tsx exists');
const routerSrc = existsSync(ROUTER_PATH) ? readFileSync(ROUTER_PATH, 'utf8') : '';
check(routerSrc.includes('<InviteModal />'), 'TeamsRouter mounts <InviteModal />');

if (failures > 0) {
  console.error(`Invite modal checks failed with ${failures} error(s).`);
  process.exit(1);
} else {
  console.log('All invite modal checks passed.');
  process.exit(0);
}

