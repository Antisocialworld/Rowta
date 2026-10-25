// Redis key prefix helper (Rule J1, PRD 9.8).
//
// In tests (`process.env.VITEST !== undefined`), returns `'test:'` so test runs do not collide
// with development or production keys on the shared Redis instance.
// Outside tests, returns `''` (no prefix).
//
// In this task, used for the new worker liveness and new purge task keys. Existing `rl:` and
// `cron:lock:` keys remain unchanged for now.

/**
 * Returns 'test:' when running under vitest, or an empty string otherwise.
 */
export function redisKeyPrefix(): string {
  return process.env.VITEST !== undefined ? 'test:' : '';
}

/**
 * Prefix a Redis key with the test prefix if running under vitest.
 */
export function prefixedKey(key: string): string {
  return `${redisKeyPrefix()}${key}`;
}
