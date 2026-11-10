// QUOTE SCREEN APPSTATE TRANSITION LOGIC TEST
// Tests the pure state-transition helper shouldPollOnAppStateChange from quote-appstate.ts.
// Run from repo root:
//   npm exec --workspace @rowta/app -- tsx scripts/test-quote-appstate.ts
import { shouldPollOnAppStateChange } from '../src/lib/quote-appstate';

let failures = 0;
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

// 1. Transition from background to active when payment is pending and not currently polling -> true
check(
  shouldPollOnAppStateChange('background', 'active', true, false) === true,
  'background -> active triggers poll when pending and not polling',
);

// 2. Transition from inactive to active when payment is pending and not currently polling -> true
check(
  shouldPollOnAppStateChange('inactive', 'active', true, false) === true,
  'inactive -> active triggers poll when pending and not polling',
);

// 3. Already active (active -> active) -> false
check(
  shouldPollOnAppStateChange('active', 'active', true, false) === false,
  'active -> active does not trigger poll',
);

// 4. Staying in background (background -> background) -> false
check(
  shouldPollOnAppStateChange('background', 'background', true, false) === false,
  'background -> background does not trigger poll',
);

// 5. Leaving to background (active -> background) -> false
check(
  shouldPollOnAppStateChange('active', 'background', true, false) === false,
  'active -> background does not trigger poll',
);

// 6. Leaving to inactive (active -> inactive) -> false
check(
  shouldPollOnAppStateChange('active', 'inactive', true, false) === false,
  'active -> inactive does not trigger poll',
);

// 7. Not pending payment -> false even on active transition
check(
  shouldPollOnAppStateChange('background', 'active', false, false) === false,
  'background -> active does not trigger poll when payment not pending',
);

// 8. Already polling -> false (guards against concurrent poll)
check(
  shouldPollOnAppStateChange('background', 'active', true, true) === false,
  'background -> active does not trigger poll when already polling',
);

process.exit(failures === 0 ? 0 : 1);

