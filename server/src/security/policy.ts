// Central permission policy engine (rules S6, S8; PRD 4).
//
// Deny by default. The matrix is pure DATA (PRD section 4 table), never if-chains.
// The role is read from `memberships` on each request through the data-access layer;
// it is never cached on a token or an index (S8).
export type Role = 'owner' | 'manager' | 'staff';

export type PolicyAction =
  | 'view_team'
  | 'view_shifts'
  | 'manage_shifts'
  | 'request_swap'
  | 'manage_swaps'
  | 'view_invites'
  | 'invite_member'
  | 'revoke_invite'
  | 'change_role'
  | 'remove_member'
  | 'leave_team'
  | 'view_billing'
  | 'manage_billing'
  | 'delete_team'
  | 'restore_team'
  | 'transfer_ownership'
  | 'manage_settings'
  | 'change_own_settings';

export interface PolicyUser {
  readonly id: string;
}

export interface PolicyMembership {
  readonly userId?: string;
  readonly user_id?: string;
  readonly teamId?: string;
  readonly team_id?: string;
  readonly role: Role;
  readonly removedAt?: Date | null;
  readonly removed_at?: Date | null;
}

export interface PolicyResource {
  readonly targetRole?: Role;
  readonly targetUserId?: string;
  readonly targetMemberRole?: Role;
  readonly managersCanRevokeInvites?: boolean;
  readonly shiftAssigneeId?: string;
  readonly invitedBy?: string;
  readonly deletedBy?: string;
}

export interface PolicyContext {
  readonly user: PolicyUser;
  readonly membership: PolicyMembership;
  readonly action: PolicyAction;
  readonly resource?: PolicyResource;
}

export interface ActionRule {
  readonly allowedRoles: readonly Role[];
  readonly checkResource?: (ctx: PolicyContext) => boolean;
}

/**
 * The PRD Section 4 Permission Matrix represented as DATA.
 * Extended cleanly for shift and swap actions across Phases 3, 4, and 5.
 */
export const PERMISSION_MATRIX: Readonly<Record<PolicyAction, ActionRule>> = {
  // 1. View team shifts and roster: Owner=yes, Manager=yes, Staff=yes
  view_team: {
    allowedRoles: ['owner', 'manager', 'staff'],
  },
  view_shifts: {
    allowedRoles: ['owner', 'manager', 'staff'],
  },

  // 2. Create, edit, delete shift: Owner=yes, Manager=yes, Staff=NO (403)
  manage_shifts: {
    allowedRoles: ['owner', 'manager'],
  },

  // 3. Request a swap on own shift: Owner=yes, Manager=yes, Staff=yes
  request_swap: {
    allowedRoles: ['owner', 'manager', 'staff'],
    checkResource: (ctx) => {
      // Must be own shift if shiftAssigneeId is provided
      if (ctx.resource?.shiftAssigneeId !== undefined) {
        return ctx.user.id === ctx.resource.shiftAssigneeId;
      }
      return true;
    },
  },

  // 4. Approve or reject a swap: Owner=yes, Manager=yes, Staff=NO (403)
  manage_swaps: {
    allowedRoles: ['owner', 'manager'],
  },

  // 5a. View open pending invites: Owner=yes, Manager=yes, Staff=NO (403)
  view_invites: {
    allowedRoles: ['owner', 'manager'],
  },

  // 5. Invite members: Owner=yes, Manager=yes (staff only) [DECISION], Staff=NO (403)
  invite_member: {
    allowedRoles: ['owner', 'manager'],
    checkResource: (ctx) => {
      // Cannot invite another owner (single owner rule)
      if (ctx.resource?.targetRole === 'owner') return false;
      // Manager can only invite staff
      if (ctx.membership.role === 'manager') {
        return ctx.resource?.targetRole === 'staff';
      }
      return true;
    },
  },

  // 5b. Revoke open invite:
  // Owner=yes (any invite)
  // Manager=yes ALWAYS if they invited the person (invites.invited_by === caller);
  //         otherwise staff only AND managers_can_revoke_invites=true
  // Staff=NO
  revoke_invite: {
    allowedRoles: ['owner', 'manager'],
    checkResource: (ctx) => {
      if (ctx.membership.role === 'manager') {
        if (ctx.resource?.invitedBy && ctx.resource.invitedBy === ctx.user.id) {
          return true;
        }
        return (
          ctx.resource?.managersCanRevokeInvites === true &&
          ctx.resource?.targetRole === 'staff'
        );
      }
      return true;
    },
  },

  // 6. Change a member's role: Owner=yes, Manager=NO, Staff=NO
  change_role: {
    allowedRoles: ['owner'],
    checkResource: (ctx) => {
      // Role cannot be changed to owner (single owner rule)
      if (ctx.resource?.targetRole === 'owner') return false;
      // Cannot demote or change the owner's role
      if (ctx.resource?.targetMemberRole === 'owner') return false;
      return true;
    },
  },

  // 7. Remove a member: Owner=yes, Manager=staff only [DECISION], Staff=NO
  remove_member: {
    allowedRoles: ['owner', 'manager'],
    checkResource: (ctx) => {
      // The owner cannot be removed (Owner decision / S8 / PRD 8.10)
      if (ctx.resource?.targetMemberRole === 'owner') return false;
      // Cannot remove yourself with remove_member; use leave_team instead
      if (ctx.resource?.targetUserId === ctx.user.id) return false;
      // Manager can only remove staff
      if (ctx.membership.role === 'manager') {
        return ctx.resource?.targetMemberRole === 'staff';
      }
      return true;
    },
  },

  // 7b. Leave a team: Managers and Staff can leave; the Owner cannot.
  leave_team: {
    allowedRoles: ['manager', 'staff'],
  },

  // 8. View or change billing: Owner=yes, Manager=NO, Staff=NO
  view_billing: {
    allowedRoles: ['owner'],
  },
  manage_billing: {
    allowedRoles: ['owner'],
  },

  // 9. Delete or restore the team: Owner=yes, Manager=NO, Staff=NO
  delete_team: {
    allowedRoles: ['owner'],
  },

  // 9a. Restore soft-deleted team: only the Admin who deleted it
  restore_team: {
    allowedRoles: ['owner'],
    checkResource: (ctx) => {
      if (ctx.resource?.deletedBy !== undefined) {
        return ctx.user.id === ctx.resource.deletedBy;
      }
      return true;
    },
  },

  // 9b. Transfer team ownership: Owner=yes, Manager=NO, Staff=NO
  transfer_ownership: {
    allowedRoles: ['owner'],
  },

  // 10. Team settings (e.g. managers_can_revoke_invites): Owner only
  manage_settings: {
    allowedRoles: ['owner'],
  },

  // 11. Change own settings: Owner=yes, Manager=yes, Staff=yes
  change_own_settings: {
    allowedRoles: ['owner', 'manager', 'staff'],
  },
};

/**
 * Deny by default policy decision engine.
 *
 * @param user The authenticated user
 * @param membership The membership loaded on the request from the shard's memberships table
 * @param action The requested action
 * @param resource Optional context about target role, member, or assignee
 * @returns true if allowed, false otherwise (deny by default)
 */
export function can(
  user: PolicyUser | null | undefined,
  membership: PolicyMembership | null | undefined,
  action: PolicyAction,
  resource?: PolicyResource,
): boolean {
  if (!user || !membership) return false;
  const removed = membership.removedAt ?? membership.removed_at;
  if (removed != null) return false;
  const memUserId = membership.userId ?? membership.user_id;
  if (memUserId !== user.id) return false;

  const rule = PERMISSION_MATRIX[action];
  if (!rule) return false;

  if (!rule.allowedRoles.includes(membership.role)) {
    return false;
  }

  if (rule.checkResource) {
    return rule.checkResource({ user, membership, action, resource });
  }

  return true;
}
