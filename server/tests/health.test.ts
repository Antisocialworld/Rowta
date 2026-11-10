// Health routes (skill rowta-server-foundation-recipes section 9). Runs against the real local
// Docker Redis and PostgreSQL from docker-compose.yml, which the Phase 0 gate requires to be up.
import { afterAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createHealthRoutes } from '../src/health/router.ts';
import { requestIdMiddleware } from '../src/middleware/request-id.ts';
import { createErrorHandler, createNotFoundHandler } from '../src/middleware/error.ts';
import { createRedisConnection } from '../src/jobs/queues.ts';
import { closeAllDatabases } from '../src/db/clients.ts';
import { logger } from '../src/lib/logger.ts';

const redis = createRedisConnection(false);

function app(): Hono {
  const a = new Hono();
  a.use('*', requestIdMiddleware);
  a.route('/health', createHealthRoutes({ redis }));
  a.onError(createErrorHandler(logger.child({ test: 'health' })));
  a.notFound(createNotFoundHandler());
  return a;
}

afterAll(async () => {
  await redis.quit().catch(() => undefined);
  await closeAllDatabases();
});

describe('health', () => {
  it('GET /health is public, cheap and leaks nothing', async () => {
    const res = await app().request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string; uptimeSeconds: number } };
    expect(body.data.status).toBe('ok');
    expect(typeof body.data.uptimeSeconds).toBe('number');
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/postgres|redis:\/\//i);
    expect(text).not.toMatch(/password|secret|token/i);
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('GET /health/deep reports each dependency as pass/fail only across all four dependencies', async () => {
    // Ensure clean state: delete test worker liveness key
    const livenessKey = 'test:worker:liveness';
    await redis.del(livenessKey);

    const res = await app().request('/health/deep');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { status: string; dependencies: { name: string; pass: boolean }[] };
    };
    const names = body.data.dependencies.map((d) => d.name).sort();
    expect(names).toEqual(['db0', 'db1', 'redis', 'worker']);
    for (const dep of body.data.dependencies) expect(typeof dep.pass).toBe('boolean');

    // Worker key missing => worker pass is false, status is degraded, but HTTP status is 200
    const workerDep = body.data.dependencies.find((d) => d.name === 'worker');
    expect(workerDep?.pass).toBe(false);
    expect(body.data.status).toBe('degraded');

    // Body contains no timestamp, URL, version, or error text
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/timestamp|time|date/i);
    expect(text).not.toMatch(/postgres|redis:\/\//i);
    expect(text).not.toMatch(/password|secret|token|error/i);
  });

  it('GET /health/deep reports status ok when worker liveness key is present', async () => {
    const livenessKey = 'test:worker:liveness';
    try {
      await redis.set(livenessKey, '1', 'EX', 60);

      const res = await app().request('/health/deep');
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: { status: string; dependencies: { name: string; pass: boolean }[] };
      };
      expect(body.data.status).toBe('ok');
      const workerDep = body.data.dependencies.find((d) => d.name === 'worker');
      expect(workerDep?.pass).toBe(true);
      expect(body.data.dependencies.every((d) => d.pass)).toBe(true);
    } finally {
      await redis.del(livenessKey);
    }
  });

  it('an unknown path returns the 404 envelope, not a stack trace', async () => {
    const res = await app().request('/nope');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe('not.found');
    expect(body.error.requestId).toBeTruthy();
    expect(JSON.stringify(body)).not.toMatch(/\.ts:|node_modules|Error:/);
  });
});
