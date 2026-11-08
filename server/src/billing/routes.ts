// Billing router (Task 5).
// Holder-only endpoints: checkout, plan change, seats change, cancel, polling status.
// Rate limit IDs are reused from existing limits (settings.write/settings.read) pending
// dedicated billing limit rows in src/security/limits.ts (needs owner decision).
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  startCheckoutSchema,
  changePlanSchema,
  changeSeatsSchema,
  cancelSchema,
} from './schema.ts';
import { registerPost, registerGet } from '../http/routes.ts';
import { HttpError, ok } from '../middleware/error.ts';
import * as service from './service.ts';

type ZodIssue = z.ZodError['issues'][number];

function fieldCode(issue: ZodIssue, field: string | undefined): string {
  if (issue.code === 'unrecognized_keys') return 'validation.unknown_field';
  if (issue.code === 'invalid_type') return 'auth.field.required';
  switch (field) {
    case 'plan':
      return 'validation.invalid';
    case 'seats':
      return issue.code === 'too_small' ? 'validation.too_small' : 'validation.invalid';
    case 'interval':
      return 'validation.invalid';
    case 'confirm':
      return 'validation.invalid';
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

export function createBillingRouter(): Hono {
  const router = new Hono();

  // 1. Start checkout (first purchase locks currency; Idempotency-Key required)
  registerPost(
    router,
    '/teams/:teamId/billing/checkout',
    { limits: ['settings.write'], auth: true },
    async (c) => {
      const userId = getUserId(c);
      const teamId = param(c, 'teamId');
      const body = parseWith(startCheckoutSchema, c.get('parsedBody'));
      const idempotencyKey = c.req.header('idempotency-key');
      if (!idempotencyKey || idempotencyKey.trim().length === 0) {
        throw new HttpError(400, 'idempotency.missing', 'Idempotency-Key header is required.');
      }
      const result = await service.startCheckout(userId, teamId, body, idempotencyKey);
      return c.json(ok(result), 201);
    },
  );

  // 2. Change plan (upgrade → charge now; downgrade → schedule at period end)
  registerPost(
    router,
    '/teams/:teamId/billing/plan',
    { limits: ['settings.write'], auth: true },
    async (c) => {
      const userId = getUserId(c);
      const teamId = param(c, 'teamId');
      const body = parseWith(changePlanSchema, c.get('parsedBody'));
      const idempotencyKey = c.req.header('idempotency-key');
      if (!idempotencyKey || idempotencyKey.trim().length === 0) {
        throw new HttpError(400, 'idempotency.missing', 'Idempotency-Key header is required.');
      }
      const result = await service.changePlan(userId, teamId, body, idempotencyKey);
      return c.json(ok(result));
    },
  );

  // 3. Change seats (extra seats only Team/Business; within included seats charge is 0)
  registerPost(
    router,
    '/teams/:teamId/billing/seats',
    { limits: ['settings.write'], auth: true },
    async (c) => {
      const userId = getUserId(c);
      const teamId = param(c, 'teamId');
      const body = parseWith(changeSeatsSchema, c.get('parsedBody'));
      const idempotencyKey = c.req.header('idempotency-key');
      if (!idempotencyKey || idempotencyKey.trim().length === 0) {
        throw new HttpError(400, 'idempotency.missing', 'Idempotency-Key header is required.');
      }
      const result = await service.changeSeats(userId, teamId, body, idempotencyKey);
      return c.json(ok(result));
    },
  );

  // 4. Cancel (access to period end, no further charge)
  registerPost(
    router,
    '/teams/:teamId/billing/cancel',
    { limits: ['settings.write'], auth: true },
    async (c) => {
      const userId = getUserId(c);
      const teamId = param(c, 'teamId');
      const body = parseWith(cancelSchema, c.get('parsedBody'));
      const idempotencyKey = c.req.header('idempotency-key');
      if (!idempotencyKey || idempotencyKey.trim().length === 0) {
        throw new HttpError(400, 'idempotency.missing', 'Idempotency-Key header is required.');
      }
      const result = await service.cancel(userId, teamId, body, idempotencyKey);
      return c.json(ok(result));
    },
  );

  // 5. Polling status (intent status + subscription state; no secrets, no provider refs)
  registerGet(
    router,
    '/teams/:teamId/billing/status',
    { limits: ['settings.read'], auth: true },
    async (c) => {
      const userId = getUserId(c);
      const teamId = param(c, 'teamId');
      const result = await service.getStatus(userId, teamId);
      return c.json(ok(result));
    },
  );

  return router;
}
