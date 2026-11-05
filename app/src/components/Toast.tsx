// Toast — a transient confirmation on the design system's inverse-surface role (rules U3, U5, U6, X3, X5).
//
// Variants: tone success | error — colour only re-states the words (there is no info colour; U11a).
// States:   shown (enters over motion.screenTransition; under reduce-motion it appears at once, X8) |
//           hidden (unmounted — the view decides when).
// Placement and timing are the VIEW's job: motion.ts holds the durations the owner accepted and has no toast
//           duration token, so the toast never invents one and never sets its own timeout (U5). Pass `style` to
//           position it (e.g. absolute bottom with token spacing).
// Accessibility: the message is a POLITE live region (X3) — read without interrupting, and NOT announced a second
//           time through announce(), so TalkBack never says it twice. Optional action/close controls are named
//           icon buttons (X1).
// Props: visible, message (catalog key), tone, action {label, onPress}, dismissible (adds a named close control),
//        onDismiss, style.
import { useEffect } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors, shape, spacing } from '../theme/tokens';
import { TOUCH_SLOP, iconSize } from '../theme/layout';
import { elevated } from '../theme/shadows';
import { motion } from '../theme/motion';
import { useReducedMotion } from '../lib/a11y';
import { t, type MessageKey } from '../i18n/en';
import { Text } from './Text';

export type ToastTone = 'success' | 'error';

export type ToastProps = {
  visible: boolean;
  /** Catalog key for the words assistive technology reads (X3). */
  message: MessageKey;
  tone?: ToastTone;
  action?: { label: MessageKey; onPress: () => void };
  dismissible?: boolean;
  onDismiss?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function Toast({ visible, message, tone = 'success', action, dismissible = false, onDismiss, style }: ToastProps) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      progress.value = 1;
      return;
    }
    progress.value = withTiming(1, { duration: motion.screenTransition });
    return () => {
      cancelAnimation(progress);
    };
  }, [reduced, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * spacing.extraLarge }],
  }));

  if (!visible) return null;

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={[styles.toast, { backgroundColor: colors['color-inverse-surface'] }, elevated('medium'), animatedStyle, style]}
    >
      <MaterialIcons
        name={tone === 'success' ? 'check-circle' : 'error-outline'}
        size={iconSize('title-medium')}
        color={tone === 'success' ? colors['color-success-container'] : colors['color-error-container']}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <Text variant="body-medium" tone="inverse" style={styles.message}>
        {t(message)}
      </Text>
      {action !== undefined ? (
        <Pressable
          onPress={action.onPress}
          hitSlop={{ top: TOUCH_SLOP, bottom: TOUCH_SLOP, left: TOUCH_SLOP, right: TOUCH_SLOP }}
          accessible
          accessibilityRole="button"
          accessibilityLabel={t(action.label)}
          style={styles.control}
        >
          <Text variant="label-large" style={styles.action}>
            {t(action.label)}
          </Text>
        </Pressable>
      ) : null}
      {dismissible ? (
        <Pressable
          onPress={() => onDismiss?.()}
          hitSlop={{ top: TOUCH_SLOP, bottom: TOUCH_SLOP, left: TOUCH_SLOP, right: TOUCH_SLOP }}
          accessible
          accessibilityRole="button"
          accessibilityLabel={t('action.close')}
          style={styles.control}
        >
          <MaterialIcons name="close" size={iconSize('title-medium')} color={colors['color-inverse-on-surface']} accessibilityElementsHidden />
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.small,
    borderRadius: shape.medium,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.medium,
  },
  message: { flex: 1 },
  control: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: iconSize('title-medium'),
  },
  action: { color: colors['color-inverse-primary'], textDecorationLine: 'underline' },
});
