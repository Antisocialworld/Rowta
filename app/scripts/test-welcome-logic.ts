// WELCOME LOGIC TEST (rules U1, U5, X8).
// Tests first-launch decision rules, storage flag transitions, deep-link skips,
// reduce-motion duration, timeline ordering, and geometry constraints in plain Node.
// Run from repo root:
//   npm exec --workspace @rowta/app -- tsx scripts/test-welcome-logic.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  computeTileLayout,
  DESIGN_TILE_SIZE,
  GEOMETRY,
  getWelcomeDuration,
  handleLaunchDecision,
  SCALE,
  shouldExitOnHardwareBack,
  shouldShowWelcome,
  TILE_PT,
  TIMELINE,
  type LetterKey,
} from '../src/lib/welcome-logic';
import { createWelcomeStore, memoryBackend } from '../src/lib/welcome-store';

let failures = 0;
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

// 1. shouldShowWelcome & handleLaunchDecision
check(
  shouldShowWelcome({ hasSeenWelcome: false, isDeepLinkLaunch: false, isSignedIn: false }) === true,
  'first launch shows welcome (clean start)',
);
check(
  shouldShowWelcome({ hasSeenWelcome: true, isDeepLinkLaunch: false, isSignedIn: false }) === false,
  'second launch does not show welcome',
);
check(
  shouldShowWelcome({ hasSeenWelcome: false, isDeepLinkLaunch: true, isSignedIn: false }) === false,
  'link launch skips welcome',
);
check(
  shouldShowWelcome({ hasSeenWelcome: false, isDeepLinkLaunch: false, isSignedIn: true }) === false,
  'signed-in user skips welcome',
);

const dec1 = handleLaunchDecision({ hasSeenWelcome: false, isDeepLinkLaunch: false, isSignedIn: false });
check(dec1.showWelcome === true && dec1.markSeen === false, 'first launch decision: showWelcome=true, markSeen=false');

const dec2 = handleLaunchDecision({ hasSeenWelcome: false, isDeepLinkLaunch: true, isSignedIn: false });
check(dec2.showWelcome === false && dec2.markSeen === true, 'link launch decision: skips and marks seen immediately');

const dec3 = handleLaunchDecision({ hasSeenWelcome: true, isDeepLinkLaunch: false, isSignedIn: false });
check(dec3.showWelcome === false && dec3.markSeen === false, 'returning launch decision: showWelcome=false, markSeen=false');

const dec4 = handleLaunchDecision({ hasSeenWelcome: false, isDeepLinkLaunch: false, isSignedIn: true });
check(dec4.showWelcome === false && dec4.markSeen === true, 'signed-in user decision: skips and marks seen');

// 2. Storage transitions (welcomeStore)
const store = createWelcomeStore(memoryBackend());
void (async () => {
  const initial = await store.hasSeenWelcome();
  check(initial === false, 'welcomeStore: fresh store returns false');

  await store.markSeen();
  const afterSeen = await store.hasSeenWelcome();
  check(afterSeen === true, 'welcomeStore: markSeen updates store to true');

  await store.reset();
  const afterReset = await store.hasSeenWelcome();
  check(afterReset === false, 'welcomeStore: reset returns false');

  // 3. Reduce motion duration
  check(getWelcomeDuration({ reduceMotion: true }) === 1.2, 'reduce motion duration is 1.2s');
  check(getWelcomeDuration({ reduceMotion: false }) === 9.0, 'normal motion duration is 9.0s');

  // 4. Android hardware back
  check(shouldExitOnHardwareBack('android') === true, 'Android hardware back exits app');
  check(shouldExitOnHardwareBack('ios') === false, 'iOS does not listen for hardware back');
  check(shouldExitOnHardwareBack('web') === false, 'Web does not listen for hardware back');

  // 5. TIMELINE constants ordering and consistency
  check(TIMELINE.tileVisible === 0.0, 'tile visible starts at 0.0s');
  check(
    TIMELINE.pageAppearStart === 0.4 && TIMELINE.pageAppearEnd === 0.9 && TIMELINE.pageAppearStart < TIMELINE.pageAppearEnd,
    'page appears 0.4s to 0.9s (0.5s duration)',
  );

  const drops = TIMELINE.letterDrops;
  check(
    drops.R.start === 1.1 &&
      drops.O.start === 1.77 &&
      drops.W.start === 2.43 &&
      drops.T.start === 3.1 &&
      drops.A.start === 3.77,
    'letter drops start at 1.1, 1.77, 2.43, 3.1, 3.77',
  );
  check(
    drops.R.start < drops.O.start &&
      drops.O.start < drops.W.start &&
      drops.W.start < drops.T.start &&
      drops.T.start < drops.A.start,
    'letter drop starts strictly strictly ordered',
  );

  const keys: LetterKey[] = ['R', 'O', 'W', 'T', 'A'];
  const allDrops04 = keys.every((k) => Math.abs(drops[k].end - drops[k].start - 0.4) < 1e-6);
  check(allDrops04, 'each letter drop lasts 0.4s');

  const pops = TIMELINE.letterPops;
  check(
    pops.R.start === 4.8 &&
      pops.O.start === 5.3 &&
      pops.W.start === 5.8 &&
      pops.T.start === 6.3 &&
      pops.A.start === 6.8,
    'letter pops start at 4.8, 5.3, 5.8, 6.3, 6.8 (every 0.5s)',
  );
  check(drops.A.end <= pops.R.start, 'letter drops finish before letter pops begin (4.17 <= 4.8)');
  const allPops03 = keys.every((k) => Math.abs(pops[k].end - pops[k].start - 0.3) < 1e-6);
  check(allPops03, 'each letter pop lasts 0.3s');

  const wm = TIMELINE.wordmarkTypes;
  check(
    wm.R.start === 5.6 &&
      wm.o.start === 6.0 &&
      wm.w.start === 6.4 &&
      wm.t.start === 6.8 &&
      wm.a.start === 7.2,
    'wordmark letters type in at 5.6, 6.0, 6.4, 6.8, 7.2',
  );
  const wmKeys = ['R', 'o', 'w', 't', 'a'] as const;
  const allWm025 = wmKeys.every((k) => Math.abs(wm[k].end - wm[k].start - 0.25) < 1e-6);
  check(allWm025, 'each wordmark letter fade/rise lasts 0.25s');

  check(wm.a.end <= TIMELINE.holdStart, 'wordmark finishes typing before hold (7.45 <= 7.6)');
  check(
    TIMELINE.holdStart === 7.6 && TIMELINE.holdEnd === 9.0 && TIMELINE.totalSeconds === 9.0,
    'hold finishes at 9.0s and total duration is 9.0s',
  );
  check(TIMELINE.fadeDuration === 0.4, 'screen fadeout is 0.4s');

  // 6. GEOMETRY constants
  check(TILE_PT === 160 && DESIGN_TILE_SIZE === 420, 'TILE_PT is 160, DESIGN_TILE_SIZE is 420');
  check(Math.abs(SCALE - 160 / 420) < 1e-9, 'SCALE is 160 / 420');

  const { tile, page, baseStrip, letterTile, letters, wordmark, splashCenterOffsetY } = GEOMETRY;
  check(tile.size === 420 && tile.radius === 100, 'tile is 420x420, radius 100');
  check(Math.abs(tile.radius / tile.size - 0.238) < 0.01, 'tile corner radius is ~0.24 of width');

  check(
    page.x === 111 && page.y === 81 && page.width === 214 && page.height === 254 && page.radius === 8,
    'page is x 111..325, y 81..335 (w 214, h 254), radius 8',
  );
  check(page.x >= 0 && page.y >= 0 && page.x + page.width <= tile.size && page.y + page.height <= tile.size, 'page is inside tile');

  check(
    baseStrip.x === 111 && baseStrip.y === 330 && baseStrip.width === 214 && baseStrip.height === 22 && baseStrip.radius === 6,
    'base strip is x 111..325, y 330..352 (w 214, h 22), radius 6',
  );
  check(baseStrip.y + baseStrip.height > page.y + page.height, 'base strip extends below page bottom (shows y 335..352)');

  check(letterTile.size === 48 && letterTile.radius === 10 && letterTile.glyphSize === 30, 'letter tiles are 48x48, radius 10, glyph 30');

  // Letter tiles inside page
  for (const k of keys) {
    const l = letters[k];
    const insidePage =
      l.x >= page.x &&
      l.y >= page.y &&
      l.x + letterTile.size <= page.x + page.width &&
      l.y + letterTile.size <= page.y + page.height;
    check(insidePage, `letter ${k} at (${l.x}, ${l.y}) is inside the page`);
  }

  check(letters.R.x === 131 && letters.R.y === 149, 'letter R at (131, 149)');
  check(letters.O.x === 194 && letters.O.y === 149, 'letter O at (194, 149)');
  check(letters.W.x === 257 && letters.W.y === 149, 'letter W at (257, 149)');
  check(letters.T.x === 162 && letters.T.y === 218, 'letter T at (162, 218)');
  check(letters.A.x === 226 && letters.A.y === 218, 'letter A at (226, 218)');

  check(wordmark.text === 'Rowta', 'wordmark text is Rowta');
  check(wordmark.fontSizeRatio === 0.348, 'wordmark fontSizeRatio is 0.348');
  check(wordmark.centerX === 209.5, 'wordmark centerX is 209.5');
  check(wordmark.baselineY === 572, 'wordmark baselineY is 572');
  check(splashCenterOffsetY === 29.7, 'splashCenterOffsetY is 29.7 pt');

  // Layout computation test
  const layout = computeTileLayout(360, 800);
  check(layout.scale === SCALE, 'layout scale matches SCALE');
  check(layout.tileWidth === 160, 'layout tileWidth is 160 pt');
  check(layout.tileLeft === 360 / 2 - 80, 'layout tileLeft is centered horizontally (100 pt)');
  check(layout.tileCenterY === 800 / 2 - 29.7, 'layout tileCenterY is 29.7 pt above screen center (370.3 pt)');

  // 7. Static integration checks (App.tsx and WelcomeScreen.tsx)
  const appSrc = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');
  check(
    /import\s*\{[^}]*handleLaunchDecision[^}]*\}\s*from/.test(appSrc) &&
      /\bhandleLaunchDecision\(/.test(appSrc),
    'App.tsx imports and calls handleLaunchDecision',
  );

  const welcomeScreenSrc = readFileSync(
    resolve(__dirname, '../src/components/welcome/WelcomeScreen.tsx'),
    'utf8',
  );
  check(
    !/withTiming\([^,]+,[^,]+,\s*\([^)]*\)\s*=>[\s\S]*?completeWelcome/.test(welcomeScreenSrc),
    'WelcomeScreen.tsx contains no withTiming callback that calls completeWelcome',
  );
  check(
    /import\s*\{[^}]*useSafeAreaInsets[^}]*\}\s*from\s*['"]react-native-safe-area-context['"]/.test(welcomeScreenSrc) &&
      /\buseSafeAreaInsets\(\)/.test(welcomeScreenSrc),
    'WelcomeScreen.tsx uses useSafeAreaInsets',
  );

  process.exit(failures === 0 ? 0 : 1);
})();

