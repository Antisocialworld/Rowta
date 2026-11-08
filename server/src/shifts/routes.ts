// Shifts, calendar, activity feed and search routes (PRD 6.1, 8.3, 8.4; rules S7, S14, V1, V3).
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  activityQuerySchema,
  calendarQuerySchema,
  createShiftSchema,
  searchQuerySchema,
  updateShiftSchema,
} from '@rowta/shared';
import { registerGet, registerPost } from '../http/routes.ts';
import { HttpError, ok } from '../middleware/error.ts';
import * as service from './service.ts';
import { requireBillingNotRestricted } from '../billing/restricted-guard.ts';

type ZodIssue = z.ZodError['issues'][number];

const TYPED_KEY = /^(shift|activity|search)\.[a-zA-Z.]+$/;

function fieldCode(issue: ZodIssue, field: string | undefined): string {
  if (issue.code === 'unrecognized_keys') return 'validation.unknown_field';
  if (TYPED_KEY.test(issue.message)) return issue.message;
  if (issue.code === 'invalid_type') return 'auth.field.required';
  switch (field) {
    case 'assignedUserId':
      return 'shift.assignee.invalid';
    case 'startsAt':
    case 'endsAt':
      return 'shift.time.invalid';
    case 'label':
      return 'shift.label.required';
    case 'notes':
      return 'shift.notes.tooLong';
    case 'from':
    case 'to':
      return 'shift.range.invalid';
    case 'cursor':
      return 'activity.cursor.invalid';
    case 'q':
      return 'search.query.tooShort';
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
  const value = c.req.param(name);
  if (!value || typeof value !== 'string') {
    throw new HttpError(400, 'request.malformed', `Missing required path parameter ${name}.`);
  }
  return value;
}

export function createShiftsRouter(): Hono {
  const router = new Hono();

  // 1. Create a shift (Owner/Manager). Shift + activity event in one transaction.
  registerPost(router, '/teams/:teamId/shifts', { limits: ['shift.write'], auth: true }, async (c) => {
    const userId = getUserId(c);
    const teamId = param(c, 'teamId');
    await requireBillingNotRestricted(teamId);
    const body = parseWith(createShiftSchema, c.get('parsedBody'));
    const idempotencyKey = c.req.header('idempotency-key');
    const shift = await service.createShift(userId, teamId, body, idempotencyKey);
    return c.json(ok(shift), 201);
  });

  // 2. Calendar range (all roles). Overlapping shifts, range maximum enforced by the schema.
  registerGet(router, '/teams/:teamId/shifts', { limits: ['shift.read'], auth: true }, async (c) => {
    const userId = getUserId(c);
    const teamId = param(c, 'teamId');
    const range = parseWith(calendarQuerySchema, c.req.query());
    const shifts = await service.listCalendar(userId, teamId, range);
    return c.json(ok(shifts));
  });

  // 3. Shift detail (all roles).
  registerGet(router, '/teams/:teamId/shifts/:shiftId', { limits: ['shift.read'], auth: true }, async (c) => {
    const userId = getUserId(c);
    const teamId = param(c, 'teamId');
    const shiftId = param(c, 'shiftId');
    const shift = await service.getShift(userId, teamId, shiftId);
    return c.json(ok(shift));
  });

  // 4. Edit a shift (Owner/Manager).
  registerPost(router, '/teams/:teamId/shifts/:shiftId/update', { limits: ['shift.write'], auth: true }, async (c) => {
    const userId = getUserId(c);
    const teamId = param(c, 'teamId');
    const shiftId = param(c, 'shiftId');
    await requireBillingNotRestricted(teamId);
    const body = parseWith(updateShiftSchema, c.get('parsedBody'));
    const shift = await service.updateShift(userId, teamId, shiftId, body);
    return c.json(ok(shift));
  });

  // 5. Soft-delete a shift (Owner/Manager).
  registerPost(router, '/teams/:teamId/shifts/:shiftId/delete', { limits: ['shift.write'], auth: true }, async (c) => {
    const userId = getUserId(c);
    const teamId = param(c, 'teamId');
    const shiftId = param(c, 'shiftId');
    const result = await service.deleteShift(userId, teamId, shiftId);
    return c.json(ok(result));
  });

  // 6. Activity feed, cursor paginated (all roles).
  registerGet(router, '/teams/:teamId/activity', { limits: ['activity.read'], auth: true }, async (c) => {
    const userId = getUserId(c);
    const teamId = param(c, 'teamId');
    const query = parseWith(activityQuerySchema, c.req.query());
    const page = await service.listActivity(userId, teamId, query);
    return c.json(ok(page));
  });

  // 7. Team-scoped full-text search over roster, shifts and activity (all roles).
  registerGet(router, '/teams/:teamId/search', { limits: ['search.read'], auth: true }, async (c) => {
    const userId = getUserId(c);
    const teamId = param(c, 'teamId');
    const query = parseWith(searchQuerySchema, c.req.query());
    const results = await service.searchTeam(userId, teamId, query);
    return c.json(ok(results));
  });

  return router;
}
