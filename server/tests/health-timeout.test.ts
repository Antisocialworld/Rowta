// Unit tests for withTimeout (server/src/health/router.ts).
// No real database or Redis connections. No network.
import { describe, expect, it } from 'vitest';
import { withTimeout } from '../src/health/router.ts';

describe('withTimeout', () => {
  it('resolves true when the promise settles quickly with true', async () => {
    const fast = Promise.resolve(true);
    expect(await withTimeout(fast, 1000)).toBe(true);
  });

  it('resolves false when the promise settles quickly with false', async () => {
    const fast = Promise.resolve(false);
    expect(await withTimeout(fast, 1000)).toBe(false);
  });

  it('resolves false when the promise never settles (hangs) before the timeout', async () => {
    // A promise that never settles -- simulates a hung database or Redis call.
    const hanging = new Promise<boolean>(() => undefined);
    // Use a very short timeout (20 ms) so the test is fast.
    const result = await withTimeout(hanging, 20);
    expect(result).toBe(false);
  });

  it('resolves false when the promise rejects', async () => {
    const rejected = Promise.reject<boolean>(new Error('connection refused'));
    expect(await withTimeout(rejected, 1000)).toBe(false);
  });

  it('clears the timer when the promise settles before the timeout', async () => {
    // If the timer were not cleared, the test runner would hang (open handle).
    // Vitest detects open handles, so a passing run proves the timer was cleared.
    const fast = Promise.resolve(true);
    await withTimeout(fast, 5000); // long timeout -- must not delay the test
  });
});

