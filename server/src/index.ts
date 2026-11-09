// Web server entry (skill rowta-server-foundation-recipes sections 2, 8, 9).
//
// MIDDLEWARE ORDER — a new route MUST NOT skip a layer. Adding a route below the auth line
// without going through the policy function (skill section 5, Phase 2) is a rule violation:
//
//   1. request ID          src/middleware/request-id.ts   (S9)
//   2. structured logger   src/middleware/logger.ts       (one line per request, S9)
//   3. request timeout     hono/timeout                   (C8)
//   4. body-size limit     hono/body-limit                (C8)
//   5. security headers    hono/secure-headers            (S11)
//   6. CORS (two layers, this exact order):
//        6a. dev-only localhost preview allow-list (no credentials; never in production) — MUST
//            run first: hono/cors answers OPTIONS itself without calling next
//        6b. allowlist    hono/cors, from CORS_ALLOWED_ORIGINS, no wildcard (S11)
//   7. per-route rate limit   (Phase 2 — skill rowta-rate-limiting-recipes)
//   8. authentication         (Phase 2 — skill rowta-auth-recipes)
//   9. routes
//  10. ONE error handler   src/middleware/error.ts        (last, PRD 9.3)
//
// node-cron does NOT run here: only the worker schedules jobs (skill rowta-jobs-worker-recipes 10).
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { timeout } from 'hono/timeout';
import { env } from './config/env.ts';
import { assertNotProductionSimulator } from './config/env.ts';
import { createAuthRouter } from './auth/routes.ts';
import { createTeamsRouter } from './teams/routes.ts';
import { createShiftsRouter } from './shifts/routes.ts';
import { createSwapsRouter } from './swaps/routes.ts';
import { createSettingsRouter } from './settings/routes.ts';
import { createDevicesRouter } from './devices/routes.ts';
import { createBillingRouter } from './billing/routes.ts';
import { createAccountRouter } from './billing/account-routes.ts';
import { createMoveRouter } from './billing/move-routes.ts';
import { registerSimulatorRoutes } from './billing/simulator.ts';
import { webhookHandler } from './billing/webhook.ts';
import { AI_CRAWLER_TOKENS } from '@rowta/shared';
import { getDummyHash } from './security/argon2.ts';
import { createRedisConnection } from './jobs/queues.ts';
import { createHealthRoutes } from './health/router.ts';
import { createErrorHandler, createNotFoundHandler } from './middleware/error.ts';
import { requestIdMiddleware } from './middleware/request-id.ts';
import { logger, type AppLogger } from './lib/logger.ts';
import { closeAllDatabases } from './db/clients.ts';

const REQUEST_TIMEOUT_MS = 15_000;
const BODY_LIMIT_BYTES = 256 * 1024;

const allowedOrigins = env.CORS_ALLOWED_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter((o) => o.length > 0);

// Dev-only preview origins (Phase 2 app views): the Expo web preview runs on a localhost port that
// is not (and need not be) in CORS_ALLOWED_ORIGINS. No wildcard and NO credentials for these
// entries (S11): the app authenticates with a Bearer token, never cookies, so
// Access-Control-Allow-Credentials is deliberately never sent for a localhost preview origin.
// Production (NODE_ENV=production) gets NONE of this — only the configured allow-list.
const DEV_PREVIEW_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;

/** Pure predicate so a test can prove production never matches (exported for tests/cors-dev.test.ts). */
export function isDevPreviewOrigin(origin: string, nodeEnv: string): boolean {
  return nodeEnv !== 'production' && DEV_PREVIEW_ORIGIN.test(origin);
}

export interface AppDeps {
  log: AppLogger;
  redis: { ping(): Promise<string>; exists?(key: string): Promise<number> };
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  // 1. Request ID — sets c.get('requestId') and the x-request-id response header.
  app.use('*', requestIdMiddleware);

  // 2. Structured request log: request ID, user ID when known (never email), route, status, ms.
  app.use('*', async (c, next) => {
    const started = Date.now();
    await next();
    const userId = c.get('userId'); // set by the auth middleware in Phase 2; undefined for now
    deps.log.info(
      {
        requestId: c.get('requestId'),
        userId: typeof userId === 'string' ? userId : undefined,
        method: c.req.method,
        // Log the route PATTERN, not the raw path, so a UUID in a URL never lands in the logs.
        route: c.req.routePath ?? c.req.path,
        status: c.res.status,
        durationMs: Date.now() - started,
      },
      'request',
    );
  });

  // 3. Timeout — throws HTTPException(504), mapped by the error handler.
  app.use('*', timeout(REQUEST_TIMEOUT_MS));

  // 4. Body limit — throws HTTPException(413), mapped by the error handler.
  app.use('*', bodyLimit({ maxSize: BODY_LIMIT_BYTES }));

  // 5. Security headers.
  app.use('*', secureHeaders());

  // 6a. Dev-only localhost preview allow-list (see isDevPreviewOrigin above): a localhost origin
  //     that is NOT in CORS_ALLOWED_ORIGINS is allowed WITHOUT credentials and without wildcard,
  //     only when NODE_ENV !== 'production'. Registered BEFORE hono/cors (6b) because hono/cors
  //     answers OPTIONS itself and never calls next(), so a preflight would never reach a layer
  //     below it. An env-listed origin skips straight to 6b and keeps the credentials behaviour.
  if (env.NODE_ENV !== 'production') {
    app.use(
      '*',
      async (c, next): Promise<Response | void> => {
        const origin = c.req.header('origin');
        if (origin === undefined || allowedOrigins.includes(origin) || !isDevPreviewOrigin(origin, env.NODE_ENV)) {
          await next();
          return;
        }
        if (c.req.method === 'OPTIONS') {
          // Preflight for the web preview: answered here, no Access-Control-Allow-Credentials by
          // design. Built from c.res.headers so prepared headers (x-request-id) are carried over,
          // exactly as hono/cors builds its own preflight.
          const headers = new Headers(c.res.headers);
          headers.set('access-control-allow-origin', origin);
          headers.set('access-control-allow-methods', 'GET, POST, OPTIONS');
          headers.set('access-control-allow-headers', 'content-type, authorization, idempotency-key, x-request-id');
          headers.set('access-control-max-age', '600');
          headers.set('vary', 'origin');
          return new Response(null, { status: 204, headers });
        }
        await next();
        c.res.headers.set('access-control-allow-origin', origin);
        // hono/cors sets Access-Control-Allow-Credentials unconditionally (verified against the
        // installed hono source); a preview origin must never carry it (S11).
        c.res.headers.delete('access-control-allow-credentials');
        return;
      },
    );
  }

  // 6b. CORS allowlist. No wildcard; credentials on; x-request-id exposed to the client.
  app.use(
    '*',
    cors({
      origin: (origin) => (allowedOrigins.includes(origin) ? origin : null),
      credentials: true,
      exposeHeaders: ['x-request-id'],
      allowHeaders: ['content-type', 'authorization', 'idempotency-key', 'x-request-id'],
    }),
  );

  // 6c. AI crawler deny list. Blocks known AI crawler user agents from the API
  //     before routing. Never affects the Rowta app (React Native/Expo user agents),
  //     the payment webhook, or health checks.
  app.use('*', async (c, next) => {
    const path = c.req.path;
    // Never block the payment webhook or health checks.
    if (path === '/webhook' || path === '/health' || path.startsWith('/health/')) {
      await next();
      return;
    }
    const ua = (c.req.header('user-agent') ?? '').toLowerCase();
    if (AI_CRAWLER_TOKENS.some((token) => new RegExp(`\\b${token.toLowerCase()}\\b`).test(ua))) {
      return c.json(
        { error: { code: 'generic.error', message: 'Forbidden', requestId: c.get('requestId') ?? '' } },
        403,
      );
    }
    await next();
  });

  // 7./8. Per-route rate limits and authentication are registered PER ROUTE by
  //       src/http/routes.ts (each route declares its limit ids; auth runs after body parsing).
  //       The chain inside a route is always limits -> body -> auth -> handler (skill
  //       rowta-rate-limiting-recipes; walk test in tests/route-limits.test.ts).

  // 9. Routes.
  app.route('/', createAuthRouter());
  app.route('/', createTeamsRouter());
  app.route('/', createShiftsRouter());
  app.route('/', createSwapsRouter());
  app.route('/', createSettingsRouter());
  app.route('/', createDevicesRouter());
  app.route('/', createBillingRouter());
  app.route('/', createAccountRouter());
  app.route('/', createMoveRouter());
  // Old per-team hand-over routes retired at C7 in favour of account-level move (/teams/:teamId/billing/move/*).
  // server/src/billing/handover-routes.ts and server/src/billing/handover.ts remain as legacy code.
  // Simulator routes: only mounted when PAYMENT_SIMULATOR_ENABLED=true.
  // The server boot guard (assertNotProductionSimulator) ensures this is never reached in production.
  if (env.PAYMENT_SIMULATOR_ENABLED) {
    registerSimulatorRoutes(app);
  }
  app.route('/health', createHealthRoutes({ redis: deps.redis }));

  // Public webhook endpoint: no auth — signature over the raw body is the authorization.
  // Registered directly (not via registerPost) so the raw body can be read for signature verification.
  app.post('/webhook', webhookHandler);

  // 10. ONE error handler, plus the 404 handler. Nothing else formats an error body.
  app.onError(createErrorHandler(deps.log));
  app.notFound(createNotFoundHandler());

  return app;
}

async function main(): Promise<void> {
  const log = logger.child({ process: 'api' });
  // Build the dummy Argon2id hash once at boot (A7): the first unknown-email sign-in then never
  // pays an extra Argon2 run while real ones are still warming up (timing parity by construction).
  await getDummyHash();
  // P7 boot guard (explicit at the entry point, in addition to env.ts loadEnv()):
  // the dev-only payment simulator must never run against production.
  assertNotProductionSimulator(env);

  if (!process.env.FLW_WEBHOOK_SECRET_HASH || process.env.FLW_WEBHOOK_SECRET_HASH.trim().length === 0) {
    log.fatal(
      'Missing required environment variable: FLW_WEBHOOK_SECRET_HASH. Set it in your .env file (e.g. FLW_WEBHOOK_SECRET_HASH=<secret-hash>).'
    );
    process.exit(1);
  }
  const redis = createRedisConnection(false);
  const app = createApp({ log, redis });

  const server = serve({ fetch: app.fetch, port: env.API_PORT }, (info) => {
    log.info({ port: info.port }, 'api listening');
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'api shutting down');
    // Stop accepting new connections, let in-flight requests finish, then close dependencies (C8).
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await redis.quit().catch(() => undefined);
    await closeAllDatabases();
    log.info('api stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason: unknown) => {
    const err = (reason instanceof Error ? reason : { name: String(reason).slice(0, 100), message: String(reason).slice(0, 300), stack: undefined as string | undefined }) as { name: string; code?: unknown; stack?: string; message?: string };
    const logEntry: Record<string, unknown> = {
      name: err.name,
      ...(err.code ? { errorCode: err.code } : {}),
      ...(err.stack ? { stack: err.stack } : {}),
    };
    if (!String(err.name).startsWith('Prisma') && err.message) {
      logEntry.message = String(err.message).slice(0, 300);
    }
    log.fatal(logEntry, 'unhandled rejection in api');
    process.exit(1);
  });
  process.on('uncaughtException', (err: Error & { code?: unknown }) => {
    const logEntry: Record<string, unknown> = {
      name: err.name,
      ...(err.code ? { errorCode: err.code } : {}),
      ...(err.stack ? { stack: err.stack } : {}),
    };
    if (!err.name.startsWith('Prisma') && err.message) {
      logEntry.message = err.message.slice(0, 300);
    }
    log.fatal(logEntry, 'uncaught exception in api');
    process.exit(1);
  });
}

// Only boot the listener when this module is the process entry (tests import createApp instead).
const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntryPoint) {
  await main();
}
