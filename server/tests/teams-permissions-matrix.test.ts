// Permissions matrix unit tests (PRD 4; rules S6, S8).
// Proves:
// 1. Every role x action cell in the PRD section 4 matrix.
// 2. Resource-level conditions (manager staff-only bounds, owner protection, invite revocation settings).
// 3. Deny by default for missing membership, removed membership, or user mismatch.
import { describe, expect, it } from 'vitest';
import { can, type PolicyAction, type PolicyMembership, type PolicyUser, type Role } from '../src/security/policy.ts';

function user(id = 'user-1'): PolicyUser {
  return { id };
}

function membership(role: Role, teamId = 'team-1', userId = 'user-1'): PolicyMembership {
  return { userId, teamId, role, removedAt: null };
}

describe('central permission policy engine (can / PERMISSION_MATRIX)', () => {
  it('denies by default when user or membership is null/undefined or mismatched', () => {
    expect(can(null, membership('owner'), 'view_team')).toBe(false);
    expect(can(user(), null, 'view_team')).toBe(false);
    expect(can(user('u1'), membership('owner', 'team-1', 'u2'), 'view_team')).toBe(false);
  });

  it('denies access if membership is soft-deleted (removedAt is set)', () => {
    const removed: PolicyMembership = {
      userId: 'user-1',
      teamId: 'team-1',
      role: 'owner',
      removedAt: new Date(),
    };
    expect(can(user(), removed, 'view_team')).toBe(false);
    expect(can(user(), removed, 'manage_shifts')).toBe(false);
  });

  describe('PRD Section 4 Matrix cells (table-driven)', () => {
    // Actions that do not require specific target resource conditions
    const basicActions: { action: PolicyAction; owner: boolean; manager: boolean; staff: boolean }[] = [
      { action: 'view_team', owner: true, manager: true, staff: true },
      { action: 'view_shifts', owner: true, manager: true, staff: true },
      { action: 'manage_shifts', owner: true, manager: true, staff: false },
      { action: 'manage_swaps', owner: true, manager: true, staff: false },
      { action: 'view_billing', owner: true, manager: false, staff: false },
      { action: 'manage_billing', owner: true, manager: false, staff: false },
      { action: 'delete_team', owner: true, manager: false, staff: false },
      { action: 'manage_settings', owner: true, manager: false, staff: false },
      { action: 'change_own_settings', owner: true, manager: true, staff: true },
    ];

    for (const { action, owner, manager, staff } of basicActions) {
      it(`enforces matrix for action "${action}"`, () => {
        expect(can(user(), membership('owner'), action)).toBe(owner);
        expect(can(user(), membership('manager'), action)).toBe(manager);
        expect(can(user(), membership('staff'), action)).toBe(staff);
      });
    }
  });

  describe('invite_member permissions', () => {
    it('allows Owner to invite manager and staff, but not another owner', () => {
      expect(can(user(), membership('owner'), 'invite_member', { targetRole: 'manager' })).toBe(true);
      expect(can(user(), membership('owner'), 'invite_member', { targetRole: 'staff' })).toBe(true);
      expect(can(user(), membership('owner'), 'invite_member', { targetRole: 'owner' })).toBe(false);
    });

    it('allows Manager to invite staff only', () => {
      expect(can(user(), membership('manager'), 'invite_member', { targetRole: 'staff' })).toBe(true);
      expect(can(user(), membership('manager'), 'invite_member', { targetRole: 'manager' })).toBe(false);
      expect(can(user(), membership('manager'), 'invite_member', { targetRole: 'owner' })).toBe(false);
    });

    it('denies Staff from inviting anyone', () => {
      expect(can(user(), membership('staff'), 'invite_member', { targetRole: 'staff' })).toBe(false);
      expect(can(user(), membership('staff'), 'invite_member', { targetRole: 'manager' })).toBe(false);
    });
  });

  describe('revoke_invite permissions', () => {
    it('allows Owner to revoke any invite regardless of managers_can_revoke_invites setting', () => {
      expect(can(user(), membership('owner'), 'revoke_invite', { targetRole: 'manager', managersCanRevokeInvites: false })).toBe(true);
      expect(can(user(), membership('owner'), 'revoke_invite', { targetRole: 'staff', managersCanRevokeInvites: false })).toBe(true);
    });

    it('allows Manager to revoke staff invites only when managers_can_revoke_invites is true', () => {
      expect(can(user(), membership('manager'), 'revoke_invite', { targetRole: 'staff', managersCanRevokeInvites: true })).toBe(true);
      expect(can(user(), membership('manager'), 'revoke_invite', { targetRole: 'staff', managersCanRevokeInvites: false })).toBe(false);
      expect(can(user(), membership('manager'), 'revoke_invite', { targetRole: 'manager', managersCanRevokeInvites: true })).toBe(false);
    });

    it('denies Staff from revoking any invite', () => {
      expect(can(user(), membership('staff'), 'revoke_invite', { targetRole: 'staff', managersCanRevokeInvites: true })).toBe(false);
    });
  });

  describe('change_role permissions', () => {
    it('allows Owner to change role to manager or staff', () => {
      expect(can(user(), membership('owner'), 'change_role', { targetRole: 'manager', targetMemberRole: 'staff', targetUserId: 'u2' })).toBe(true);
      expect(can(user(), membership('owner'), 'change_role', { targetRole: 'staff', targetMemberRole: 'manager', targetUserId: 'u2' })).toBe(true);
    });

    it('denies Owner from changing role to owner or modifying the owner', () => {
      expect(can(user(), membership('owner'), 'change_role', { targetRole: 'owner', targetMemberRole: 'staff', targetUserId: 'u2' })).toBe(false);
      expect(can(user(), membership('owner'), 'change_role', { targetRole: 'manager', targetMemberRole: 'owner', targetUserId: 'user-1' })).toBe(false);
    });

    it('denies Manager and Staff from changing roles', () => {
      expect(can(user(), membership('manager'), 'change_role', { targetRole: 'staff', targetMemberRole: 'staff', targetUserId: 'u2' })).toBe(false);
      expect(can(user(), membership('staff'), 'change_role', { targetRole: 'staff', targetMemberRole: 'staff', targetUserId: 'u2' })).toBe(false);
    });
  });

  describe('remove_member permissions', () => {
    it('allows Owner to remove manager or staff, but never owner or self', () => {
      expect(can(user(), membership('owner'), 'remove_member', { targetUserId: 'u2', targetMemberRole: 'manager' })).toBe(true);
      expect(can(user(), membership('owner'), 'remove_member', { targetUserId: 'u2', targetMemberRole: 'staff' })).toBe(true);
      expect(can(user(), membership('owner'), 'remove_member', { targetUserId: 'u2', targetMemberRole: 'owner' })).toBe(false);
      expect(can(user(), membership('owner'), 'remove_member', { targetUserId: 'user-1', targetMemberRole: 'owner' })).toBe(false);
    });

    it('allows Manager to remove staff only, never manager or owner', () => {
      expect(can(user(), membership('manager'), 'remove_member', { targetUserId: 'u2', targetMemberRole: 'staff' })).toBe(true);
      expect(can(user(), membership('manager'), 'remove_member', { targetUserId: 'u2', targetMemberRole: 'manager' })).toBe(false);
      expect(can(user(), membership('manager'), 'remove_member', { targetUserId: 'u2', targetMemberRole: 'owner' })).toBe(false);
    });

    it('denies Staff from removing anyone', () => {
      expect(can(user(), membership('staff'), 'remove_member', { targetUserId: 'u2', targetMemberRole: 'staff' })).toBe(false);
    });
  });

  describe('leave_team permissions', () => {
    it('allows Manager and Staff to leave, but never Owner', () => {
      expect(can(user(), membership('owner'), 'leave_team')).toBe(false);
      expect(can(user(), membership('manager'), 'leave_team')).toBe(true);
      expect(can(user(), membership('staff'), 'leave_team')).toBe(true);
    });
  });
});
