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
//   6. CORS allowlist      hono/cors, from CORS_ALLOWED_ORIGINS, no wildcard (S11)
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

export interface AppDeps {
  log: AppLogger;
  redis: { ping(): Promise<string> };
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

  // 6. CORS allowlist. No wildcard; credentials on; x-request-id exposed to the client.
  app.use(
    '*',
    cors({
      origin: (origin) => (allowedOrigins.includes(origin) ? origin : null),
      credentials: true,
      exposeHeaders: ['x-request-id'],
      allowHeaders: ['content-type', 'authorization', 'idempotency-key', 'x-request-id'],
    }),
  );

  // 7. Per-route rate limit — Phase 2. Slot reserved here so the order above stays authoritative.
  // 8. Authentication + policy function — Phase 2. Slot reserved here.

  // 9. Routes.
  app.route('/health', createHealthRoutes({ redis: deps.redis }));

  // 10. ONE error handler, plus the 404 handler. Nothing else formats an error body.
  app.onError(createErrorHandler(deps.log));
  app.notFound(createNotFoundHandler());

  return app;
}

async function main(): Promise<void> {
  const log = logger.child({ process: 'api' });
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
  process.on('unhandledRejection', (reason) => {
    log.fatal({ err: reason }, 'unhandled rejection in api');
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    log.fatal({ err }, 'uncaught exception in api');
    process.exit(1);
  });
}

// Only boot the listener when this module is the process entry (tests import createApp instead).
const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntryPoint) {
  await main();
}
