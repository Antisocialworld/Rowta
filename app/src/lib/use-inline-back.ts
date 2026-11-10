// Shared hook for wide web inline back navigation (Task H21).
// Wraps useWindowDimensions + shouldRenderInlineBack so both TeamScreenLayout
// and PinnedFooter share the exact same decision logic in ONE place (Rule 1).
import { Platform, useWindowDimensions } from 'react-native';
import { shouldRenderInlineBack } from './wide-layout';

/**
 * Returns true if the current environment is a desktop web viewport (> 600pt)
 * and the action is a navigation Back action.
 * Returns false on phones, native (Android/iOS), or non-back actions.
 */
export function useInlineBack(isBackAction: boolean = true): boolean {
  const { width } = useWindowDimensions();
  if (!isBackAction) return false;
  return shouldRenderInlineBack(width, Platform.OS);
}

