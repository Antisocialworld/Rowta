// Pure welcome decision logic, geometry, and timeline constants (rules U1, U5, X8).
// Completely independent of React Native rendering; tested by test-welcome-logic.ts in plain Node.

export const TILE_PT = 160;
export const DESIGN_TILE_SIZE = 420;
export const SCALE = TILE_PT / DESIGN_TILE_SIZE;

export const GEOMETRY = {
  tile: {
    size: 420,
    radius: 100, // 0.24 of width (100 / 420)
  },
  page: {
    x: 111,
    y: 81,
    width: 214, // 325 - 111
    height: 254, // 335 - 81
    radius: 8,
  },
  baseStrip: {
    x: 111,
    y: 330,
    width: 214,
    height: 22, // 352 - 330, visible below page bottom y 335..352
    radius: 6,
  },
  letterTile: {
    size: 48,
    radius: 10,
    glyphSize: 30, // 30 design units
  },
  letters: {
    R: { char: 'R', x: 131, y: 149 },
    O: { char: 'O', x: 194, y: 149 },
    W: { char: 'W', x: 257, y: 149 },
    T: { char: 'T', x: 162, y: 218 },
    A: { char: 'A', x: 226, y: 218 },
  },
  wordmark: {
    text: 'Rowta',
    letters: ['R', 'o', 'w', 't', 'a'] as const,
    fontSizeRatio: 0.348, // 0.348 * 420 = 146.16 design units
    centerX: 209.5,
    baselineY: 572,
  },
  // Seamless splash hand-off: splash PNG 1024x1024 with tile centre 95px above image center.
  // At imageWidth 320, 1px = 0.3125 pt. 95 * 0.3125 = 29.6875 pt (~29.7 pt) above screen center.
  splashCenterOffsetY: 29.7,
} as const;

export type LetterKey = keyof typeof GEOMETRY.letters;

export const TIMELINE = {
  tileVisible: 0.0,
  pageAppearStart: 0.4,
  pageAppearEnd: 0.9,
  letterDrops: {
    R: { start: 1.1, end: 1.5 },
    O: { start: 1.77, end: 2.17 },
    W: { start: 2.43, end: 2.83 },
    T: { start: 3.10, end: 3.50 },
    A: { start: 3.77, end: 4.17 },
  },
  letterPops: {
    R: { start: 4.8, end: 5.1 },
    O: { start: 5.3, end: 5.6 },
    W: { start: 5.8, end: 6.1 },
    T: { start: 6.3, end: 6.6 },
    A: { start: 6.8, end: 7.1 },
  },
  wordmarkTypes: {
    R: { start: 5.6, end: 5.85 },
    o: { start: 6.0, end: 6.25 },
    w: { start: 6.4, end: 6.65 },
    t: { start: 6.8, end: 7.05 },
    a: { start: 7.2, end: 7.45 },
  },
  holdStart: 7.6,
  holdEnd: 9.0,
  fadeDuration: 0.4,
  totalSeconds: 9.0,
  reducedMotionDuration: 1.2,
} as const;

export type WelcomeLaunchContext = {
  hasSeenWelcome: boolean;
  isDeepLinkLaunch: boolean;
  isSignedIn: boolean;
};

export type WelcomeLaunchDecision = {
  showWelcome: boolean;
  markSeen: boolean;
};

/** Decides whether the animated welcome should be presented on app start. */
export function shouldShowWelcome(ctx: WelcomeLaunchContext): boolean {
  if (ctx.isSignedIn) return false;
  if (ctx.hasSeenWelcome) return false;
  if (ctx.isDeepLinkLaunch) return false;
  return true;
}

/** Pure decision for launch routing: whether to show welcome and whether to persist seen flag. */
export function handleLaunchDecision(ctx: WelcomeLaunchContext): WelcomeLaunchDecision {
  if (ctx.isSignedIn) {
    return { showWelcome: false, markSeen: !ctx.hasSeenWelcome };
  }
  if (ctx.hasSeenWelcome) {
    return { showWelcome: false, markSeen: false };
  }
  if (ctx.isDeepLinkLaunch) {
    // Owner reviewer decision: link launch skips welcome immediately and marks it seen.
    return { showWelcome: false, markSeen: true };
  }
  return { showWelcome: true, markSeen: false };
}

/** Duration in seconds to display the welcome screen before hand-off. */
export function getWelcomeDuration(params: { reduceMotion: boolean }): number {
  return params.reduceMotion ? TIMELINE.reducedMotionDuration : TIMELINE.totalSeconds;
}

/** Android hardware back during welcome exits the app. */
export function shouldExitOnHardwareBack(os: string): boolean {
  return os === 'android';
}

/** Computes the exact tile top-left coordinates matching the native splash. */
export function computeTileLayout(windowWidth: number, windowHeight: number) {
  const scale = SCALE;
  const tileWidth = TILE_PT;
  const screenCenterX = windowWidth / 2;
  const screenCenterY = windowHeight / 2;
  const tileCenterY = screenCenterY - GEOMETRY.splashCenterOffsetY;
  const tileLeft = screenCenterX - tileWidth / 2;
  const tileTop = tileCenterY - tileWidth / 2;
  return {
    tileLeft,
    tileTop,
    scale,
    tileWidth,
    tileCenterY,
    screenCenterX,
  };
}

