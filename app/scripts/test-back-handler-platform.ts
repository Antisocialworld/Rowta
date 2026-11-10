// HARDWARE BACK PLATFORM TEST (rule U1; web crash prevention).
// BackHandler is supported ONLY on Android in React Native. On web and iOS,
// registering a listener either crashes ("BackHandler is not supported on web
// and should not be used") or is a no-op.
// Run from repo root:
//   npm exec --workspace @rowta/app -- tsx scripts/test-back-handler-platform.ts
import { shouldListenForHardwareBack } from '../src/lib/hardware-back';

let failures = 0;
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

check(shouldListenForHardwareBack('android') === true, 'android returns true (listens for hardware back button)');
check(shouldListenForHardwareBack('web') === false, 'web returns false (prevents web crash)');
check(shouldListenForHardwareBack('ios') === false, 'ios returns false (no hardware back button)');
check(shouldListenForHardwareBack('windows') === false, 'windows returns false');
check(shouldListenForHardwareBack('macos') === false, 'macos returns false');

process.exit(failures === 0 ? 0 : 1);

