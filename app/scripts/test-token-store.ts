// Token storage + single-flight proof (rules A11; no device): the PURE store round-trips a pair
// through an injected backend, a half-failed write reads as signed out, clear removes everything,
// and singleFlight collapses N concurrent callers into ONE underlying run — releasing after both
// success and failure. Run from the repo root:
//   npm exec --workspace @rowta/app -- tsx scripts/test-token-store.ts
import { singleFlight } from '../src/lib/single-flight';
import { createTokenStore, memoryBackend, type TokenBackend } from '../src/lib/token-store';

let failures = 0;
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

async function main(): Promise<void> {
  // ---- round trip through the memory backend (the web preview's backend) --------------------
  const store = createTokenStore(memoryBackend());
  check((await store.read()) === null, 'an empty store reads as signed out');
  await store.write({ accessToken: 'a-1', refreshToken: 'r-1' });
  const pair = await store.read();
  check(pair?.accessToken === 'a-1' && pair?.refreshToken === 'r-1', 'write/read round-trips the pair');
  await store.clear();
  check((await store.read()) === null, 'clear removes both tokens');

  // ---- a half-failed write must read as signed out (never a half session, A11) --------------
  {
    const values = new Map<string, string>();
    const flaky: TokenBackend = {
      get: async (key) => values.get(key) ?? null,
      set: async (key, value) => {
        if (key === 'rowta.refreshToken') throw new Error('keystore unavailable');
        values.set(key, value);
      },
      remove: async (key) => {
        values.delete(key);
      },
    };
    const flakyStore = createTokenStore(flaky);
    let rejected = false;
    try {
      await flakyStore.write({ accessToken: 'a-2', refreshToken: 'r-2' });
    } catch {
      rejected = true;
    }
    check(rejected, 'a failed backend write surfaces the failure');
    check((await flakyStore.read()) === null, 'a partial write reads as signed out (both keys or neither)');
    values.clear();
  }

  // ---- keys are the store's own, and clear on an empty store is safe ------------------------
  {
    const backend = memoryBackend();
    const empty = createTokenStore(backend);
    await empty.clear();
    await backend.set('unrelated.key', 'keep');
    check((await backend.get('unrelated.key')) === 'keep', 'clear only touches the two token keys');
  }

  // ---- singleFlight: N concurrent callers, ONE run, all share the result (A11) --------------
  {
    let runs = 0;
    const refresh = singleFlight(async (seed: number) => {
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return seed * 10;
    });
    const results = await Promise.all([refresh(1), refresh(2), refresh(3), refresh(4), refresh(5)]);
    check(runs === 1, 'five concurrent callers produce ONE underlying run');
    check(results.every((value) => value === 10), 'every caller receives the single run\'s result');

    const next = await refresh(6);
    check(runs === 2 && next === 60, 'after the run settles the next call starts a fresh one (no cached result)');

    let failuresRun = 0;
    const failing = singleFlight(async () => {
      runs += 1;
      failuresRun += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (failuresRun === 1) throw new Error('refresh rejected');
      return 'recovered';
    });
    const settled = await Promise.allSettled([failing(), failing(), failing()]);
    check(settled.every((entry) => entry.status === 'rejected'), 'a failed run fails all waiters together');
    const recovered = await failing();
    check(recovered === 'recovered', 'the slot is released after a failure — the next run can succeed');
    check(failuresRun === 2, 'the failed run happened exactly once before recovery');
  }

  process.exit(failures === 0 ? 0 : 1);
}

void main();
