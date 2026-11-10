// Wide layout pure helper (Task H21).
// Determines whether navigation actions like Back should render inline directly
// at the top-left of the content column on wide desktop web viewports (> 600pt),
// rather than pinned to a full-width bottom bar.
// Pure function: no react-native or expo imports so it can be tested in isolation in plain Node.

/** Phones at or below this width use compact layout (promoted from layout.ts). */
export const COMPACT_MAX_WIDTH = 600;

/**
 * Returns true if the viewport is a desktop web viewport wider than the compact boundary.
 * An undefined width or any non-web platform defaults to phone layout (false).
 */
export function shouldRenderInlineBack(
  width: number | undefined,
  platform: string = 'web',
): boolean {
  if (platform !== 'web') return false;
  if (width === undefined) return false;
  return width > COMPACT_MAX_WIDTH;
}

/**
 * Shared decision: determines whether an action should move inline to the top-left
 * of the content column on wide web viewports.
 * Only 'action.back' (navigation Back) moves inline; primary/modal actions (like 'action.close'
 * or 'action.create') remain pinned in their respective footers (Rule 3).
 */
export function shouldInlineAction(
  width: number | undefined,
  platform: string = 'web',
  actionLabel: string = 'action.back',
): boolean {
  if (actionLabel !== 'action.back') return false;
  return shouldRenderInlineBack(width, platform);
}
