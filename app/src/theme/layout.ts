// Derived layout constants — every number comes from the design-system spacing scale, nothing is written by
// hand (U5). The scale has no 44-point target token and no border-width token, so both are derived from its
// 4-point base unit (spacing.extraSmall = 4, the unit U5 says the scale is built on) instead of being magic
// numbers in component files. scripts/check-ui-tokens.mjs proves the components stay clean. The one exception
// is CONTENT_MAX_WIDTH below: an existing app constant (the auth card's 400) promoted here so every centred
// surface shares the one width instead of repeating the number — still no component writes it by hand.
import { spacing, typeStyles } from './tokens';
import type { TypeStyleName } from './fonts';

/** The 4-point base unit of the spacing scale. */
export const UNIT = spacing.extraSmall / 4; // 1
/** Focus-ring and emphasis thickness (2 base units). */
export const RING = UNIT * 2; // 2
/** Quiet separator thickness (1 base unit). */
export const HAIRLINE = UNIT; // 1
/** X6: every touch target is at least 44 by 44 points (32 + 12 from the spacing scale). */
export const MIN_TOUCH_TARGET = spacing.veryLarge + spacing.medium; // 44
/** Half of the minimum target, used as hitSlop so small inline controls still reach 44 points (X6). */
export const TOUCH_SLOP = MIN_TOUCH_TARGET / 2; // 22
/**
 * The one max content-column width: the auth card, bottom sheets and confirm dialogs all share it so centred
 * content never stretches across a wide desktop viewport. Phones (360) stay full width — width 100% with this
 * cap only bites above 400. Promoted from AuthPage's local CARD_MAX_WIDTH (same value, unchanged).
 */
export const CONTENT_MAX_WIDTH = 400;
/** Phones at or below this width use compact dashboard empty states. */
export const COMPACT_MAX_WIDTH = 600;

export function isCompactWidth(width: number): boolean {
  return width <= COMPACT_MAX_WIDTH;
}

/** Icon sizes follow the type scale: an icon sits on the text size of the style it accompanies (U5, X6). */
export function iconSize(style: TypeStyleName = 'label-large'): number {
  return typeStyles[style].fontSize;
}
