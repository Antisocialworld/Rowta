// LinkButton — the secondary action of a card: a small text-style link, never a full-width button (rules U5, U6,
// X1, X6, X14; Phase 1 rework: only the PRIMARY action inside a card renders as a Button).
//
// States: resting underlined text in the primary token; pressed uses the shared pressed opacity; focused is the
//        platform focus order (no ring — the ring belongs to Button's bounded box; a link is bare text).
// Touch:  the row is at least MIN_TOUCH_TARGET tall and hitSlop extends the target to 44 points in every
//        direction, so X6 holds without stretching the card.
// A11y:   accessibilityRole="link" (X1 — the a11y gate enforces a role on every pressable), the catalog label is
//        both the visible words and the accessible name (X14h style: one key, one string, no divergence).
// Props:  label (catalog key), onPress, align, testID.
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { state } from '../theme/tokens';
import { MIN_TOUCH_TARGET, TOUCH_SLOP } from '../theme/layout';
import { t, type MessageKey } from '../i18n/en';
import { Text } from './Text';

export type LinkButtonProps = {
  label: MessageKey;
  onPress: () => void;
  align?: 'left' | 'center';
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

export function LinkButton({ label, onPress, align = 'left', testID, style }: LinkButtonProps) {
  return (
    <View style={[styles.row, align === 'center' ? styles.center : styles.start, style]}>
      <Pressable
        testID={testID}
        onPress={onPress}
        hitSlop={TOUCH_SLOP}
        accessible
        accessibilityRole="link"
        accessibilityLabel={t(label)}
        style={({ pressed }) => [styles.target, pressed ? styles.pressed : null]}
      >
        <Text variant="label-medium" tone="primary" style={styles.underline}>
          {t(label)}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  start: { alignSelf: 'flex-start' },
  center: { alignSelf: 'center' },
  target: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
  pressed: { opacity: 1 - state.pressed },
  underline: { textDecorationLine: 'underline' },
});
