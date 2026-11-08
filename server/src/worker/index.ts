// Worker process entry (skill rowta-jobs-worker-recipes sections 1, 4, 7).
//
// This is a SEPARATE process from the web server (src/index.ts). It:
//   1. connects to Redis once with the worker-required options (maxRetriesPerRequest: null),
//   2. registers one processor per queue,
//   3. starts node-cron ONLY when CRON_ENABLED is true,
//   4. shuts down gracefully on SIGTERM: stop cron, close workers (in-flight jobs finish), close
//      queues and Redis, then exit.
//
// Every attempt writes one structured log line: queue, job ID, attempt number, outcome, duration (J1).
import { Worker, type Job } from 'bullmq';
import { env } from '../config/env.ts';
import { logger } from '../lib/logger.ts';
import { closeAllDatabases } from '../db/clients.ts';
import { closeAllQueues, createRedisConnection, getQueue, QUEUE_NAMES, QUEUE_PREFIX, type QueueName } from '../jobs/queues.ts';
import { startCron } from '../cron/registry.ts';
import { processEmailJob } from '../jobs/email/processor.ts';
import type { EmailJobData } from '../jobs/email/types.ts';
import { processWebhookJob } from '../jobs/webhook-processor.ts';
import { processGraceReminder } from '../billing/renewal-processor.ts';
import {
  processAccountRenewalJob,
  processAccountGraceReminder,
  processAccountYearlyReminder,
  processAccountTrialEnd,
} from '../billing/account-renewal-processor.ts';
import { runPurgeIdempotency, runPurgeTokens } from '../jobs/purge/processor.ts';
import { runRepairUserTeamIndex } from '../jobs/repair/user-team-index.ts';
import { processPushJob, registerSweeperRepeatableJob } from '../notifications/outbox.ts';
import { registerExpireInvitesScheduler, runExpireInvites } from '../cron/expire-invites.ts';
import { registerPushReceiptsScheduler, runCheckPushReceipts } from '../cron/push-receipts.ts';
import { startWorkerLiveness } from './liveness.ts';
import { sweepExpiredMoves } from '../jobs/sweep-expired-moves.ts';

const log = logger.child({ process: 'worker' });

/**
 * Phase 0 processors. Each real queue gets its real work in a later phase; until then a job on a
 * real queue is acknowledged with a log line so a stray enqueue cannot silently pile up.
 * The `foundation` queue proves the path end to end by writing a short-TTL Redis key the tests read.
 */
async function foundationPing(job: Job<{ pingId: string }>): Promise<{ pingId: string }> {
  const pingId = job.data.pingId;
  if (typeof pingId !== 'string' || pingId.length === 0 || pingId.length > 128) {
    throw new Error('foundation.ping requires a pingId string of 1..128 characters');
  }
  const redis = createRedisConnection(false);
  try {
    await redis.set(`foundation:ping:${pingId}`, new Date().toISOString(), 'EX', 120);
  } finally {
    await redis.quit().catch(() => undefined);
  }
  return { pingId };
}

async function heartbeat(job: Job<{ entryName: string; windowStart: number }>): Promise<{ entryName: string }> {
  log.info({ jobId: job.id, entryName: job.data.entryName }, 'heartbeat tick');
  return { entryName: job.data.entryName };
}

async function acknowledgeOnly(job: Job): Promise<{ jobId: string | undefined }> {
  log.info({ queue: job.queueName, jobId: job.id }, 'job acknowledged; real work lands in a later phase');
  return { jobId: job.id };
}

async function processPurge(job: Job): Promise<unknown> {
  if (job.name === 'purge-tokens') {
    return runPurgeTokens({ dryRunFirst: true });
  }
  if (job.name === 'purge-idempotency') {
    return runPurgeIdempotency({ dryRunFirst: true });
  }
  if (job.name === 'repair-user-team-index') {
    return runRepairUserTeamIndex();
  }
  if (job.name === 'expire-invites') {
    return runExpireInvites();
  }
  if (job.name === 'sweep-expired-moves') {
    return sweepExpiredMoves();
  }
  return acknowledgeOnly(job);
}

const PROCESSORS: Record<QueueName, (job: Job) => Promise<unknown>> = {
  foundation: (job) => {
    if (job.name === 'ping') return foundationPing(job as Job<{ pingId: string }>);
    if (job.name === 'heartbeat') return heartbeat(job as Job<{ entryName: string; windowStart: number }>);
    return acknowledgeOnly(job);
  },
  push: (job) => {
    if (job.name === 'check-push-receipts') {
      return runCheckPushReceipts();
    }
    return processPushJob(job);
  },
  webhook: (job) => {
    if (job.name === 'process-webhook') {
      return processWebhookJob(job as Job<{ txRef: string; eventType: string; providerAmount?: number; providerCurrency?: string }>);
    }
    return acknowledgeOnly(job);
  },
  // The email processor GENERATES the 6-digit code / link token itself and stores its Argon2id
  // hash, so no secret ever sits in a job payload (J3, C2). It also decides send vs no-send
  // (A6): the request path only enqueues.
  email: (job) => processEmailJob(job as Job<EmailJobData>),
  renewal: (job) => {
    // Old per-team renewal disabled at C7 (account-level renewal replaces it).
    if (job.name === 'process-renewal') {
      return acknowledgeOnly(job);
    }
    if (job.name === 'process-grace-reminder') {
      return processGraceReminder(job as Job<{ teamId: string }>);
    }
    if (job.name === 'process-account-renewal') {
      return processAccountRenewalJob(job as Job<{ ownerUserId: string; periodEnd: string }>);
    }
    if (job.name === 'process-account-grace-reminder') {
      return processAccountGraceReminder(job as Job<{ ownerUserId: string }>);
    }
    if (job.name === 'process-account-yearly-reminder') {
      return processAccountYearlyReminder(job as Job<{ ownerUserId: string; periodEnd: string }>);
    }
    if (job.name === 'process-account-trial-end') {
      return processAccountTrialEnd(job as Job<{ ownerUserId: string }>);
    }
    return acknowledgeOnly(job);
  },
  purge: processPurge,
};

function createWorkers(): Worker[] {
  // Worker connections require maxRetriesPerRequest: null (BullMQ docs, verified on bullmq@6.3.17).
  const connection = createRedisConnection(true);
  return QUEUE_NAMES.map(
    (name) =>
      new Worker(name, PROCESSORS[name], {
        connection,
        // Defaults come from DEFAULT_JOB_OPTIONS on the Queue; keep the worker in sync explicitly
        // so a job enqueued by a different process still gets the same retry behaviour.
        lockDuration: 30_000,
        prefix: QUEUE_PREFIX,
      }),
  );
}

function wireLogging(workers: Worker[]): void {
  for (const worker of workers) {
    worker.on('completed', (job) => {
      log.info({ queue: job.queueName, jobId: job.id, attempt: job.attemptsMade }, 'job completed');
    });
    worker.on('failed', (job, err) => {
      log.error(
        { queue: job?.queueName, jobId: job?.id, attempt: job?.attemptsMade, err },
        'job failed',
      );
    });
    worker.on('error', (err) => {
      log.error({ err }, 'worker error');
    });
  }
}

async function main(): Promise<void> {
  log.info({ queues: [...QUEUE_NAMES], cronEnabled: env.CRON_ENABLED }, 'worker starting');

  // Worker liveness runs directly in the worker process (independent of CRON_ENABLED).
  const livenessRedis = createRedisConnection(false);
  const liveness = startWorkerLiveness(livenessRedis);

  const workers = createWorkers();
  wireLogging(workers);

  // Touch every queue so a missing Redis connection fails at boot, not on the first job.
  for (const name of QUEUE_NAMES) getQueue(name);

  // Register repeatable jobs on BullMQ (Phase 6 Stage 4 + Stage 5)
  await registerSweeperRepeatableJob();
  await registerExpireInvitesScheduler();
  await registerPushReceiptsScheduler();

  const cronRedis = createRedisConnection(false);
  const cronHandle = env.CRON_ENABLED ? startCron(cronRedis) : null;

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'worker shutting down');

    // Stop liveness and delete heartbeat key immediately on shutdown
    await liveness.stop();
    await livenessRedis.quit().catch(() => undefined);

    cronHandle?.stopAll();
    await cronRedis.quit().catch(() => undefined);

    // close() waits for in-flight jobs before resolving (C8).
    await Promise.all(workers.map((w) => w.close().catch(() => undefined)));
    await closeAllQueues();
    await closeAllDatabases();
    log.info('worker stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    log.fatal({ err: reason }, 'unhandled rejection in worker');
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    log.fatal({ err }, 'uncaught exception in worker');
    process.exit(1);
  });
}

await main();
