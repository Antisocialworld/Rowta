// Redis lock (rule J2, D5; skill rowta-jobs-worker-recipes section 4).
//
// SET key token NX EX ttl — atomic set-if-absent with an expiry. Two concurrent attempts on the
// same key: exactly one gets a token. Release is compare-and-delete via a small Lua script so a
// process can never delete a lock that someone else has since taken over.
//
// Lock keys use colons (they are Redis keys, NOT BullMQ job IDs, which must not contain a colon).
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

const RELEASE_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export interface Lock {
  key: string;
  token: string;
}

/** Take the lock, or return null when another holder has it. */
export async function acquireLock(redis: Redis, key: string, ttlSeconds: number): Promise<Lock | null> {
  const token = randomUUID();
  const reply = await redis.set(key, token, 'EX', ttlSeconds, 'NX');
  return reply === 'OK' ? { key, token } : null;
}

/** Release a lock we hold. Safe if the lock has already expired and been retaken. */
export async function releaseLock(redis: Redis, lock: Lock): Promise<void> {
  await redis.eval(RELEASE_SCRIPT, 1, lock.key, lock.token);
}

/**
 * Run `fn` while holding the lock. Returns { ran, result } — ran is false when the lock was taken
 * by someone else, in which case fn never runs. Used by every cron tick (J2).
 */
export async function withLock<T>(
  redis: Redis,
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>,
): Promise<{ ran: boolean; result?: T }> {
  const lock = await acquireLock(redis, key, ttlSeconds);
  if (!lock) return { ran: false };
  try {
    const result = await fn();
    return { ran: true, result };
  } finally {
    await releaseLock(redis, lock);
  }
}
