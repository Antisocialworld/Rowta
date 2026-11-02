// Settings routes (PRD 7.1, 8.8; rules S7, S14, V1, V3).
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { updateSettingsSchema } from '@rowta/shared';
import { registerGet, registerPost } from '../http/routes.ts';
import { HttpError, ok } from '../middleware/error.ts';
import * as service from './service.ts';

type ZodIssue = z.ZodError['issues'][number];

const TYPED_KEY = /^(settings|validation)\.[a-zA-Z._]+$/;

function fieldCode(issue: ZodIssue, field: string | undefined): string {
  if (issue.code === 'unrecognized_keys') return 'validation.unknown_field';
  if (TYPED_KEY.test(issue.message)) return issue.message;
  if (issue.code === 'invalid_type') return 'auth.field.required';
  switch (field) {
    case 'quietStart':
    case 'quietEnd':
      return 'settings.quiet_invalid';
    case 'timeZone':
      return 'settings.time_zone_invalid';
    case 'language':
      return 'settings.language_invalid';
    case 'theme':
      return 'settings.theme_invalid';
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

export function createSettingsRouter(): Hono {
  const router = new Hono();

  // GET /me/settings (settings.read, auth true)
  registerGet(router, '/me/settings', { limits: ['settings.read'], auth: true }, async (c) => {
    const userId = requireUserId(c);
    const settings = await service.getSettings(userId);
    return c.json(ok(settings));
  });

  // POST /me/settings (settings.write, auth true)
  registerPost(router, '/me/settings', { limits: ['settings.write'], auth: true }, async (c) => {
    const userId = requireUserId(c);
    const input = parseWith(updateSettingsSchema, c.get('parsedBody'));
    const settings = await service.updateSettings(userId, input);
    return c.json(ok(settings));
  });

  return router;
}

