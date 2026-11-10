// POLL ACCOUNT ACTIVE HELPER TEST (PRD 8.6, Tasks H10 / H13)
// Tests the pure async loop helper pollAccountActive from poll-account-active.ts.
// Run from repo root:
//   npm exec --workspace @rowta/app -- tsx scripts/test-poll-account-active.ts
import { pollAccountActive } from '../src/lib/poll-account-active';

let failures = 0;
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

async function run(): Promise<void> {
  // Test (a): status active on round 2 returns true
  {
    let calls = 0;
    const fetchStatus = async () => {
      calls += 1;
      if (calls === 1) return { account: { status: 'grace' } };
      return { account: { status: 'active' } };
    };
    const result = await pollAccountActive({
      timeoutMs: 500,
      intervalMs: 10,
      fetchStatus,
    });
    check(result === true, 'Test (a): status active on round 2 returns true');
    check(calls === 2, 'Test (a): fetchStatus was called exactly twice');
  }

  // Test (b): status never active returns false
  {
    let calls = 0;
    const fetchStatus = async () => {
      calls += 1;
      return { account: { status: 'past_due' } };
    };
    const result = await pollAccountActive({
      timeoutMs: 50,
      intervalMs: 10,
      fetchStatus,
    });
    check(result === false, 'Test (b): status never active returns false');
    check(calls > 1, 'Test (b): fetchStatus polled multiple times until deadline');
  }

  // Test (c): cancelled via predicate returns false
  {
    let calls = 0;
    let allowed = true;
    const fetchStatus = async () => {
      calls += 1;
      // Trigger cancellation immediately after first check
      allowed = false;
      return { account: { status: 'grace' } };
    };
    const result = await pollAccountActive({
      timeoutMs: 500,
      intervalMs: 10,
      shouldContinue: () => allowed,
      fetchStatus,
    });
    check(result === false, 'Test (c): cancelled via predicate returns false');
    check(calls === 1, 'Test (c): fetchStatus stopped immediately after cancellation');
  }

  // Test (d): transient fetch error on round 1 recovers on round 2
  {
    let calls = 0;
    const fetchStatus = async () => {
      calls += 1;
      if (calls === 1) throw new Error('network hiccup');
      return { account: { status: 'active' } };
    };
    const result = await pollAccountActive({
      timeoutMs: 500,
      intervalMs: 10,
      fetchStatus,
    });
    check(result === true, 'Test (d): transient fetch error recovers on next round and returns true');
    check(calls === 2, 'Test (d): fetchStatus retried after transient error');
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  } else {
    console.log('\nAll pollAccountActive tests passed.');
  }
}

void run();

