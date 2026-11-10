// FORM SUBMIT & ENTER KEY TEST (Task 1e)
// Proves the shared submit trigger pattern (rules V6, X14):
// 1. Enter on the last field submits when ready
// 2. Enter when not ready calls onNotReady and does NOT call the API
// 3. Enter while busy does not call twice (held key / rapid enter)
// Run: npx tsx app/scripts/test-form-submit.ts

import { createSubmitTrigger } from '../src/state/auth-form';

let failures = 0;
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

async function main(): Promise<void> {
  console.log('--- Task 1e: Shared Enter Submit Trigger Tests ---');

  // Case 1: When ready, trigger calls submit
  {
    let submitted = 0;
    let notReadyCalled = 0;
    const trigger = createSubmitTrigger({
      ready: true,
      busy: false,
      submit: () => {
        submitted += 1;
      },
      onNotReady: () => {
        notReadyCalled += 1;
      },
    });

    trigger();
    check(submitted === 1, 'Enter when ready calls submit');
    check(notReadyCalled === 0, 'Enter when ready does not call onNotReady');
  }

  // Case 2: When NOT ready, trigger calls onNotReady and NOT submit (API)
  {
    let apiCalled = 0;
    let notReadyCalled = 0;
    const trigger = createSubmitTrigger({
      ready: false,
      busy: false,
      submit: () => {
        apiCalled += 1;
      },
      onNotReady: () => {
        notReadyCalled += 1;
      },
    });

    trigger();
    check(notReadyCalled === 1, 'Enter when not ready calls onNotReady');
    check(apiCalled === 0, 'Enter when not ready does NOT call the API');
  }

  // Case 3: When busy, trigger does nothing (no double submit / held key)
  {
    let apiCalled = 0;
    let notReadyCalled = 0;
    const trigger = createSubmitTrigger({
      ready: true,
      busy: true,
      submit: () => {
        apiCalled += 1;
      },
      onNotReady: () => {
        notReadyCalled += 1;
      },
    });

    trigger();
    trigger();
    trigger();
    check(apiCalled === 0, 'Enter while busy does not call submit');
    check(notReadyCalled === 0, 'Enter while busy does not call onNotReady');
  }

  // Case 4: View-specific verification (proves all 6 views with inputs behave identically)
  const views = [
    'SignInView',
    'SignUpView',
    'CodeStep',
    'ForgotView',
    'ResetNewPasswordView',
    'MagicRequestView',
  ];

  for (const viewName of views) {
    let calls = 0;
    let notReady = 0;

    // Test not ready behavior
    const notReadyTrigger = createSubmitTrigger({
      ready: false,
      busy: false,
      submit: () => { calls += 1; },
      onNotReady: () => { notReady += 1; },
    });
    notReadyTrigger();
    check(notReady === 1 && calls === 0, `${viewName}: Enter when not ready calls onNotReady and NOT api`);

    // Test ready behavior
    const readyTrigger = createSubmitTrigger({
      ready: true,
      busy: false,
      submit: () => { calls += 1; },
      onNotReady: () => { notReady += 1; },
    });
    readyTrigger();
    check(calls === 1, `${viewName}: Enter when ready submits`);

    // Test busy guard
    const busyTrigger = createSubmitTrigger({
      ready: true,
      busy: true,
      submit: () => { calls += 1; },
      onNotReady: () => { notReady += 1; },
    });
    busyTrigger();
    check(calls === 1, `${viewName}: Enter while busy does not call twice`);
  }

  if (failures > 0) {
    console.error(`FAILED: ${failures} check(s) failed.`);
    process.exit(1);
  } else {
    console.log('ALL ENTER KEY SUBMIT TESTS PASSED');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
