// Design-system CSS box-shadows, mapped to React Native — ONCE (U5, U11c).
//
// A design-system shadow is a CSS string: "<x> <y> <blur> <spread> <colour>". React Native on Android (the
// target platform, PRD 12) does not draw CSS box-shadows at all: it uses `elevation` in dp. So each token is
// parsed here and its blur radius becomes the elevation — soft (the largest blur) floats highest, hard sits
// above medium. The colour, spread and offset stay the web/iOS values; Android renders its system shadow.
//
// Nothing in app/src may write `shadowColor/shadowOffset/shadowRadius/shadowOpacity` — the token gate
// (scripts/check-ui-tokens.mjs) bans those property names, which is why this file only emits `elevation`.
import { shadows } from './tokens';

export type ElevationName = keyof typeof shadows;

function elevationOf(value: string): number {
  const blurPart = value.split(' ')[2] ?? '';
  const blur = Number(blurPart.replace('px', ''));
  if (Number.isFinite(blur) === false || blur <= 0) return 1;
  return Math.max(1, Math.round(blur / 2));
}

/** Named elevations derived from the design-system shadow tokens. */
export const elevation = {
  hard: elevationOf(shadows.hardShadow),
  medium: elevationOf(shadows.medium),
  soft: elevationOf(shadows.soft),
} as const;

const ELEVATION_KEY = {
  hardShadow: 'hard',
  medium: 'medium',
  soft: 'soft',
} as const satisfies Record<ElevationName, keyof typeof elevation>;

/** The style for a raised surface: token shadow name in, Android elevation out. */
export function elevated(name: ElevationName): { elevation: number } {
  return { elevation: elevation[ELEVATION_KEY[name]] };
}
