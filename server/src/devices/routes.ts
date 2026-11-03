// Devices routes (Phase 6 Stage 3; PRD 7.1, 8.7; rules S5, S7, S9, S14, V1, V3).
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { registerDeviceSchema, unregisterDeviceParamsSchema } from '@rowta/shared';
import { registerPost } from '../http/routes.ts';
import { HttpError, ok } from '../middleware/error.ts';
import * as service from './service.ts';

type ZodIssue = z.ZodError['issues'][number];

function fieldCode(issue: ZodIssue, field: string | undefined): string {
  if (issue.code === 'unrecognized_keys') return 'validation.unknown_field';
  if (issue.code === 'invalid_type') return 'auth.field.required';
  switch (field) {
    case 'pushToken':
      return 'device.push_token_invalid';
    case 'platform':
      return 'device.platform_invalid';
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

function requireUserId(c: Context): string {
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

export function createDevicesRouter(): Hono {
  const router = new Hono();

  // POST /devices (Register device with push token, auth: true, limit: device.register)
  registerPost(router, '/devices', { limits: ['device.register'], auth: true }, async (c) => {
    const userId = requireUserId(c);
    const idempotencyKey = c.req.header('idempotency-key');
    const input = parseWith(registerDeviceSchema, c.get('parsedBody'));
    const device = await service.registerDevice(userId, input, idempotencyKey);
    return c.json(ok(device), 201);
  });

  // POST /devices/:id/unregister (Unregister device, auth: true, limit: device.unregister)
  registerPost(router, '/devices/:id/unregister', { limits: ['device.unregister'], auth: true }, async (c) => {
    const userId = requireUserId(c);
    const idParam = param(c, 'id');
    const params = parseWith(unregisterDeviceParamsSchema, { id: idParam });
    const idempotencyKey = c.req.header('idempotency-key');
    const res = await service.unregisterDevice(userId, params.id, idempotencyKey);
    return c.json(ok(res));
  });

  return router;
}

