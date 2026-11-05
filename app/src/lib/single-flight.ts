// SINGLE-FLIGHT coordination (rule A11: "the app refreshes single-flight — one refresh at a time
// per device; other requests wait for it"). PURE module, no React and no platform imports, so
// scripts/test-token-store.ts can prove the behaviour in plain Node: N concurrent callers of the
// guarded function produce ONE underlying run and all receive its result.
//
// The pattern: the first caller stores the in-flight promise; everyone else awaits the SAME
// promise. The slot is cleared in a finally so a failure releases the next attempt instead of
// caching it forever.
export function singleFlight<Args extends unknown[], Result>(
  run: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  let inflight: Promise<Result> | null = null;
  return (...args: Args) => {
    if (inflight !== null) return inflight;
    inflight = run(...args).finally(() => {
      inflight = null;
    });
    return inflight;
  };
}
