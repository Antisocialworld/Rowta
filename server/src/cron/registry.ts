// Cron registry (rule J2, PRD 8.11; skill rowta-jobs-worker-recipes section 4).
//
// ONE exported array is the single source for every schedule AND for docs/cron-registry.md
// (the doc is generated from it in a later phase, so the two cannot drift).
//
// node-cron runs ONLY in the worker process and ONLY when CRON_ENABLED is true. Each tick takes a
// Redis lock; if the lock is not acquired the tick returns without doing anything. The tick never
// does the work itself — it enqueues a job, and the job does the work idempotently (C4).
//
// node-cron@4.6.0 API (verified on the installed package README):
//   cron.schedule(expression, task, { name, timezone, noOverlap }) -> Task
//   task.stop() / task.start() / task.destroy()
//   six-field expressions are supported (optional leading seconds field); we pin timezone UTC.
import cron, { type ScheduledTask } from 'node-cron';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { acquireLock, releaseLock } from './lock.ts';
import { getQueue, jobId, type QueueName } from '../jobs/queues.ts';

export interface CronEntry {
  name: string;
  /** Six-field cron expression, UTC. */
  schedule: string;
  /** Redis key for the distributed lock. Keys use colons; job IDs must not. */
  lockKey: string;
  ttlSeconds: number;
  queue: string;
  jobName: string;
}

/**
 * The single source of truth for schedules (PRD 8.11, rules J2, D5).
 * All schedules use 6-field cron expressions pinned to UTC (with leading seconds field).
 */
export const CRON_REGISTRY: readonly CronEntry[] = [
  {
    name: 'foundation-heartbeat',
    // Every hour at minute 0, second 0, UTC.
    schedule: '0 0 * * * *',
    lockKey: 'cron:lock:foundation-heartbeat',
    ttlSeconds: 300,
    queue: 'foundation',
    jobName: 'heartbeat',
  },
  {
    name: 'purge-tokens',
    // PRD 8.11: 30 2 * * * (daily at 02:30 UTC), converted to 6-field node-cron format (second 0).
    schedule: '0 30 2 * * *',
    lockKey: 'cron:lock:purge-tokens',
    ttlSeconds: 600,
    queue: 'purge',
    jobName: 'purge-tokens',
  },
  {
    name: 'purge-idempotency',
    // PRD 8.11: 45 2 * * * (daily at 02:45 UTC), converted to 6-field node-cron format (second 0).
    schedule: '0 45 2 * * *',
    lockKey: 'cron:lock:purge-idempotency',
    ttlSeconds: 600,
    queue: 'purge',
    jobName: 'purge-idempotency',
  },
] as const;

export interface CronHandle {
  tasks: ScheduledTask[];
  stopAll(): void;
}

/**
 * Start every entry in the registry. Call ONLY from the worker, and only when CRON_ENABLED is true.
 * Each tick: take the lock; if acquired, enqueue a job with a window-derived ID and release the lock.
 * The queued job does the work.
 */
export function startCron(redis: Redis, defaultQueue?: Queue): CronHandle {
  const tasks = CRON_REGISTRY.map((entry) =>
    cron.schedule(
      entry.schedule,
      async () => {
        const windowStart = Math.floor(Date.now() / 1_000);
        const lock = await acquireLock(redis, entry.lockKey, entry.ttlSeconds);
        if (!lock) return; // another instance holds the lock
        try {
          // Payload carries IDs and the entry name only — never a secret (J3).
          const queue = entry.queue ? getQueue(entry.queue as QueueName) : defaultQueue!;
          await queue.add(entry.jobName, { entryName: entry.name, windowStart }, { jobId: jobId(entry.name, windowStart) });
        } finally {
          await releaseLock(redis, lock);
        }
      },
      { name: entry.name, timezone: 'UTC', noOverlap: true },
    ),
  );

  return {
    tasks,
    stopAll() {
      // node-cron v4's destroy() returns a promise; this shutdown hook is synchronous by design,
      // so the detached promise is explicitly marked ignored (C8: no floating promises).
      for (const task of tasks) void task.destroy();
    },
  };
}
