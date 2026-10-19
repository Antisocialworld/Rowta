// Skeleton — the loading placeholder (rules U6, U8, U10: skeletons for lists, a blank screen is a bug).
//
// Variants: text (one line at body height) | block (an area) | circle (an avatar-sized round).
// States:   pulsing (opacity breathes over motion.skeletonPulse with Reanimated) | static under reduce-motion
//           (X8: the end state applies at once, no looping animation).
// Colours:  surface-container-high fill only — no shimmer gradient, so no colour can escape the tokens (U5).
// Props:   variant, style (the caller sizes it with layout values or percentages), testID.
// Placement: inside loading lists and cards; NEVER where a spinner would block the whole screen (U6).
import { useEffect } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { colors, shape, spacing, state } from '../theme/tokens';
import { typeStyle } from '../theme/fonts';
import { motion } from '../theme/motion';
import { useReducedMotion } from '../lib/a11y';

export type SkeletonVariant = 'text' | 'block' | 'circle';

const DEFAULTS: Record<SkeletonVariant, StyleProp<ViewStyle>> = {
  text: { height: typeStyle('body-medium').lineHeight, width: '100%', borderRadius: shape.small },
  block: { height: spacing.veryLarge * 2, width: '100%', borderRadius: shape.large },
  circle: { width: spacing.veryLarge + spacing.medium, height: spacing.veryLarge + spacing.medium, borderRadius: shape.full },
};

export type SkeletonProps = {
  variant?: SkeletonVariant;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function Skeleton({ variant = 'text', style, testID }: SkeletonProps) {
  const reduced = useReducedMotion();
  const breath = useSharedValue(1);

  useEffect(() => {
    if (reduced) {
      breath.value = 1;
      return;
    }
    breath.value = withRepeat(
      withTiming(1 - state.dragged, { duration: motion.skeletonPulse }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(breath);
    };
  }, [reduced, breath]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: breath.value }));

  return (
    <Animated.View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[DEFAULTS[variant], { backgroundColor: colors['color-surface-container-high'] }, animatedStyle, style]}
    />
  );
}
