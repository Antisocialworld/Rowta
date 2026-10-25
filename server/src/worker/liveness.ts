// Worker liveness module (Rule J1, PRD 8.11).
//
// The worker process writes a heartbeat key to Redis every 15 seconds with a 60-second TTL,
// and writes it once immediately on start. On graceful shutdown, it stops the timer and deletes
// the key.
//
// Safety:
//   - Runs directly in the worker process (independent of CRON_ENABLED and cron locks).
//   - A Redis failure is logged as a warning and NEVER crashes the worker.
//   - Uses prefixedKey() so vitest runs do not collide with development/production keys.
import type { Redis } from 'ioredis';
import { logger } from '../lib/logger.ts';
import { prefixedKey } from '../lib/redis-prefix.ts';

const log = logger.child({ module: 'worker-liveness' });

export const WORKER_LIVENESS_BASE_KEY = 'worker:liveness';
export const WORKER_LIVENESS_INTERVAL_MS = 15_000;
export const WORKER_LIVENESS_TTL_SEC = 60;

export function workerLivenessKey(): string {
  return prefixedKey(WORKER_LIVENESS_BASE_KEY);
}

export interface WorkerLivenessHandle {
  stop(): Promise<void>;
  touch(): Promise<boolean>;
}

/**
 * Start the worker liveness heartbeat. Call once when the worker starts.
 */
export function startWorkerLiveness(redis: Redis): WorkerLivenessHandle {
  const key = workerLivenessKey();

  async function touch(): Promise<boolean> {
    try {
      await redis.set(key, '1', 'EX', WORKER_LIVENESS_TTL_SEC);
      return true;
    } catch (err) {
      log.warn({ err, key }, 'failed to write worker liveness key to Redis');
      return false;
    }
  }

  // Write immediately on start
  void touch();

  const timer = setInterval(() => {
    void touch();
  }, WORKER_LIVENESS_INTERVAL_MS);

  timer.unref();

  return {
    async stop() {
      clearInterval(timer);
      try {
        await redis.del(key);
      } catch (err) {
        log.warn({ err, key }, 'failed to delete worker liveness key on shutdown');
      }
    },
    touch,
  };
}

/**
 * Check if the worker is currently alive by verifying existence of the liveness key in Redis.
 */
export async function checkWorkerLiveness(redis: { exists?(key: string): Promise<number> }): Promise<boolean> {
  if (typeof redis.exists !== 'function') return false;
  try {
    const count = await redis.exists(workerLivenessKey());
    return count > 0;
  } catch {
    return false;
  }
}
