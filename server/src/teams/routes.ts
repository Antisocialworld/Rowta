// Teams and invites router (PRD 4, 8.2; rules S6, S7, S8, S14, V1, V2, V3).
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  acceptInviteSchema,
  changeMemberRoleSchema,
  createTeamSchema,
  deleteTeamSchema,
  inviteMemberSchema,
  transferTeamSchema,
  updateTeamSettingsSchema,
} from '@rowta/shared';
import { globalDb } from '../db/clients.ts';
import { registerGet, registerPost } from '../http/routes.ts';
import { HttpError, ok } from '../middleware/error.ts';
import * as service from './service.ts';
import { requireBillingNotRestricted } from '../billing/restricted-guard.ts';

type ZodIssue = z.ZodError['issues'][number];

function fieldCode(issue: ZodIssue, field: string | undefined): string {
  if (issue.code === 'unrecognized_keys') return 'validation.unknown_field';
  if (issue.code === 'invalid_type') return 'auth.field.required';
  switch (field) {
    case 'name':
      return issue.code === 'too_small' ? 'team.name.required' : 'team.name.tooLong';
    case 'email':
      return 'auth.email.invalid';
    case 'role':
      return 'validation.invalid';
    case 'token':
      return 'auth.field.required';
    case 'managers_can_revoke_invites':
      return 'validation.invalid';
    case 'confirmName':
      return 'team.nameMismatch';
    case 'targetUserId':
      return 'team.transferTargetInvalid';
    default:
      return 'validation.invalid';
  }
}

function parseWith<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;

  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        if (fields[key] === undefined) fields[key] = 'validation.unknown_field';
      }
      continue;
    }
    const fieldName = issue.path[0];
    const key = typeof fieldName === 'string' ? fieldName : 'form';
    if (!fields[key]) {
      fields[key] = fieldCode(issue, typeof fieldName === 'string' ? fieldName : undefined);
    }
  }

  throw new HttpError(422, 'validation.invalid', 'Validation failed.', undefined, fields);
}

function getUserId(c: Context): string {
  const userId = c.get('userId');
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new HttpError(401, 'auth.not_authenticated', 'Not authenticated.');
  }
  return userId;
}

function param(c: Context, name: string): string {
  const val = c.req.param(name);
  if (!val || typeof val !== 'string') {
    throw new HttpError(400, 'request.malformed', `Missing required path parameter ${name}.`);
  }
  return val;
}

export function createTeamsRouter(): Hono {
  const router = new Hono();

  // 1. Create team
  registerPost(router, '/teams', { limits: ['team.create'], auth: true }, async (c) => {
    const userId = getUserId(c);
    const body = parseWith(createTeamSchema, c.get('parsedBody'));
    const idempotencyKey = c.req.header('idempotency-key');
    const team = await service.createTeam(userId, body, idempotencyKey);
    return c.json(ok(team), 201);
  });

  // 2. List teams
  registerGet(router, '/teams', { limits: ['teams.list'], auth: true }, async (c) => {
    const userId = getUserId(c);
    const teams = await service.listTeams(userId);
    return c.json(ok({ teams }));
  });

  // 2b. List deleted teams (registered before /teams/:teamId to prevent param clash)
  registerGet(router, '/teams/deleted', { limits: ['teams.deleted'], auth: true }, async (c) => {
    const userId = getUserId(c);
    const result = await service.listDeletedTeams(userId);
    return c.json(ok(result));
  });

  // 3. Get team
  registerGet(router, '/teams/:teamId', { limits: ['team.get'], auth: true }, async (c) => {
    const userId = getUserId(c);
    const teamId = param(c, 'teamId');
    const team = await service.getTeam(userId, teamId);
    return c.json(ok(team));
  });

  // 4. List members
  registerGet(router, '/teams/:teamId/members', { limits: ['members.list'], auth: true }, async (c) => {
    const userId = getUserId(c);
    const teamId = param(c, 'teamId');
    const members = await service.listMembers(userId, teamId);
    return c.json(ok({ members }));
  });

  // 5. Change member role
  registerPost(router, '/teams/:teamId/members/:userId/role', { limits: ['member.role'], auth: true }, async (c) => {
    const callerId = getUserId(c);
    const teamId = param(c, 'teamId');
    const targetUserId = param(c, 'userId');
    const body = parseWith(changeMemberRoleSchema, c.get('parsedBody'));
    await requireBillingNotRestricted(teamId);
    const result = await service.changeMemberRole(callerId, teamId, targetUserId, body);
    return c.json(ok(result));
  });

  // 6. Remove member
  registerPost(router, '/teams/:teamId/members/:userId/remove', { limits: ['member.remove'], auth: true }, async (c) => {
    const callerId = getUserId(c);
    const teamId = param(c, 'teamId');
    const targetUserId = param(c, 'userId');
    await requireBillingNotRestricted(teamId);
    const result = await service.removeMember(callerId, teamId, targetUserId);
    return c.json(ok(result));
  });

  // 7. Leave team
  registerPost(router, '/teams/:teamId/leave', { limits: ['member.leave'], auth: true }, async (c) => {
    const callerId = getUserId(c);
    const teamId = param(c, 'teamId');
    const result = await service.leaveTeam(callerId, teamId);
    return c.json(ok(result));
  });

  // 8. List invites
  registerGet(router, '/teams/:teamId/invites', { limits: ['invites.list'], auth: true }, async (c) => {
    const userId = getUserId(c);
    const teamId = param(c, 'teamId');
    const invites = await service.listInvites(userId, teamId);
    return c.json(ok({ invites }));
  });

  // 9. Create invite
  registerPost(router, '/teams/:teamId/invites', { limits: ['invite.create'], auth: true }, async (c) => {
    const userId = getUserId(c);
    const teamId = param(c, 'teamId');
    await requireBillingNotRestricted(teamId);
    const body = parseWith(inviteMemberSchema, c.get('parsedBody'));
    const result = await service.createInvite(userId, teamId, body);
    return c.json(ok(result));
  });

  // 10. Revoke invite
  registerPost(router, '/teams/:teamId/invites/:inviteId/revoke', { limits: ['invite.revoke'], auth: true }, async (c) => {
    const userId = getUserId(c);
    const teamId = param(c, 'teamId');
    const inviteId = param(c, 'inviteId');
    const result = await service.revokeInvite(userId, teamId, inviteId);
    return c.json(ok(result));
  });

  // 11. Accept invite
  registerPost(router, '/invites/accept', { limits: ['invite.accept'], auth: true }, async (c) => {
    const userId = getUserId(c);
    const body = parseWith(acceptInviteSchema, c.get('parsedBody'));
    const user = await globalDb().users.findUnique({ where: { id: userId } });
    if (!user) {
      throw new HttpError(401, 'auth.not_authenticated', 'Not authenticated.');
    }
    const result = await service.acceptInvite(userId, user.email, body.token);
    return c.json(ok(result));
  });

  // 12. Update team settings
  registerPost(router, '/teams/:teamId/settings', { limits: ['team.settings'], auth: true }, async (c) => {
    const userId = getUserId(c);
    const teamId = param(c, 'teamId');
    const body = parseWith(updateTeamSettingsSchema, c.get('parsedBody'));
    await requireBillingNotRestricted(teamId);
    const result = await service.updateTeamSettings(userId, teamId, body);
    return c.json(ok(result));
  });

  // 13. Delete team (soft delete, Owner only)
  registerPost(router, '/teams/:teamId/delete', { limits: ['team.delete'], auth: true }, async (c) => {
    const userId = getUserId(c);
    const teamId = param(c, 'teamId');
    const body = parseWith(deleteTeamSchema, c.get('parsedBody'));
    const result = await service.deleteTeam(userId, teamId, body);
    return c.json(ok(result));
  });

  // 14. Transfer team ownership (Owner only)
  registerPost(router, '/teams/:teamId/transfer', { limits: ['team.transfer'], auth: true }, async (c) => {
    const callerId = getUserId(c);
    const teamId = param(c, 'teamId');
    const body = parseWith(transferTeamSchema, c.get('parsedBody'));
    const result = await service.transferTeam(callerId, teamId, body);
    return c.json(ok(result));
  });

  // 15. Restore team (Deleter Admin only)
  registerPost(router, '/teams/:teamId/restore', { limits: ['team.restore'], auth: true }, async (c) => {
    const userId = getUserId(c);
    const teamId = param(c, 'teamId');
    const result = await service.restoreTeam(userId, teamId);
    return c.json(ok(result));
  });

  return router;
}
