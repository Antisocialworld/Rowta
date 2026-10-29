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

