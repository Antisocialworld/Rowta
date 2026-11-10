// Account routes: deletion request and preview (Task D2; PRD 8.10; rules S5, S6, S14).
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { deleteAccountSchema } from '@rowta/shared';
import { registerGet, registerPost } from '../http/routes.ts';
import { HttpError, ok } from '../middleware/error.ts';
import * as service from './service.ts';

type ZodIssue = z.ZodError['issues'][number];

function fieldCode(issue: ZodIssue, _field: string | undefined): string {
  if (issue.code === 'unrecognized_keys') return 'validation.unknown_field';
  if (issue.code === 'invalid_type') return 'auth.field.required';
  return 'validation.invalid';
}

function parseInput<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;

  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        if (fields[key] === undefined) fields[key] = 'validation.unknown_field';
      }
      continue;
    }
    const field = typeof issue.path[0] === 'string' ? issue.path[0] : undefined;
    if (field !== undefined && fields[field] === undefined) {
      fields[field] = fieldCode(issue, field);
    }
  }
  throw new HttpError(422, 'validation.failed', 'Validation failed.', undefined, fields);
}

function requireUserId(c: Context): string {
  const userId = c.get('userId');
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new HttpError(401, 'auth.not_authenticated', 'Not authenticated.');
  }
  return userId;
}

export function createAccountDeletionRouter(): Hono {
  const router = new Hono();

  // GET /account/delete-preview — preview deletion consequences
  registerGet(router, '/account/delete-preview', { limits: ['account.delete_preview'], auth: true }, async (c) => {
    const userId = requireUserId(c);
    const result = await service.getDeletePreview(userId);
    return c.json(ok(result));
  });

  // POST /account/delete — request account deletion
  registerPost(router, '/account/delete', { limits: ['account.delete'], auth: true }, async (c) => {
    const userId = requireUserId(c);
    const input = parseInput(deleteAccountSchema, c.get('parsedBody'));
    const result = await service.deleteAccount(userId, input);
    return c.json(ok(result));
  });

  return router;
}

