// Chip — a selectable filter chip (rules U5, X1, X2, X5, X6).
//
// Variants: one (selectable filter chip).
// States:   resting (surface fill) | selected (primary-container fill + a check icon + accessibilityState.selected,
//           so selection is never colour-only — X5) | pressed (token dim via state.pressed, no layout movement) |
//           focused (RING border in primary, laid out from first render so focus cannot shift anything).
// Behaviour: selecting ticks with a light haptic (a key state change, U6/X10 — never required to feel the app).
// Props: label (catalog key — visible words AND accessible name), selected, onPress, disabled, testID.
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { colors, shape, spacing, state } from '../theme/tokens';
import { MIN_TOUCH_TARGET, RING, iconSize } from '../theme/layout';
import { hapticSelection } from '../lib/haptics';
import { t, type MessageKey } from '../i18n/en';
import { Text } from './Text';

export type ChipProps = {
  label: MessageKey;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
};

export function Chip({ label, selected, onPress, disabled = false, testID }: ChipProps) {
  const [focused, setFocused] = useState(false);
  const fill = selected ? colors['color-primary-container'] : colors['color-surface-container-high'];
  const content = selected ? colors['color-on-primary-container'] : colors['color-on-surface'];

  return (
    <Pressable
      testID={testID}
      onPress={() => {
        if (disabled) return;
        hapticSelection();
        onPress();
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessible
      accessibilityRole="button"
      accessibilityLabel={t(label)}
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: fill,
          borderColor: focused ? colors['color-primary'] : fill,
          opacity: disabled ? state.disabledContent : pressed ? 1 - state.pressed : 1,
        },
      ]}
    >
      {selected ? (
        <MaterialIcons
          name="check"
          size={iconSize('label-medium')}
          color={content}
          accessibilityElementsHidden
        />
      ) : null}
      <Text variant="label-large" style={{ color: content }}>
        {t(label)}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.extraSmall,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.base,
    borderRadius: shape.full,
    borderWidth: RING,
  },
});
