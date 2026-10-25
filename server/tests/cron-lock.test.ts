// Redis lock + cron registry (rule J2, skill rowta-jobs-worker-recipes section 4).
// Two concurrent attempts on the same key: exactly one runs. The cron tick enqueues and never does
// the work itself.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { acquireLock, releaseLock, withLock } from '../src/cron/lock.ts';
import { CRON_REGISTRY, startCron } from '../src/cron/registry.ts';
import { createRedisConnection, getQueue, closeAllQueues, jobId } from '../src/jobs/queues.ts';
import { closeAllDatabases } from '../src/db/clients.ts';

const redis = createRedisConnection(false);
const unique = randomUUID();

afterAll(async () => {
  await closeAllQueues();
  await redis.quit().catch(() => undefined);
  await closeAllDatabases();
});

describe('cron lock', () => {
  it('two concurrent attempts on the same key: exactly one acquires it', async () => {
    const key = `test:lock:${unique}`;
    const [a, b] = await Promise.all([acquireLock(redis, key, 30), acquireLock(redis, key, 30)]);
    const acquired = [a, b].filter((x) => x !== null);
    expect(acquired).toHaveLength(1);
    const winner = acquired[0];
    if (winner) await releaseLock(redis, winner);
  });

  it('a released lock can be taken again', async () => {
    const key = `test:lock-reuse:${unique}`;
    const first = await acquireLock(redis, key, 30);
    expect(first).not.toBeNull();
    if (first) await releaseLock(redis, first);
    const second = await acquireLock(redis, key, 30);
    expect(second).not.toBeNull();
    if (second) await releaseLock(redis, second);
  });

  it('an expired lock is free again', async () => {
    const key = `test:lock-expire:${unique}`;
    const lock = await acquireLock(redis, key, 1);
    expect(lock).not.toBeNull();
    await new Promise((r) => setTimeout(r, 1_100));
    const next = await acquireLock(redis, key, 30);
    expect(next).not.toBeNull();
    if (next) await releaseLock(redis, next);
  });

  it('withLock runs fn exactly once across two concurrent callers', async () => {
    const key = `test:withlock:${unique}`;
    let runs = 0;
    const results = await Promise.all([
      withLock(redis, key, 30, async () => {
        runs += 1;
        await new Promise((r) => setTimeout(r, 100));
        return 'a';
      }),
      withLock(redis, key, 30, async () => {
        runs += 1;
        return 'b';
      }),
    ]);
    expect(runs).toBe(1);
    const ranFlags = results.map((r) => r.ran).sort();
    expect(ranFlags).toEqual([false, true]);
  });

  it('withLock releases the lock even when fn throws', async () => {
    const key = `test:withlock-throw:${unique}`;
    await expect(
      withLock(redis, key, 30, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // The key must be free now.
    const next = await acquireLock(redis, key, 30);
    expect(next).not.toBeNull();
    if (next) await releaseLock(redis, next);
  });
});

describe('cron registry', () => {
  it('every entry uses a lock key with colons and a job-safe name', () => {
    expect(CRON_REGISTRY.length).toBe(4);
    const names = CRON_REGISTRY.map((e) => e.name);
    expect(names).toEqual([
      'foundation-heartbeat',
      'purge-tokens',
      'purge-idempotency',
      'repair-user-team-index',
    ]);
    for (const entry of CRON_REGISTRY) {
      expect(entry.lockKey).toContain(':');
      expect(entry.lockKey.startsWith('cron:lock:')).toBe(true);
      expect(entry.ttlSeconds).toBeGreaterThan(0);
      expect(entry.schedule.split(' ')).toHaveLength(6); // six-field, seconds included, UTC
      // The real helper's output must satisfy the BullMQ rules (no colon, not digits-only).
      const derived = jobId(entry.name, 1_760_000_000);
      expect(derived).toBe(`${entry.name}-1760000000`);
      expect(derived).not.toContain(':');
      expect(derived).not.toMatch(/^\d+$/);
    }
  });

  it('startCron registers one task per entry and stopAll removes them', () => {
    const queue = getQueue('foundation');
    const handle = startCron(redis, queue);
    expect(handle.tasks).toHaveLength(CRON_REGISTRY.length);
    for (const task of handle.tasks) expect(task.getStatus()).not.toBe('destroyed');
    handle.stopAll();
    for (const task of handle.tasks) expect(task.getStatus()).toBe('destroyed');
  });
});
