// Account-level move billing router (C6).
// Routes under /teams/:teamId/billing/move/*.
// Owner requests, Admin accepts/declines, owner cancels.
// NOT wired into live paths until C7 — old hand-over routes remain in place.
import { Hono, type Context } from 'hono';
import { registerPost, registerGet } from '../http/routes.ts';
import { HttpError, ok } from '../middleware/error.ts';
import * as service from './move-service.ts';
import { z } from 'zod';

type ZodIssue = z.ZodError['issues'][number];

function fieldCode(issue: ZodIssue, _field: string | undefined): string {
  if (issue.code === 'unrecognized_keys') return 'validation.unknown_field';
  if (issue.code === 'invalid_type') return 'auth.field.required';
  return 'validation.invalid';
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

const moveRequestSchema = z.object({
  receiverUserId: z.string().uuid(),
});

export function createMoveRouter(): Hono {
  const router = new Hono();

  // 1. POST /teams/:teamId/billing/move/request — owner starts a move.
  registerPost(
    router,
    '/teams/:teamId/billing/move/request',
    { limits: ['settings.write'], auth: true },
    async (c) => {
      const userId = getUserId(c);
      const teamId = param(c, 'teamId');
      const body = parseWith(moveRequestSchema, c.get('parsedBody'));
      const idempotencyKey = c.req.header('idempotency-key');
      if (!idempotencyKey || idempotencyKey.trim().length === 0) {
        throw new HttpError(400, 'idempotency.missing', 'Idempotency-Key header is required.');
      }
      const result = await service.requestMove(userId, teamId, body.receiverUserId, idempotencyKey);
      return c.json(ok(result), 201);
    },
  );

  // 2. GET /teams/:teamId/billing/move — view current open move.
  registerGet(
    router,
    '/teams/:teamId/billing/move',
    { limits: ['settings.read'], auth: true },
    async (c) => {
      const userId = getUserId(c);
      const teamId = param(c, 'teamId');
      const result = await service.getMove(teamId, userId);
      return c.json(ok({ move: result }), 200);
    },
  );

  // 3. POST /teams/:teamId/billing/move/:moveId/accept — Admin accepts.
  registerPost(
    router,
    '/teams/:teamId/billing/move/:moveId/accept',
    { limits: ['settings.write'], auth: true },
    async (c) => {
      const userId = getUserId(c);
      const teamId = param(c, 'teamId');
      const moveId = param(c, 'moveId');
      const idempotencyKey = c.req.header('idempotency-key');
      if (!idempotencyKey || idempotencyKey.trim().length === 0) {
        throw new HttpError(400, 'idempotency.missing', 'Idempotency-Key header is required.');
      }
      const result = await service.acceptMove(userId, teamId, moveId, idempotencyKey);
      return c.json(ok(result), 200);
    },
  );

  // 4. POST /teams/:teamId/billing/move/:moveId/decline — Admin declines.
  registerPost(
    router,
    '/teams/:teamId/billing/move/:moveId/decline',
    { limits: ['settings.write'], auth: true },
    async (c) => {
      const userId = getUserId(c);
      const teamId = param(c, 'teamId');
      const moveId = param(c, 'moveId');
      const result = await service.declineMove(userId, teamId, moveId);
      return c.json(ok(result), 200);
    },
  );

  // 5. POST /teams/:teamId/billing/move/:moveId/cancel — owner cancels.
  registerPost(
    router,
    '/teams/:teamId/billing/move/:moveId/cancel',
    { limits: ['settings.write'], auth: true },
    async (c) => {
      const userId = getUserId(c);
      const teamId = param(c, 'teamId');
      const moveId = param(c, 'moveId');
      const idempotencyKey = c.req.header('idempotency-key');
      if (!idempotencyKey || idempotencyKey.trim().length === 0) {
        throw new HttpError(400, 'idempotency.missing', 'Idempotency-Key header is required.');
      }
      const result = await service.cancelMove(userId, teamId, moveId);
      return c.json(ok(result), 200);
    },
  );

  return router;
}
