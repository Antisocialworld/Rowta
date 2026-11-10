// ScreenHeaderRow — shared screen header with optional Back action (Task F10; rules U1, U3, U7, X1, X3, X7).
// Wide web (width > 600): renders the screen title on the left and the BillingBackButton on the right in ONE row.
// Title shrinks/wraps (flex: 1) and never pushes the arrow out of the row. Arrow right edge aligns with content column.
// Phones / native / narrow web: renders the title only; the pinned bottom footer bar renders the Back button.
import { type Ref } from 'react';
import { StyleSheet, type TextInstance, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from './Text';
import { BillingBackButton } from './BillingBackButton';
import { t, type MessageKey } from '../i18n/en';
import { spacing } from '../theme/tokens';
import { MIN_TOUCH_TARGET } from '../theme/layout';
import { useInlineBack } from '../lib/use-inline-back';

export type ScreenHeaderRowProps = {
  /** Catalog key for the screen title. */
  readonly title: MessageKey;
  /** Optional press handler for the Back action. */
  readonly onBack?: () => void;
  /** Optional testID passed through to the Back button. */
  readonly backTestID?: string;
  /** Optional ref for the title Text component to support focusOn(). */
  readonly headingRef?: Ref<TextInstance>;
  /** When true, adds 32px top spacing on wide web for screens starting at the top of the window. */
  readonly topSpacing?: boolean;
  /** Optional style override for the row/container. */
  readonly style?: StyleProp<ViewStyle>;
};

export function ScreenHeaderRow({
  title,
  onBack,
  backTestID,
  headingRef,
  topSpacing = false,
  style,
}: ScreenHeaderRowProps) {
  const inlineBack = useInlineBack(onBack !== undefined);

  if (inlineBack && onBack !== undefined) {
    return (
      <View
        style={[
          styles.row,
          topSpacing ? styles.topSpacing : null,
          style,
        ]}
      >
        <Text
          ref={headingRef}
          variant="headline-small"
          accessibilityRole="header"
          style={styles.heading}
        >
          {t(title)}
        </Text>
        <BillingBackButton onPress={onBack} testID={backTestID} />
      </View>
    );
  }

  return (
    <View style={[styles.single, style]}>
      <Text
        ref={headingRef}
        variant="headline-small"
        accessibilityRole="header"
      >
        {t(title)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: MIN_TOUCH_TARGET,
  },
  topSpacing: {
    paddingTop: Number(spacing.veryLarge),
  },
  heading: {
    flex: 1,
    marginRight: Number(spacing.base),
  },
  single: {
    width: '100%',
  },
});

