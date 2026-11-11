// Health routes (skill rowta-server-foundation-recipes section 9).
//
// GET /health        — process is up. Public, cheap, no dependency touched, no versions/paths/secrets.
// GET /health/deep   — per-dependency reachability (redis, db0, db1), each reported as pass/fail
//                      only. The deep route returns no host, URL, version or error text, so it is
//                      safe to expose behind the same firewall as the API; production should still
//                      restrict it to the load balancer (documented in docs/DEPLOY.md later).
import { Hono } from 'hono';
import { globalDb, writeDb, type AnyPrismaClient } from '../db/clients.ts';
import { ok } from '../middleware/error.ts';
import type { AppLogger } from '../lib/logger.ts';

import { checkWorkerLiveness } from '../worker/liveness.ts';

/**
 * Races `promise` against a timer. Returns the promise's boolean result if it settles within
 * `ms` milliseconds, or `false` if it times out or throws. The timer is always cleared so the
 * event loop is never held open by a stale timeout.
 */
export async function withTimeout(promise: Promise<boolean>, ms = 4000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface DependencyReport {
  name: string;
  pass: boolean;
}

export interface DeepHealth {
  status: 'ok' | 'degraded';
  dependencies: DependencyReport[];
}

async function pingRedis(redis: { ping(): Promise<string> }): Promise<boolean> {
  try {
    const reply = await redis.ping();
    return reply === 'PONG';
  } catch {
    return false;
  }
}

async function pingDatabase(client: AnyPrismaClient): Promise<boolean> {
  try {
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/** Run every dependency check. Exported so the worker and tests can reuse it. */
export async function checkDependencies(deps: {
  redis: { ping(): Promise<string>; exists?(key: string): Promise<number> };
}): Promise<DeepHealth> {
  const [redisOk, db0Ok, db1Ok, workerOk] = await Promise.all([
    withTimeout(pingRedis(deps.redis)),
    withTimeout(pingDatabase(globalDb())),
    withTimeout(pingDatabase(writeDb(1))),
    withTimeout(checkWorkerLiveness(deps.redis)),
  ]);
  const dependencies: DependencyReport[] = [
    { name: 'redis', pass: redisOk },
    { name: 'db0', pass: db0Ok },
    { name: 'db1', pass: db1Ok },
    { name: 'worker', pass: workerOk },
  ];
  const status = dependencies.every((d) => d.pass) ? 'ok' : 'degraded';
  return { status, dependencies };
}

export function createHealthRoutes(deps: {
  redis: { ping(): Promise<string>; exists?(key: string): Promise<number> };
  log?: AppLogger;
}): Hono {
  const app = new Hono();

  app.get('/', (c) => c.json(ok({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) })));

  app.get('/deep', async (c) => {
    const report = await checkDependencies(deps);
    // 200 even when degraded: the process is up and answering, and the body says which dependency
    // failed. A 5xx here would make an orchestrator kill a process that is still useful.
    return c.json(ok(report));
  });

  return app;
}
