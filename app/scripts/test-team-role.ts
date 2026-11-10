// test-team-role.ts — pure tests for team role descriptive labels and control permissions (Owner Decision D8, PRD 4).
import assert from 'node:assert/strict';
import { t } from '../src/i18n/en';
import {
  canChangeMemberRole,
  canInviteMembers,
  canManageTeamSettings,
  canRemoveMember,
  canRevokeInvite,
  teamRoleKey,
} from '../src/lib/team-role';
import {
  deleteTeamResponseSchema,
  deleteTeamSchema,
  inviteItemSchema,
  teamResponseSchema,
  transferTeamResponseSchema,
  transferTeamSchema,
} from '../src/lib/api';

function testTeamRoleKey(): void {
  assert.equal(teamRoleKey('owner'), 'team.role.owner', 'owner must map to team.role.owner');
  assert.equal(teamRoleKey('manager'), 'team.role.manager', 'manager must map to team.role.manager');
  assert.equal(teamRoleKey('staff'), 'team.role.staff', 'staff must map to team.role.staff');
  assert.equal(teamRoleKey('unknown'), 'team.role.staff', 'fallback to team.role.staff');
  assert.equal(teamRoleKey(''), 'team.role.staff', 'empty fallback to team.role.staff');

  // Owner Decision: top role displays as Admin (ADR 0019)
  assert.equal(t('role.owner'), 'Admin', 'role.owner must resolve to Admin');
  assert.equal(t('team.role.owner'), 'Admin in this team', 'team.role.owner must resolve to Admin in this team');
  assert.equal(t(teamRoleKey('owner')), 'Admin in this team', 'teamRoleKey for owner must resolve to Admin in this team');
  assert.equal(t('teams.leave.blocked'), 'The Admin cannot leave the team. Transfer the Admin role or delete the team first.');
  assert.equal(t('teams.toast.transferred'), 'Admin role transferred.');
  assert.equal(t('teams.transfer.action'), 'Transfer Admin role');
  assert.equal(t('teams.transfer.title'), 'Transfer Admin role');
  assert.equal(t('teams.transfer.confirmButton'), 'Transfer Admin role');
}

function testMembersControlVisibilityByRole(): void {
  // Staff point of view: member list with names and badges only.
  // NO change role, NO remove, NO invite, NO toggle settings.
  assert.equal(canChangeMemberRole('staff', 'staff'), false, 'Staff cannot change staff role');
  assert.equal(canChangeMemberRole('staff', 'manager'), false, 'Staff cannot change manager role');
  assert.equal(canRemoveMember('staff', 'staff'), false, 'Staff cannot remove staff');
  assert.equal(canRemoveMember('staff', 'manager'), false, 'Staff cannot remove manager');
  assert.equal(canRemoveMember('staff', 'owner'), false, 'Staff cannot remove owner');
  assert.equal(canInviteMembers('staff'), false, 'Staff cannot invite members');
  assert.equal(canManageTeamSettings('staff'), false, 'Staff cannot toggle managers-can-revoke');

  // Manager point of view:
  // Cannot change roles, cannot toggle settings.
  // CAN invite members, CAN remove staff only.
  assert.equal(canChangeMemberRole('manager', 'staff'), false, 'Manager cannot change role');
  assert.equal(canRemoveMember('manager', 'staff'), true, 'Manager can remove staff');
  assert.equal(canRemoveMember('manager', 'manager'), false, 'Manager cannot remove another manager');
  assert.equal(canRemoveMember('manager', 'owner'), false, 'Manager cannot remove owner');
  assert.equal(canInviteMembers('manager'), true, 'Manager can invite members');
  assert.equal(canManageTeamSettings('manager'), false, 'Manager cannot toggle managers-can-revoke');

  // Owner point of view:
  // Full management of non-owners, settings toggle, and invitations.
  assert.equal(canChangeMemberRole('owner', 'staff'), true, 'Owner can change staff role');
  assert.equal(canChangeMemberRole('owner', 'manager'), true, 'Owner can change manager role');
  assert.equal(canChangeMemberRole('owner', 'owner'), false, 'Owner cannot change owner role');
  assert.equal(canRemoveMember('owner', 'staff'), true, 'Owner can remove staff');
  assert.equal(canRemoveMember('owner', 'manager'), true, 'Owner can remove manager');
  assert.equal(canRemoveMember('owner', 'owner'), false, 'Owner cannot remove owner');
  assert.equal(canInviteMembers('owner'), true, 'Owner can invite members');
  assert.equal(canManageTeamSettings('owner'), true, 'Owner can toggle settings');
}

function testTeamResponseSchemaWithCreator(): void {
  const validUuid = '11111111-1111-4111-8111-111111111111';
  const creatorUuid = '22222222-2222-4222-8222-222222222222';

  // 1. With createdBy populated
  const withCreator = teamResponseSchema.parse({
    id: validUuid,
    name: 'Team Alpha',
    role: 'owner',
    managersCanRevokeInvites: true,
    createdBy: {
      userId: creatorUuid,
      displayName: 'Zara Owner',
    },
  });
  assert.equal(withCreator.createdBy?.displayName, 'Zara Owner');
  assert.equal(withCreator.createdBy?.userId, creatorUuid);

  // 2. With createdBy null
  const nullCreator = teamResponseSchema.parse({
    id: validUuid,
    name: 'Team Beta',
    role: 'staff',
    managersCanRevokeInvites: false,
    createdBy: null,
  });
  assert.equal(nullCreator.createdBy, null);

  // 3. With createdBy omitted
  const omittedCreator = teamResponseSchema.parse({
    id: validUuid,
    name: 'Team Gamma',
    role: 'manager',
    managersCanRevokeInvites: true,
  });
  assert.equal(omittedCreator.createdBy, undefined);
}

function testCanRevokeInvite(): void {
  const managerId = '22222222-2222-4222-8222-222222222222';
  const otherId = '33333333-3333-4333-8333-333333333333';
  const ownerId = '11111111-1111-4111-8111-111111111111';
  const staffId = '44444444-4444-4444-8444-444444444444';

  // 1. Owner can revoke any invite
  assert.equal(canRevokeInvite('owner', ownerId, { role: 'staff', invitedBy: otherId }, false), true);
  assert.equal(canRevokeInvite('owner', ownerId, { role: 'manager', invitedBy: otherId }, false), true);

  // 2. Manager can ALWAYS revoke invite they sent themselves (even if setting is false)
  assert.equal(canRevokeInvite('manager', managerId, { role: 'staff', invitedBy: managerId }, false), true);
  assert.equal(canRevokeInvite('manager', managerId, { role: 'staff', invitedBy: managerId }, true), true);

  // 3. Manager revoking someone else's invite:
  // Allowed if setting is true AND role is staff
  assert.equal(canRevokeInvite('manager', managerId, { role: 'staff', invitedBy: otherId }, true), true);
  // Denied if setting is false
  assert.equal(canRevokeInvite('manager', managerId, { role: 'staff', invitedBy: otherId }, false), false);
  // Denied if target role is manager
  assert.equal(canRevokeInvite('manager', managerId, { role: 'manager', invitedBy: otherId }, true), false);

  // 4. Staff cannot revoke anything
  assert.equal(canRevokeInvite('staff', staffId, { role: 'staff', invitedBy: staffId }, true), false);
  assert.equal(canRevokeInvite('staff', staffId, { role: 'staff', invitedBy: otherId }, true), false);
}

function testDeleteAndTransferSchemas(): void {
  const validUuid = '11111111-1111-4111-8111-111111111111';
  const targetUuid = '22222222-2222-4222-8222-222222222222';

  // deleteTeamSchema
  const validDelete = deleteTeamSchema.parse({ confirmName: ' Team Alpha ' });
  assert.equal(validDelete.confirmName, 'Team Alpha');
  assert.throws(() => deleteTeamSchema.parse({ confirmName: '' }));
  assert.throws(() => deleteTeamSchema.parse({}));

  // deleteTeamResponseSchema
  const validDeleteRes = deleteTeamResponseSchema.parse({ success: true, teamId: validUuid });
  assert.equal(validDeleteRes.success, true);
  assert.equal(validDeleteRes.teamId, validUuid);

  // transferTeamSchema
  const validTransfer = transferTeamSchema.parse({ targetUserId: targetUuid });
  assert.equal(validTransfer.targetUserId, targetUuid);
  assert.throws(() => transferTeamSchema.parse({ targetUserId: 'not-a-uuid' }));

  // transferTeamResponseSchema
  const validTransferRes = transferTeamResponseSchema.parse({
    success: true,
    teamId: validUuid,
    newOwnerId: targetUuid,
  });
  assert.equal(validTransferRes.success, true);
  assert.equal(validTransferRes.teamId, validUuid);
  assert.equal(validTransferRes.newOwnerId, targetUuid);
}

function testInviteItemSchema(): void {
  const inviteId = '44444444-4444-4444-8444-444444444444';
  const inviterId = '22222222-2222-4222-8222-222222222222';

  // With invitedBy populated
  const withInviter = inviteItemSchema.parse({
    id: inviteId,
    email: 'test@example.com',
    role: 'staff',
    createdAt: '2026-10-30T10:00:00.000Z',
    expiresAt: '2026-11-06T10:00:00.000Z',
    invitedBy: inviterId,
  });
  assert.equal(withInviter.id, inviteId);
  assert.equal(withInviter.invitedBy, inviterId);

  // Without invitedBy (optional)
  const withoutInviter = inviteItemSchema.parse({
    id: inviteId,
    email: 'test@example.com',
    role: 'manager',
    createdAt: '2026-10-30T10:00:00.000Z',
    expiresAt: '2026-11-06T10:00:00.000Z',
  });
  assert.equal(withoutInviter.id, inviteId);
  assert.equal(withoutInviter.invitedBy, undefined);

  // Invalid UUID for id or invitedBy throws
  assert.throws(() =>
    inviteItemSchema.parse({
      id: 'invalid-id',
      email: 'test@example.com',
      role: 'staff',
      createdAt: '2026-10-30T10:00:00.000Z',
      expiresAt: '2026-11-06T10:00:00.000Z',
    }),
  );
  assert.throws(() =>
    inviteItemSchema.parse({
      id: inviteId,
      email: 'test@example.com',
      role: 'staff',
      createdAt: '2026-10-30T10:00:00.000Z',
      expiresAt: '2026-11-06T10:00:00.000Z',
      invitedBy: 'invalid-inviter',
    }),
  );
}

function runAll(): void {
  testTeamRoleKey();
  testMembersControlVisibilityByRole();
  testTeamResponseSchemaWithCreator();
  testCanRevokeInvite();
  testDeleteAndTransferSchemas();
  testInviteItemSchema();
  console.log('test-team-role: all role visibility, schema, and invite revoke assertion suites passed');
}

runAll();

