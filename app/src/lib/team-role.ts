// team-role.ts — pure team role formatting helpers for team list (PRD 4, 8.1; Owner Decision D8).
import type { MessageKey } from '../i18n/en';

export const TEAM_ROLE_KEYS: Record<string, MessageKey> = {
  owner: 'team.role.owner',
  manager: 'team.role.manager',
  staff: 'team.role.staff',
};

/**
 * Maps a team membership role to a plain descriptive label key (Owner Decision D8).
 * "Owner of this team", "Manager of this team", "Staff in this team".
 */
export function teamRoleKey(role: string): MessageKey {
  return TEAM_ROLE_KEYS[role] ?? 'team.role.staff';
}

/**
 * Permissions for team controls (PRD 4; S6, S7).
 */
export function canInviteMembers(viewerRole: string | null | undefined): boolean {
  return viewerRole === 'owner' || viewerRole === 'manager';
}

export function canChangeMemberRole(viewerRole: string | null | undefined, targetMemberRole: string): boolean {
  return viewerRole === 'owner' && targetMemberRole !== 'owner';
}

export function canRemoveMember(viewerRole: string | null | undefined, targetMemberRole: string): boolean {
  if (targetMemberRole === 'owner') return false;
  if (viewerRole === 'owner') return true;
  if (viewerRole === 'manager') return targetMemberRole === 'staff';
  return false;
}

export function canManageTeamSettings(viewerRole: string | null | undefined): boolean {
  return viewerRole === 'owner';
}

/**
 * Check if the caller can revoke a specific open invitation (PRD 4, Phase B).
 * - Owner: can revoke any open invitation.
 * - Manager: can ALWAYS revoke an invitation they sent (invitedBy === caller);
 *            other invitations only if managers_can_revoke_invites is true AND invite is for staff.
 * - Staff: never.
 */
export function canRevokeInvite(
  viewerRole: string | null | undefined,
  viewerUserId: string | null | undefined,
  invite: { role: string; invitedBy?: string },
  managersCanRevokeInvites = true,
): boolean {
  if (viewerRole === 'owner') return true;
  if (viewerRole === 'manager') {
    if (viewerUserId && invite.invitedBy && invite.invitedBy === viewerUserId) {
      return true;
    }
    return managersCanRevokeInvites && invite.role === 'staff';
  }
  return false;
}

