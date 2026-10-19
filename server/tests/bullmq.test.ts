// BullMQ end to end: enqueue a test job on the foundation queue, run an in-process worker with the
// same processor the real worker registers, and observe the short-TTL Redis key the job writes
// (Phase 0 gate: "BullMQ test job"). Job IDs follow skill section 3: no colon, not digits-only.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Worker, type Job } from 'bullmq';
import { closeAllQueues, createRedisConnection, getQueue, jobId } from '../src/jobs/queues.ts';
import { closeAllDatabases } from '../src/db/clients.ts';

const workerConnection = createRedisConnection(true);
const producerConnection = createRedisConnection(false);

// The same processor the real worker registers for foundation.ping (src/worker/index.ts).
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

let worker: Worker;

beforeAll(async () => {
  worker = new Worker('foundation', foundationPing, { connection: workerConnection, lockDuration: 30_000 });
  // Fail loudly instead of timing out if the worker cannot boot.
  await new Promise<void>((resolve, reject) => {
    const onReady = () => {
      worker.off('error', onError);
      resolve();
    };
    const onError = (err: Error) => {
      worker.off('ready', onReady);
      reject(err);
    };
    worker.once('ready', onReady);
    worker.once('error', onError);
  });
});

afterAll(async () => {
  await worker?.close().catch(() => undefined);
  await closeAllQueues();
  await producerConnection.quit().catch(() => undefined);
  await closeAllDatabases();
});

describe('BullMQ foundation queue', () => {
  it('a test job runs and writes the short-TTL Redis key', async () => {
    const pingId = randomUUID();
    const queue = getQueue('foundation');
    await queue.add('ping', { pingId }, { jobId: jobId('foundation-ping', Math.floor(Date.now() / 1000)) });

    const key = `foundation:ping:${pingId}`;
    const deadline = Date.now() + 15_000;
    let value: string | null = null;
    while (Date.now() < deadline) {
      value = await producerConnection.get(key);
      if (value !== null) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(value).not.toBeNull();
    expect(Number.isNaN(Date.parse(value as string))).toBe(false);

    const ttl = await producerConnection.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120);
  });

  it('job IDs never contain a colon and are never digits-only', () => {
    const id = jobId('renewals-due', 1_760_000_000);
    expect(id).toBe('renewals-due-1760000000');
    expect(id).not.toContain(':');
    expect(id).not.toMatch(/^\d+$/);
  });

  it('jobId rejects a colon', () => {
    expect(() => jobId('a:b', 1)).toThrow(/colon/);
  });

  it('every queue exposes the J1 defaults', async () => {
    const queue = getQueue('foundation');
    const opts = queue.defaultJobOptions;
    expect(opts.attempts).toBe(5);
    expect(opts.backoff).toMatchObject({ type: 'exponential' });
    expect(opts.removeOnFail).toBeTruthy();
    expect(opts.removeOnComplete).toBeTruthy();
  });
});
