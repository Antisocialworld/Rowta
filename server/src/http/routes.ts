// Route registration helper (skill rowta-rate-limiting-recipes section 1; rules S14, C2).
//
// Every route is declared HERE with its limit ids, so a route without a limiter cannot be added
// without the registry noticing: a test walks registeredRoutes() and fails on any route with no
// limit id. The chain order per route is fixed by this helper:
//
//   pre limits (IP keys, before any body read) -> parse body once -> body limits (keys from the
//   body, still before authentication) -> authentication (when the route needs it) -> post limits
//   (user keys) -> handler.
//
// The body is parsed exactly once and stored on the context (`parsedBody`), so the limiter and the
// handler share one parse and a malformed body gets a clean 400 before anything else runs.
import type { Handler, Hono, MiddlewareHandler } from 'hono';
import { HttpError } from '../middleware/error.ts';
import { limitFor } from '../security/rate-limit.ts';
import { limitDef } from '../security/limits.ts';
import { requireAuth } from '../auth/middleware.ts';

export interface RouteRegistration {
  readonly method: 'POST' | 'GET';
  readonly path: string;
  readonly limitIds: readonly string[];
  readonly auth: boolean;
}
const registry = new Map<string, RouteRegistration>();

/** Every registered route, keyed by `METHOD path`. Health routes are exempt by design (skill 3). */
export function registeredRoutes(): readonly RouteRegistration[] {
  return [...registry.values()];
}

/** Read the body once, store it on the context, reject malformed JSON with 400 (V3). */
const parseBody: MiddlewareHandler = async (c, next) => {
  const raw = await c.req.text();
  if (raw.length === 0) {
    c.set('parsedBody', {});
    await next();
    return;
  }
  try {
    c.set('parsedBody', JSON.parse(raw) as unknown);
  } catch {
    throw new HttpError(400, 'request.malformed', 'Request body is not valid JSON.');
  }
  await next();
};

export interface RouteOptions {
  /** Every limit id this route runs; at least one is required. */
  readonly limits: readonly string[];
  /** When true the route runs requireAuth before the handler (and user-keyed limits). */
  readonly auth?: boolean;
}

/** Register a POST route with its limit chain. Re-registering the same path replaces the entry. */
export function registerPost(
  router: Hono,
  path: string,
  options: RouteOptions,
  handler: Handler,
): void {
  if (options.limits.length === 0) {
    throw new Error(`route POST ${path} has no rate limit id (rule S14)`);
  }
  const wantsAuth = options.auth === true;
  const usesUserKey = options.limits.some((id) => limitDef(id).key === 'user');
  if (usesUserKey && !wantsAuth) {
    throw new Error(`route POST ${path} uses a user-keyed limit but does not require auth`);
  }

  // A tuple (not a plain array) keeps the first middleware visible to Hono's overloads.
  const chain: [MiddlewareHandler, ...MiddlewareHandler[]] = [
    limitFor(options.limits, 'pre'),
    parseBody,
    limitFor(options.limits, 'body'),
  ];
  if (wantsAuth) {
    chain.push(requireAuth, limitFor(options.limits, 'post'));
  }
  chain.push(handler as MiddlewareHandler);

  router.post(path, ...chain);
  registry.set(`POST ${path}`, {
    method: 'POST',
    path,
    limitIds: [...options.limits],
    auth: wantsAuth,
  });
}

/**
 * Register a GET route with the same chain shape as POST (pre limits -> [auth] -> post limits ->
 * handler; GETs carry no body, so there is no body-parse or body-key phase). Re-registering the
 * same path replaces the entry.
 */
export function registerGet(
  router: Hono,
  path: string,
  options: RouteOptions,
  handler: Handler,
): void {
  if (options.limits.length === 0) {
    throw new Error(`route GET ${path} has no rate limit id (rule S14)`);
  }
  const wantsAuth = options.auth === true;
  const usesUserKey = options.limits.some((id) => limitDef(id).key === 'user');
  if (usesUserKey && !wantsAuth) {
    throw new Error(`route GET ${path} uses a user-keyed limit but does not require auth`);
  }

  const chain: [MiddlewareHandler, ...MiddlewareHandler[]] = [limitFor(options.limits, 'pre')];
  if (wantsAuth) {
    chain.push(requireAuth, limitFor(options.limits, 'post'));
  }
  chain.push(handler as MiddlewareHandler);

  router.get(path, ...chain);
  registry.set(`GET ${path}`, {
    method: 'GET',
    path,
    limitIds: [...options.limits],
    auth: wantsAuth,
  });
}
