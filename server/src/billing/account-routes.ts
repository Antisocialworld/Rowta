// Account-level billing router (C4).
// Prefix /billing/account. Owner-only; managers and staff get 403.
// NOT wired into live paths yet — registered in index.ts but old per-team routes remain.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { registerPost, registerGet } from '../http/routes.ts';
import { HttpError, ok } from '../middleware/error.ts';
import * as service from './account-service.ts';
import { loadOwnerAccount, loadPlanEntitlements } from './entitlements.ts';
import { quoteSchema, checkoutSchema, cancelSchema } from './account-schema.ts';

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

export function createAccountRouter(): Hono {
  const router = new Hono();

  // 1. GET /billing/account — account status for the owner.
  registerGet(
    router,
    '/billing/account',
    { limits: ['settings.read'], auth: true },
    async (c) => {
      const userId = getUserId(c);
      const account = await loadOwnerAccount(userId);
      if (!account) {
        return c.json(ok({ account: null, entitlements: null }), 200);
      }
      const entitlements = account.status === 'active' || account.status === 'trialing'
        ? await loadPlanEntitlements(account.plan)
        : null;
      return c.json(ok({
        account: {
          userId: account.userId,
          plan: account.plan,
          status: account.status,
          trialStartedAt: account.trialStartedAt,
          trialEndsAt: account.trialEndsAt,
          trialUsed: account.trialUsed,
          periodStart: account.periodStart,
          periodEnd: account.periodEnd,
          cancelAtPeriodEnd: account.cancelAtPeriodEnd,
          currency: account.currency,
        },
        entitlements,
      }), 200);
    },
  );

  // 2. POST /billing/account/quote — price preview before anything is charged.
  registerPost(
    router,
    '/billing/account/quote',
    { limits: ['settings.write'], auth: true },
    async (c) => {
      const userId = getUserId(c);
      const body = parseWith(quoteSchema, c.get('parsedBody'));
      const result = await service.quote(userId, body);
      return c.json(ok(result), 200);
    },
  );

  // 3. POST /billing/account/checkout — Idempotency-Key REQUIRED (400 without it).
  registerPost(
    router,
    '/billing/account/checkout',
    { limits: ['settings.write'], auth: true },
    async (c) => {
      const userId = getUserId(c);
      const body = parseWith(checkoutSchema, c.get('parsedBody'));
      const idempotencyKey = c.req.header('idempotency-key');
      if (!idempotencyKey || idempotencyKey.trim().length === 0) {
        throw new HttpError(400, 'idempotency.missing', 'Idempotency-Key header is required.');
      }
      const result = await service.checkout(userId, body, idempotencyKey);
      return c.json(ok(result), 201);
    },
  );

  // 4. POST /billing/account/cancel — cancel at period end.
  registerPost(
    router,
    '/billing/account/cancel',
    { limits: ['settings.write'], auth: true },
    async (c) => {
      const userId = getUserId(c);
      parseWith(cancelSchema, c.get('parsedBody'));
      const idempotencyKey = c.req.header('idempotency-key');
      if (!idempotencyKey || idempotencyKey.trim().length === 0) {
        throw new HttpError(400, 'idempotency.missing', 'Idempotency-Key header is required.');
      }
      const result = await service.cancelAccount(userId, idempotencyKey);
      return c.json(ok(result), 200);
    },
  );

  // 5. POST /billing/account/resume — resume cancelled-at-period-end subscription.
  registerPost(
    router,
    '/billing/account/resume',
    { limits: ['settings.write'], auth: true },
    async (c) => {
      const userId = getUserId(c);
      const idempotencyKey = c.req.header('idempotency-key');
      if (!idempotencyKey || idempotencyKey.trim().length === 0) {
        throw new HttpError(400, 'idempotency.missing', 'Idempotency-Key header is required.');
      }
      const result = await service.resumeAccount(userId, idempotencyKey);
      return c.json(ok(result), 200);
    },
  );

  return router;
}
