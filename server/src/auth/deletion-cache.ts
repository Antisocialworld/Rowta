// Deletion refusal cache (Task D2b; rules A4, A11, S5, S6, S14).
//
// When an account deletion is requested, existing access tokens remain valid until they expire
// (ACCESS_TOKEN_TTL_SECONDS = 300). To immediately refuse authenticated requests without a database
// query per request (Rule S5, S6), we store a refusal key in Redis with a TTL of the access-token
// lifetime plus a 60-second safety margin.
//
// When the account is restored, the refusal key is deleted so requests are accepted immediately.
//
// In auth middleware, requireAuth performs ONE Redis lookup for this refusal key.
// Fail-closed convention: on Redis lookup error, deny access with 401 auth.not_authenticated.
import { Redis } from 'ioredis';
import { ACCESS_TOKEN_TTL_SECONDS } from '@rowta/shared';
import { env } from '../config/env.ts';
import { prefixedKey } from '../lib/redis-prefix.ts';

/** Refusal key TTL: access token lifetime (300s) + 60s safety margin. */
export const DELETED_USER_TTL_SECONDS = ACCESS_TOKEN_TTL_SECONDS + 60;

let sharedRedis: Redis | null = null;
let injectedRedis: Redis | null = null;

export function getRefusalRedis(): Redis {
  if (injectedRedis !== null) return injectedRedis;
  if (sharedRedis === null) {
    sharedRedis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
    });
  }
  return sharedRedis;
}

/** Tests only: inject a Redis client or reset. */
export function __setRefusalRedisForTests(client: unknown): void {
  injectedRedis = client as Redis | null;
}

/** Tests only / graceful shutdown: close the shared Redis client. */
export async function closeRefusalRedis(): Promise<void> {
  const client = sharedRedis;
  sharedRedis = null;
  if (client !== null) await client.quit().catch(() => undefined);
}

export function deletedUserRefusalKey(userId: string): string {
  return prefixedKey(`auth:deleted_user:${userId}`);
}

/**
 * Record that an account is pending deletion.
 * Sets a key in Redis with TTL = ACCESS_TOKEN_TTL_SECONDS + 60.
 */
export async function markUserRefused(userId: string): Promise<void> {
  const redis = getRefusalRedis();
  const key = deletedUserRefusalKey(userId);
  await redis.set(key, '1', 'EX', DELETED_USER_TTL_SECONDS);
}

/**
 * Remove the refusal key when an account is restored.
 */
export async function clearUserRefused(userId: string): Promise<void> {
  const redis = getRefusalRedis();
  const key = deletedUserRefusalKey(userId);
  await redis.del(key);
}

/**
 * Check if the user is currently refused due to pending account deletion.
 * Returns true if the refusal key exists in Redis.
 */
export async function isUserRefused(userId: string): Promise<boolean> {
  const redis = getRefusalRedis();
  const key = deletedUserRefusalKey(userId);
  const count = await redis.exists(key);
  return count > 0;
}

