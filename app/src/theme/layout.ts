// Derived layout constants — every number comes from the design-system spacing scale, nothing is written by
// hand (U5). The scale has no 44-point target token and no border-width token, so both are derived from its
// 4-point base unit (spacing.extraSmall = 4, the unit U5 says the scale is built on) instead of being magic
// numbers in component files. scripts/check-ui-tokens.mjs proves the components stay clean. The one exception
// is CONTENT_MAX_WIDTH below: an existing app constant (the auth card's 400) promoted here so every centred
// surface shares the one width instead of repeating the number — still no component writes it by hand.
import { Platform } from 'react-native';
import { typeStyles } from './tokens';
import type { TypeStyleName } from './fonts';
import { isCompactWidth } from './layout-constants';

export * from './layout-constants';

/** True on web viewports wider than the compact boundary (600pt). */
export function isDesktopWeb(width: number): boolean {
  return Platform.OS === 'web' && !isCompactWidth(width);
}

/**
 * Centering style for content columns on desktop web viewports.
 * Uses marginVertical: 'auto' inside flexGrow: 1 containers so the column centers vertically in the window.
 */
export function desktopCenterStyle(width: number): { readonly marginVertical: 'auto' } | undefined {
  return isDesktopWeb(width) ? { marginVertical: 'auto' } : undefined;
}

/** Icon sizes follow the type scale: an icon sits on the text size of the style it accompanies (U5, X6). */
export function iconSize(style: TypeStyleName = 'label-large'): number {
  return typeStyles[style].fontSize;
}
