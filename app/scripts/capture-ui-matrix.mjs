// SIZE-MATRIX CAPTURE HARNESS (PRD 6.3; Phase 1 step 4/6).
// Cases: window sizes 320x568, 360x640, 390x844, 412x915, 600x960, landscape 844x390; font scales 1.0, 1.3, 2.0;
// display size default and largest. The script:
//   1. looks for adb and an attached device/emulator (no device -> it prints the MISSING list and exits 2;
//      it NEVER fakes a screenshot — PRD 6.3 forbids inventing evidence);
//   2. for each window-size case: sets `adb shell wm size`, screenshots the foreground app with
//      `adb exec-out screencap -p` into docs/ui-matrix/<case>.png, then restores the original size;
//   3. font-scale and display-size cases need the OS settings screen; the script prints the exact steps and
//      the expected capture names so the operator (or a future CI emulator) can complete them.
// Run from the repo root:  node app/scripts/capture-ui-matrix.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(APP_DIR, '..');
const OUT_DIR = path.join(REPO, 'docs', 'ui-matrix');
const PACKAGE = 'app.rowta';

const WINDOW_CASES = [
  { name: 'portrait-small-320x568', size: '320x568' },
  { name: 'portrait-360x640', size: '360x640' },
  { name: 'portrait-390x844', size: '390x844' },
  { name: 'portrait-412x915', size: '412x915' },
  { name: 'tablet-600x960', size: '600x960' },
  { name: 'landscape-844x390', size: '844x390' },
];

const TEXT_SCALE_CASES = ['text-scale-1.0', 'text-scale-1.3', 'text-scale-2.0'];
const DISPLAY_CASES = ['display-default', 'display-largest'];

function hasAdb() {
  return spawnSync('adb', ['version'], { stdio: 'ignore' }).status === 0;
}

function deviceAttached() {
  const out = execFileSync('adb', ['devices'], { encoding: 'utf8' });
  return out
    .split(/\r?\n/)
    .slice(1)
    .some((line) => line.trim().endsWith('device'));
}

fs.mkdirSync(OUT_DIR, { recursive: true });

if (!hasAdb() || !deviceAttached()) {
  console.log('MISSING: no adb with an attached device or emulator on this machine.');
  console.log('PRD 6.3 forbids inventing screenshots, so the following captures were NOT taken:');
  for (const c of WINDOW_CASES) console.log(`  docs/ui-matrix/${c.name}.png (window ${c.size})`);
  for (const c of TEXT_SCALE_CASES) console.log(`  docs/ui-matrix/${c}.png (OS font scale)`);
  for (const c of DISPLAY_CASES) console.log(`  docs/ui-matrix/${c}.png (OS display size)`);
  console.log('To capture on a machine with an emulator:');
  console.log('  1. start an emulator, install the dev build, open the app, sign in to the Phase 1 stub,');
  console.log('     open the component gallery (every auth view is reachable from the gallery flow too);');
  console.log('  2. re-run: node app/scripts/capture-ui-matrix.mjs');
  console.log('  3. font-scale and display-size cases: change them in Android Settings > Display,');
  console.log('     re-open the gallery, and save docs/ui-matrix/<case>.png at the listed names.');
  process.exit(2);
}

const original = execFileSync('adb', ['shell', 'wm', 'size'], { encoding: 'utf8' }).trim();
console.log(`original wm size: ${original}`);

for (const c of WINDOW_CASES) {
  execFileSync('adb', ['shell', 'wm', 'size', c.size]);
  execFileSync('adb', ['shell', 'wm', 'density', 'reset'], { stdio: 'ignore' });
  execFileSync('adb', ['monkey', '-p', PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1'], { stdio: 'ignore' });
  execFileSync('adb', ['shell', 'sleep', '2']);
  const png = execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 });
  const file = path.join(OUT_DIR, `${c.name}.png`);
  fs.writeFileSync(file, png);
  console.log(`captured ${file}`);
}

execFileSync('adb', ['shell', 'wm', 'size', 'reset']);
console.log('restored wm size');
console.log(`font-scale cases (${TEXT_SCALE_CASES.join(', ')}) and display cases (${DISPLAY_CASES.join(', ')}) need OS settings; see the MISSING list instructions above.`);
process.exit(0);
