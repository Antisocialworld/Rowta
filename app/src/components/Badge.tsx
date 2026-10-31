// Badge — a small status label (rules U5, X5, X10).
//
// Tones: neutral | primary | success | warning | error. There is NO info tone: the design system has no info
//        colour, so informational badges use primary (U11a). Every tone pairs container + on-container roles from
//        tokens.ts; the ratios are measured in docs/a11y/contrast.md (X5).
// States: none (not interactive).
// Meaning: the badge always shows WORDS (a catalog key), never colour alone (X5) — colour only re-states them.
// Props: label (catalog key), tone, style.
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, shape, spacing } from '../theme/tokens';
import { t, type MessageKey } from '../i18n/en';
import { Text } from './Text';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'error';

const TONE: Record<BadgeTone, { bg: string; content: string }> = {
  neutral: { bg: colors['color-surface-container-highest'], content: colors['color-on-surface-variant'] },
  primary: { bg: colors['color-primary-container'], content: colors['color-on-primary-container'] },
  success: { bg: colors['color-success-container'], content: colors['color-on-success-container'] },
  warning: { bg: colors['color-warning-container'], content: colors['color-on-warning-container'] },
  error: { bg: colors['color-error-container'], content: colors['color-on-error-container'] },
};

export type BadgeProps = {
  /** Catalog key: the words that carry the meaning (colour only re-states them). */
  label: MessageKey;
  tone?: BadgeTone;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function Badge({ label, tone = 'neutral', style, testID }: BadgeProps) {
  const pair = TONE[tone];
  return (
    <View style={[styles.badge, { backgroundColor: pair.bg }, style]} testID={testID}>
      <Text variant="label-small" style={{ color: pair.content }}>
        {t(label)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: shape.full,
    paddingHorizontal: spacing.small,
    paddingVertical: spacing.extraSmall,
    alignSelf: 'flex-start',
  },
});
