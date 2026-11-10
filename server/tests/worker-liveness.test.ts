// Worker liveness unit tests (Rule J1, PRD 8.11).
import { afterAll, describe, expect, it } from 'vitest';
import { createRedisConnection } from '../src/jobs/queues.ts';
import {
  checkWorkerLiveness,
  startWorkerLiveness,
  workerLivenessKey,
  WORKER_LIVENESS_TTL_SEC,
} from '../src/worker/liveness.ts';
import { redisKeyPrefix } from '../src/lib/redis-prefix.ts';

const redis = createRedisConnection(false);

afterAll(async () => {
  await redis.del(workerLivenessKey());
  await redis.quit().catch(() => undefined);
});

describe('worker-liveness', () => {
  it('uses the test: prefix under vitest', () => {
    expect(redisKeyPrefix()).toBe('test:');
    expect(workerLivenessKey()).toBe('test:worker:liveness');
  });

  it('immediately writes the liveness key on start with 60s TTL', async () => {
    const handle = startWorkerLiveness(redis);
    try {
      const isAlive = await checkWorkerLiveness(redis);
      expect(isAlive).toBe(true);

      const ttl = await redis.ttl(workerLivenessKey());
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(WORKER_LIVENESS_TTL_SEC);
    } finally {
      await handle.stop();
    }
  });

  it('stops the interval and removes the key on shutdown', async () => {
    const handle = startWorkerLiveness(redis);
    expect(await checkWorkerLiveness(redis)).toBe(true);

    await handle.stop();
    expect(await checkWorkerLiveness(redis)).toBe(false);
  });

  it('a Redis failure in touch() logs a warning and does NOT throw', async () => {
    const failingRedis = {
      set: async () => {
        throw new Error('simulated Redis disconnect');
      },
      del: async () => 1,
    } as unknown as typeof redis;

    // Must not throw an unhandled error
    const handle = startWorkerLiveness(failingRedis);
    const result = await handle.touch();
    expect(result).toBe(false);
    await handle.stop();
  });
});
