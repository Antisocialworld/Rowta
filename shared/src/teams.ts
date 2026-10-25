// Shared Zod schemas for teams, roles, invites, and settings (rules V1, V2, V3, V4; PRD 4, 8.2).
import { z } from 'zod';
import { emailField } from './auth.ts';
import {
  TEAM_NAME_MAX_LENGTH,
  TEAM_NAME_MIN_LENGTH,
} from './constants.ts';

export const teamRoleSchema = z.enum(['owner', 'manager', 'staff']);
export type TeamRole = z.infer<typeof teamRoleSchema>;

export const assignableRoleSchema = z.enum(['manager', 'staff']);
export type AssignableRole = z.infer<typeof assignableRoleSchema>;

export const createTeamSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(TEAM_NAME_MIN_LENGTH, 'team.name.required')
      .max(TEAM_NAME_MAX_LENGTH, 'team.name.tooLong'),
  })
  .strict();
export type CreateTeamInput = z.infer<typeof createTeamSchema>;

export const inviteMemberSchema = z
  .object({
    email: emailField,
    role: assignableRoleSchema,
  })
  .strict();
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const acceptInviteSchema = z
  .object({
    token: z.string().trim().min(1, 'auth.field.required'),
  })
  .strict();
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const changeMemberRoleSchema = z
  .object({
    role: assignableRoleSchema,
  })
  .strict();
export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;

export const updateTeamSettingsSchema = z
  .object({
    managers_can_revoke_invites: z.boolean(),
  })
  .strict();
export type UpdateTeamSettingsInput = z.infer<typeof updateTeamSettingsSchema>;

// Response schemas
export const teamResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  role: teamRoleSchema,
  managersCanRevokeInvites: z.boolean(),
});
export type TeamResponse = z.infer<typeof teamResponseSchema>;

export const teamListResponseSchema = z.object({
  teams: z.array(teamResponseSchema),
});
export type TeamListResponse = z.infer<typeof teamListResponseSchema>;

export const memberItemSchema = z.object({
  userId: z.string().uuid(),
  role: teamRoleSchema,
  displayName: z.string(),
  email: z.string(),
  createdAt: z.coerce.date(),
});
export type MemberItem = z.infer<typeof memberItemSchema>;

export const memberListResponseSchema = z.object({
  members: z.array(memberItemSchema),
});
export type MemberListResponse = z.infer<typeof memberListResponseSchema>;

export const memberRoleResponseSchema = z.object({
  userId: z.string().uuid(),
  role: teamRoleSchema,
});
export type MemberRoleResponse = z.infer<typeof memberRoleResponseSchema>;

export const inviteItemSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  role: teamRoleSchema,
  createdAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
});
export type InviteItem = z.infer<typeof inviteItemSchema>;

export const inviteListResponseSchema = z.object({
  invites: z.array(inviteItemSchema),
});
export type InviteListResponse = z.infer<typeof inviteListResponseSchema>;

export const acceptInviteResponseSchema = z.object({
  teamId: z.string().uuid(),
  role: teamRoleSchema,
});
export type AcceptInviteResponse = z.infer<typeof acceptInviteResponseSchema>;

export const teamSettingsResponseSchema = z.object({
  managersCanRevokeInvites: z.boolean(),
});
export type TeamSettingsResponse = z.infer<typeof teamSettingsResponseSchema>;

