// Pure layout constants (rules U5, X6; ADR 0021).
// Pure numbers and calculations with zero react-native imports so tests run in plain Node.
import { spacing } from './tokens';

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

