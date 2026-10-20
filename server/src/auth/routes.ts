// Auth routes: validation -> limits -> flow -> envelope (rules V1 to V3, A5 to A13, S14, PRD 8.1).
//
// Every request body is parsed with the SHARED schema (V1) after the route's rate limits ran
// (src/http/routes.ts chain). Validation failures are 422 with field-level catalog codes (V3) —
// raw Zod text never leaves the server (V5). Success bodies are built with ok(); uniform routes
// carry the fixed catalog message plus remaining SECONDS in meta (A9), never a clock time.
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  AUTH_MESSAGES,
  CODE_TTL_SECONDS,
  RESEND_COOLDOWN_SECONDS,
  RESET_GRANT_TTL_SECONDS,
  forgotSchema,
  logoutSchema,
  magicConsumeSchema,
  magicRequestSchema,
  refreshSchema,
  resendCodeSchema,
  resetCodeSchema,
  resetNewPasswordSchema,
  signInSchema,
  signUpSchema,
  verifyCodeSchema,
} from '@rowta/shared';
import { registerPost } from '../http/routes.ts';
import { HttpError, ok } from '../middleware/error.ts';
import * as service from './service.ts';

type ZodIssue = z.ZodError['issues'][number];

/** Field-level catalog/validation codes for a 422 (V3, V5). Values are codes, never raw text. */
function fieldCode(issue: ZodIssue, field: string | undefined): string {
  if (issue.code === 'unrecognized_keys') return 'validation.unknown_field';
  // A field that is not there at all: the same code for every route (V3).
  if (issue.code === 'invalid_type') return 'auth.field.required';
  switch (field) {
    case 'email':
      return 'auth.email.invalid';
    case 'country':
      return 'validation.country';
    case 'code':
      return 'auth.ready.code';
    case 'confirm':
      if (issue.code === 'custom') return 'auth.password.mismatch';
      return issue.code === 'too_small'
        ? 'auth.password.tooShort'
        : issue.code === 'too_big'
          ? 'auth.password.tooLong'
          : 'validation.invalid';
    case 'password':
    case 'newPassword':
      if (issue.code === 'too_small') return 'auth.password.tooShort';
      if (issue.code === 'too_big') return 'auth.password.tooLong';
      return 'validation.invalid';
    case 'displayName':
      if (issue.code === 'too_small') return 'auth.name.required';
      if (issue.code === 'too_big') return 'auth.name.tooLong';
      if (issue.code === 'custom') return 'validation.name_invalid';
      return 'validation.invalid';
    default:
      if (issue.code === 'too_small') return 'auth.field.required';
      if (issue.code === 'too_big') return 'validation.too_long';
      return 'validation.invalid';
  }
}

/** Parse a request body with a shared schema; failures become ONE 422 with per-field codes. */
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
  if (userId === undefined) throw new HttpError(401, 'auth.not_authenticated', 'Not authenticated.');
  return userId;
}

function codeTimers(): Record<string, number> {
  return { expiresInSeconds: CODE_TTL_SECONDS, resendInSeconds: RESEND_COOLDOWN_SECONDS };
}

export function createAuthRouter(): Hono {
  const router = new Hono();

  // ---- Sign up with code ------------------------------------------------------------------------
  registerPost(router, '/auth/signup', { limits: ['signup.ip', 'signup.email'] }, async (c) => {
    const input = parseInput(signUpSchema, c.get('parsedBody'));
    const result = await service.signUp(input);
    return c.json(ok(result, codeTimers()));
  });

  registerPost(router, '/auth/signup/verify', { limits: ['code.ip'] }, async (c) => {
    const input = parseInput(verifyCodeSchema, c.get('parsedBody'));
    const tokens = await service.verifyCode(input);
    return c.json(ok(tokens));
  });

  registerPost(router, '/auth/signup/resend', { limits: ['signup.ip', 'signup.email'] }, async (c) => {
    const input = parseInput(resendCodeSchema, c.get('parsedBody'));
    const result = await service.resendSignupCode(input);
    return c.json(ok(result, codeTimers()));
  });

  // ---- Sign in ---------------------------------------------------------------------------------
  registerPost(
    router,
    '/auth/signin',
    { limits: ['signin.ip', 'signin.email', 'signin.both'] },
    async (c) => {
      const input = parseInput(signInSchema, c.get('parsedBody'));
      const result = await service.signIn(input);
      if ('tokens' in result) return c.json(ok(result.tokens));
      // Correct password on an unverified email: the uniform "check your email" prompt (8.1).
      return c.json(ok({ message: result.message }, codeTimers()));
    },
  );

  // ---- Sessions --------------------------------------------------------------------------------
  registerPost(router, '/auth/refresh', { limits: ['refresh.ip', 'refresh.device'] }, async (c) => {
    const input = parseInput(refreshSchema, c.get('parsedBody'));
    const tokens = await service.refresh(input);
    return c.json(ok(tokens));
  });

  registerPost(router, '/auth/logout', { limits: ['logout.user'], auth: true }, async (c) => {
    const input = parseInput(logoutSchema, c.get('parsedBody'));
    const result = await service.logout(input, requireUserId(c));
    return c.json(ok(result));
  });

  registerPost(router, '/auth/logout-all', { limits: ['logout.user'], auth: true }, async (c) => {
    const result = await service.logoutAll(requireUserId(c));
    return c.json(ok(result));
  });

  // ---- Forgot password --------------------------------------------------------------------------
  registerPost(router, '/auth/forgot', { limits: ['forgot.ip', 'forgot.email'] }, async (c) => {
    const input = parseInput(forgotSchema, c.get('parsedBody'));
    const result = await service.requestResetCode(input);
    return c.json(ok(result, codeTimers()));
  });

  registerPost(router, '/auth/forgot/resend', { limits: ['forgot.ip', 'forgot.email'] }, async (c) => {
    const input = parseInput(forgotSchema, c.get('parsedBody'));
    const result = await service.requestResetCode(input);
    return c.json(ok(result, codeTimers()));
  });

  registerPost(router, '/auth/forgot/verify', { limits: ['code.ip'] }, async (c) => {
    const input = parseInput(resetCodeSchema, c.get('parsedBody'));
    const result = await service.verifyResetCode(input);
    return c.json(ok(result, { expiresInSeconds: RESET_GRANT_TTL_SECONDS }));
  });

  registerPost(router, '/auth/reset', { limits: ['reset.ip', 'reset.grant'] }, async (c) => {
    const input = parseInput(resetNewPasswordSchema, c.get('parsedBody'));
    const result = await service.resetNewPassword(input);
    return c.json(ok(result));
  });

  // ---- Magic link -------------------------------------------------------------------------------
  registerPost(router, '/auth/magic/request', { limits: ['magicRequest.ip', 'magicRequest.email'] }, async (c) => {
    const input = parseInput(magicRequestSchema, c.get('parsedBody'));
    const result = await service.magicRequest(input);
    return c.json(ok(result));
  });

  // Consume is POST-only by construction: the token is a button press, never a GET (A13, 8.1).
  registerPost(router, '/auth/magic/consume', { limits: ['magicConsume.ip', 'magicConsume.token'] }, async (c) => {
    const input = parseInput(magicConsumeSchema, c.get('parsedBody'));
    const tokens = await service.magicConsume(input);
    return c.json(ok(tokens));
  });

  // Keep the catalog import honest: routes only ever return catalog text for failures (A6).
  void AUTH_MESSAGES;

  return router;
}
