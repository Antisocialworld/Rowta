// Expire-invites cron job (PRD 8.11, rule J2; skill rowta-teams-roles-recipes).
// Runs hourly at minute 5 (5 * * * *).
// Iterates ALL_SHARDS, finds pending invites past expiry (accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= now),
// and marks them expired by setting revoked_at = now().
// Batched, idempotent, concurrency-safe with FOR UPDATE SKIP LOCKED.
// Never logs tokens, emails, or names (rules S1, S9).
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { writeDb } from '../db/clients.ts';
import { ALL_SHARDS, type Shard } from '../db/shard.ts';
import { getQueue } from '../jobs/queues.ts';
import { logger } from '../lib/logger.ts';
import { withLock } from './lock.ts';

const log = logger.child({ module: 'cron', job: 'expire-invites' });

export const EXPIRE_INVITES_JOB_NAME = 'expire-invites';
export const EXPIRE_INVITES_SCHEDULER_ID = 'expire-invites-scheduler';
export const EXPIRE_INVITES_LOCK_KEY = 'cron:lock:expire-invites';
export const EXPIRE_INVITES_LOCK_TTL_SECONDS = 300;

export interface ExpireInvitesOptions {
  batchSize?: number;
  now?: Date;
  maxBatchesPerShard?: number;
}

export interface ExpireInvitesResult {
  expiredCount: number;
  shards: Record<Shard, number>;
}

/**
 * Scan all shards and mark expired pending invites.
 * Uses FOR UPDATE SKIP LOCKED to ensure multiple concurrent runs or workers
 * do not double-process rows or lock contention.
 */
export async function runExpireInvites(options: ExpireInvitesOptions = {}): Promise<ExpireInvitesResult> {
  const batchSize = Math.max(1, Math.min(options.batchSize ?? 100, 1000));
  const now = options.now ?? new Date();
  const maxBatches = options.maxBatchesPerShard ?? 50;

  const shardsResult: Record<Shard, number> = { 0: 0, 1: 0 };
  let totalExpired = 0;

  for (const shard of ALL_SHARDS) {
    const client = writeDb(shard);
    let shardExpired = 0;

    for (let batch = 0; batch < maxBatches; batch++) {
      // Find open invites past expiration time: accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= now
      const expiredRows = await client.$queryRaw<{ id: string }[]>`
        SELECT id::text
        FROM invites
        WHERE accepted_at IS NULL
          AND revoked_at IS NULL
          AND expires_at <= ${now}
        ORDER BY expires_at ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED;
      `;

      if (expiredRows.length === 0) {
        break;
      }

      const ids = expiredRows.map((r) => r.id);
      const updated = await client.$executeRaw`
        UPDATE invites
        SET revoked_at = ${now}
        WHERE id = ANY(${ids}::uuid[])
          AND accepted_at IS NULL
          AND revoked_at IS NULL;
      `;

      shardExpired += updated;

      if (expiredRows.length < batchSize) {
        break;
      }
    }

    shardsResult[shard] = shardExpired;
    totalExpired += shardExpired;
    log.info({ shard, count: shardExpired }, 'Expired invites processed on shard');
  }

  log.info({ totalExpired, shards: shardsResult }, 'expire-invites completed');
  return { expiredCount: totalExpired, shards: shardsResult };
}

/**
 * Run expire-invites wrapped in a distributed Redis lock.
 * If another worker already holds the lock, skips execution gracefully.
 */
export async function runExpireInvitesWithLock(
  redis: Redis,
  options: ExpireInvitesOptions = {},
): Promise<{ ran: boolean; result?: ExpireInvitesResult }> {
  return withLock(redis, EXPIRE_INVITES_LOCK_KEY, EXPIRE_INVITES_LOCK_TTL_SECONDS, () =>
    runExpireInvites(options),
  );
}

/**
 * Register BullMQ repeatable scheduler on the purge queue.
 * Uses upsertJobScheduler for idempotent registration across worker instances.
 */
export async function registerExpireInvitesScheduler(queue?: Queue): Promise<void> {
  const targetQueue = queue ?? getQueue('purge');
  await targetQueue.upsertJobScheduler(
    EXPIRE_INVITES_SCHEDULER_ID,
    // PRD 8.11: 5 * * * * (hourly at minute 5)
    { pattern: '5 * * * *' },
    { name: EXPIRE_INVITES_JOB_NAME, data: { entryName: 'expire-invites' } },
  );
}

