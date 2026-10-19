// Proves the P7 release guard on the Phase 1 session stub: with __DEV__ false (what a React Native release
// bundle sets — the app equivalent of the server's NODE_ENV=production) the module must refuse to load.
// Run from the repo root:
//   npm exec --workspace @rowta/app -- tsx scripts/test-session-guard.ts
// An async main (not a top-level await) because tsx runs this workspace as CommonJS.
(globalThis as Record<string, unknown>).__DEV__ = false;

async function main(): Promise<void> {
  let fired = false;
  try {
    // dynamic import so the module body — and its guard — runs here, under __DEV__ false
    await import('../src/state/session');
  } catch (error) {
    fired = true;
    const message = error instanceof Error ? error.message : String(error);
    console.log(`PASS: guard fired — ${message}`);
  }

  if (!fired) {
    console.error('FAIL: the session stub loaded with __DEV__ false (P7 violation, docs/SECURITY.md section 3)');
    process.exit(1);
  }

  console.log('PASS: the Phase 1 session stub refuses a release build (P7; docs/SECURITY.md section 3)');
  process.exit(0);
}

void main();
