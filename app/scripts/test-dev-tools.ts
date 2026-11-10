// DEV TOOLS GATE PROOF (P7, owner decision 28 Oct 2026; no React Native): the pure helper
// reports the gallery visible only when the build is development. Run from the repo root:
//   npm exec --workspace @rowta/app -- tsx scripts/test-dev-tools.ts
import { devToolsVisible } from '../src/lib/dev-tools';

let failures = 0;
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

check(devToolsVisible(true), 'dev tools are visible in development');
check(!devToolsVisible(false), 'dev tools are hidden outside development');

process.exit(failures === 0 ? 0 : 1);
