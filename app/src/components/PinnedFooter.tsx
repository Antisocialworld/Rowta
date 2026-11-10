// PinnedFooter — pinned bottom footer bar with a single action button (rule U2).
// Keeps Back at the bottom while list content scrolls above it. Same look as the
// previous per-screen inline footers so nothing visually changes.
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Button } from './Button';
import { BillingBackButton } from './BillingBackButton';
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

  if (inlineBack) {
    return (
      <View style={styles.inlineRoot}>
        <View style={styles.inlineContent}>
          <BillingBackButton onPress={onPress} testID={testID} />
        </View>
      </View>
    );
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
  inlineRoot: ({
    width: '100%',
    backgroundColor: 'transparent',
    // Web-only CSS flexbox 'order' places inline back above scroll content in visual flow.
    order: -1,
    zIndex: 1,
  } as unknown as ViewStyle),
  inlineContent: {
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: Number(spacing.base),
    paddingTop: Number(spacing.veryLarge),
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
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
