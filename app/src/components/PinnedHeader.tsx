// PinnedHeader — pinned top bar (rule U2).
// Keeps an action row at the top of a scrolling screen while list content
// scrolls below it. Same look as PinnedFooter: background color-surface,
// hairline color-outline-variant on the BOTTOM edge, spacing tokens,
// CONTENT_MAX_WIDTH.
import { StyleSheet, View, type LayoutChangeEvent, type ViewProps } from 'react-native';
import type { ReactNode } from 'react';
import { colors, spacing } from '../theme/tokens';
import { CONTENT_MAX_WIDTH, HAIRLINE } from '../theme/layout';

export type PinnedHeaderProps = {
  /** Content rendered inside the pinned bar (an action row, a search input, ...). */
  children: ReactNode;
  /** Optional extra style merged onto the outer bar (e.g. absolute positioning). */
  style?: ViewProps['style'];
  /** Optional layout handler forwarded to the outer bar. */
  onLayout?: (event: LayoutChangeEvent) => void;
};

export function PinnedHeader({ children, style, onLayout }: PinnedHeaderProps) {
  return (
    <View style={[styles.header, style]} onLayout={onLayout}>
      <View style={styles.headerContent}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: Number(spacing.base),
    paddingTop: Number(spacing.small),
    paddingBottom: Number(spacing.small),
    backgroundColor: colors['color-surface'],
    borderBottomWidth: HAIRLINE,
    borderBottomColor: colors['color-outline-variant'],
  },
  headerContent: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
});
