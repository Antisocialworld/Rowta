// Swaps routes (PRD 8.5, 9.9, 12; rules S7, S14, V1, V3).
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  decideSwapSchema,
  requestSwapSchema,
  swapsQuerySchema,
} from '@rowta/shared';
import { registerGet, registerPost } from '../http/routes.ts';
import { HttpError, ok } from '../middleware/error.ts';
import * as service from './service.ts';
import { requireBillingNotRestricted } from '../billing/restricted-guard.ts';

type ZodIssue = z.ZodError['issues'][number];

const TYPED_KEY = /^(swap|activity)\.[a-zA-Z._]+$/;

function fieldCode(issue: ZodIssue, field: string | undefined): string {
  if (issue.code === 'unrecognized_keys') return 'validation.unknown_field';
  if (TYPED_KEY.test(issue.message)) return issue.message;
  if (issue.code === 'invalid_type') return 'auth.field.required';
  switch (field) {
    case 'shiftId':
      return 'swap.shift.notFound';
    case 'targetUserId':
      return 'swap.target_invalid';
    case 'status':
      return 'swap.not_pending';
    case 'declineReason':
      return 'swap.decline_reason_required';
    case 'note':
      return 'swap.note_invalid';
    case 'cursor':
      return 'activity.cursor.invalid';
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

export function createSwapsRouter(): Hono {
  const router = new Hono();

  // 1. Request a swap (Assignee only; Idempotency-Key required).
  registerPost(router, '/teams/:teamId/swaps', { limits: ['swap.request'], auth: true }, async (c) => {
    const userId = getUserId(c);
    const teamId = param(c, 'teamId');
    const body = parseWith(requestSwapSchema, c.get('parsedBody'));
    const idempotencyKey = c.req.header('idempotency-key');
    const swap = await service.requestSwap(teamId, userId, body, idempotencyKey);
    return c.json(ok(swap), 201);
  });

  // 1b. Ergonomic request endpoint directly scoped to shift (:shiftId).
  registerPost(router, '/teams/:teamId/shifts/:shiftId/swap', { limits: ['swap.request'], auth: true }, async (c) => {
    const userId = getUserId(c);
    const teamId = param(c, 'teamId');
    const shiftId = param(c, 'shiftId');
    const rawBody = (c.get('parsedBody') as Record<string, unknown> | null) ?? {};
    const body = parseWith(requestSwapSchema, { ...rawBody, shiftId });
    const idempotencyKey = c.req.header('idempotency-key');
    const swap = await service.requestSwap(teamId, userId, body, idempotencyKey);
    return c.json(ok(swap), 201);
  });

  // 2. List team swaps (all members; cursor-paginated).
  registerGet(router, '/teams/:teamId/swaps', { limits: ['swaps.list'], auth: true }, async (c) => {
    const userId = getUserId(c);
    const teamId = param(c, 'teamId');
    const query = parseWith(swapsQuerySchema, c.req.query());
    const page = await service.listSwaps(teamId, userId, query);
    return c.json(ok(page));
  });

  // 3. Get one swap (all members of team).
  registerGet(router, '/teams/:teamId/swaps/:swapId', { limits: ['swap.get'], auth: true }, async (c) => {
    const userId = getUserId(c);
    const teamId = param(c, 'teamId');
    const swapId = param(c, 'swapId');
    const swap = await service.getSwap(teamId, userId, swapId);
    return c.json(ok(swap));
  });

  // 4. Decide a swap (Owner or Manager only; approve or reject).
  registerPost(router, '/teams/:teamId/swaps/:swapId/decide', { limits: ['swap.decide'], auth: true }, async (c) => {
    const userId = getUserId(c);
    const teamId = param(c, 'teamId');
    const swapId = param(c, 'swapId');
    await requireBillingNotRestricted(teamId);
    const body = parseWith(decideSwapSchema, c.get('parsedBody'));
    const result = await service.decideSwap(teamId, userId, swapId, body);
    return c.json(ok(result));
  });

  // 5. Cancel a swap (requester or Owner/Manager).
  registerPost(router, '/teams/:teamId/swaps/:swapId/cancel', { limits: ['swap.cancel'], auth: true }, async (c) => {
    const userId = getUserId(c);
    const teamId = param(c, 'teamId');
    const swapId = param(c, 'swapId');
    const result = await service.cancelSwap(teamId, userId, swapId);
    return c.json(ok(result));
  });

  return router;
}

