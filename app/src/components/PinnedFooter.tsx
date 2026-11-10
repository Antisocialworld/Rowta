// PinnedFooter — pinned bottom footer bar with a single action button (rule U2).
// Keeps Back at the bottom while list content scrolls above it. Same look as the
// previous per-screen inline footers so nothing visually changes.
import { StyleSheet, View } from 'react-native';
import { Button } from './Button';
import { colors, spacing } from '../theme/tokens';
import { CONTENT_MAX_WIDTH, HAIRLINE } from '../theme/layout';
import { type MessageKey } from '../i18n/en';
import { useInlineBack } from '../lib/use-inline-back';

export type PinnedFooterProps = {
  /** Catalog key for the button label (and accessible name). */
  label: MessageKey;
  /** Press handler for the button. */
  onPress: () => void;
  /** Button variant; defaults to 'ghost'. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** Optional testID passed through to the Button. */
  testID?: string;
};

export function PinnedFooter({ label, onPress, variant = 'ghost', testID }: PinnedFooterProps) {
  const inlineBack = useInlineBack(label === 'action.back');

  // Wide web (width > 600) with Back action: header row renders the Back arrow, so footer is suppressed (no double Back).
  if (inlineBack) {
    return null;
  }

  return (
    <View style={styles.footer}>
      <View style={styles.footerContent}>
        <Button label={label} variant={variant} fullWidth={true} onPress={onPress} testID={testID} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    paddingHorizontal: Number(spacing.base),
    paddingTop: Number(spacing.small),
    paddingBottom: Number(spacing.small),
    backgroundColor: colors['color-surface'],
    borderTopWidth: HAIRLINE,
    borderTopColor: colors['color-outline-variant'],
  },
  footerContent: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
});
