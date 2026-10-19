// BullMQ queue layer (skill rowta-jobs-worker-recipes sections 1-3; PRD 9.8).
//
// Queues (PRD 9.8): push, webhook, email, renewal, purge. Phase 0 adds a sixth `foundation` queue
// that proves the worker path end to end (Phase 2 sends real email from a job).
//
// Queue defaults (J1): 5 attempts, exponential backoff, failed jobs kept for inspection, completed
// jobs trimmed by age. Payloads hold IDs only, never secrets (J3).
//
// Connection notes, verified against docs.bullmq.io/guide/connections and the installed bullmq@6.3.17:
//   - Worker connections MUST set maxRetriesPerRequest: null or BullMQ throws at construction.
//   - Queue (producer) connections keep the Redis default so a dead Redis fails fast.
//   - Redis must run with maxmemory-policy=noeviction (the local Docker Redis uses the default,
//     which is noeviction; recorded in docs/ARCHITECTURE.md in a later phase).
import { Queue, type JobsOptions, type QueueOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env.ts';

export const QUEUE_NAMES = ['push', 'webhook', 'email', 'renewal', 'purge', 'foundation'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

/** Shared job defaults (J1). Every queue uses these unless it passes its own. */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1_000 },
  // Keep completed jobs for an hour so a cron window can still see its own job ID (skill 3).
  removeOnComplete: { age: 3_600, count: 1_000 },
  // Keep failed jobs for a day for inspection (J1); a later phase adds the admin script.
  removeOnFail: { age: 86_400 },
};

/** Producer/queue connection: Redis defaults (maxRetriesPerRequest 20). */
export function createRedisConnection(forWorker = false): Redis {
  return new Redis(env.REDIS_URL, {
    // BullMQ requires null on worker connections; leave the producer at the library default.
    maxRetriesPerRequest: forWorker ? null : undefined,
  });
}

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  const existing = queues.get(name);
  if (existing) return existing;
  const created = new Queue(name, {
    connection: createRedisConnection(false),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  } satisfies QueueOptions);
  queues.set(name, created);
  return created;
}

export async function closeAllQueues(): Promise<void> {
  const open = [...queues.values()];
  queues.clear();
  await Promise.all(open.map((q) => q.close().catch(() => undefined)));
}

/**
 * A job ID must NOT contain a colon and must NOT be only digits (skill section 3).
 * Shape: `<name>-<epochSeconds>` e.g. `renewals-due-1760000000`.
 */
export function jobId(name: string, windowStartEpochSeconds: number): string {
  const id = `${name}-${windowStartEpochSeconds}`;
  if (id.includes(':')) throw new Error(`job ID must not contain a colon: ${id}`);
  if (/^\d+$/.test(id)) throw new Error(`job ID must not be only digits: ${id}`);
  return id;
}
