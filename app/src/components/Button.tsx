// Button — ONE component owns every button state (skill §48; rules X14, X6, X1, U5, U8, X8).
//
// Variants: primary | secondary | ghost | danger — colours come from tokens.ts only (U5), each pairing measured
//           in docs/a11y/contrast.md (X5).
// States:   ready      full contrast, accepts presses.
//           not ready  dimmed with state.disabledContent, accessibilityState={{disabled:true}}, STILL focusable,
//                      NEVER the native `disabled` prop (X14a). The reason is rendered under the button and is
//                      copied into accessibilityHint (X14b).
//           pressed    scale + dim over motion.press ms; under reduce-motion only the dim applies (X8, U6).
//           focused    a RING-thick border in the variant's content colour that is ALWAYS laid out (unfocused it
//                      matches the background), so focusing never shifts the layout; >= 3:1 against the button.
//           busy       spinner, repeat taps ignored, accessibilityState={{busy:true}} (X14g).
// Props:    label is the ONLY words prop: the visible text and the accessible name come from the same catalog
//           key, so an icon-only button can never be unnamed (X1) and a text button can never show one word while
//           announcing another (WCAG 2.5.3, X14h). reason/ready/busy/onNotReady/variant/icon/iconOnly/fullWidth/
//           testID as above.
// Behaviour: pressing while not ready or busy NEVER calls onPress. Not ready calls onNotReady (the screen moves
//           focus to the first problem and announces the reason, X14c); with no handler this component announces
//           the reason itself so X14(c) can never be silent. Reasons are format-only words from the catalog (A6).
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors, shape, spacing, state } from '../theme/tokens';
import { MIN_TOUCH_TARGET, RING, iconSize } from '../theme/layout';
import { motion } from '../theme/motion';
import { announce, useReducedMotion } from '../lib/a11y';
import { t, type MessageKey } from '../i18n/en';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type IconName = ComponentProps<typeof MaterialIcons>['name'];

// bg = container, content = label/icon colour (also the focus-ring colour: content always clears 3:1 on its bg).
const VARIANTS: Record<ButtonVariant, { bg: string; content: string }> = {
  primary: { bg: colors['color-primary'], content: colors['color-on-primary'] },
  secondary: { bg: colors['color-secondary-container'], content: colors['color-on-secondary-container'] },
  ghost: { bg: colors['color-surface-container-high'], content: colors['color-primary'] },
  danger: { bg: colors['color-error'], content: colors['color-on-error'] },
};

export type ButtonProps = {
  /** Catalog key for the words AND the accessible name. */
  label: MessageKey;
  onPress: () => void;
  variant?: ButtonVariant;
  /** Form validity; false = not ready (X14a). */
  ready?: boolean;
  /** Catalog key for the format reason the button waits (X14b). */
  reason?: MessageKey;
  /** A request is running: spinner, taps ignored (X14g). */
  busy?: boolean;
  /** Screen handler for a not-ready press: focus the first problem field, announce the reason (X14c). */
  onNotReady?: () => void;
  /** MaterialIcons name; with iconOnly the text is not rendered but label stays the accessible name (X14h). */
  icon?: IconName;
  iconOnly?: boolean;
  fullWidth?: boolean;
  testID?: string;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function Button({
  label,
  onPress,
  variant = 'primary',
  ready = true,
  reason,
  busy = false,
  onNotReady,
  icon,
  iconOnly = false,
  fullWidth = true,
  testID,
}: ButtonProps) {
  const [focused, setFocused] = useState(false);
  const reduced = useReducedMotion();
  const pressed = useSharedValue(0);
  const v = VARIANTS[variant];
  const waiting = ready === false;

  const press = () => {
    if (busy) return;
    if (waiting) {
      if (onNotReady !== undefined) onNotReady();
      else if (reason !== undefined) announce(t(reason));
      return;
    }
    onPress();
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - (reduced ? 0 : state.pressed / 2) * pressed.value }],
    opacity: 1 - state.pressed * pressed.value,
  }));

  return (
    <View style={[styles.root, fullWidth ? styles.stretch : styles.inline]}>
      <AnimatedPressable
        testID={testID}
        onPress={press}
        onPressIn={() => {
          pressed.value = withTiming(1, { duration: motion.press });
        }}
        onPressOut={() => {
          pressed.value = withTiming(0, { duration: motion.press });
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessible
        accessibilityRole="button"
        accessibilityLabel={t(label)}
        accessibilityHint={waiting && reason !== undefined ? t(reason) : undefined}
        accessibilityState={{ disabled: waiting || busy, busy }}
        style={[
          styles.box,
          { backgroundColor: v.bg, borderColor: focused ? v.content : v.bg },
          iconOnly && styles.square,
          waiting && styles.dimmed,
          animatedStyle,
        ]}
      >
        {busy ? (
          <ActivityIndicator color={v.content} />
        ) : icon !== undefined ? (
          <MaterialIcons name={icon} size={iconSize('label-large')} color={v.content} accessibilityElementsHidden />
        ) : null}
        {iconOnly ? null : (
          <Text variant="label-large" style={{ color: v.content }}>
            {t(label)}
          </Text>
        )}
      </AnimatedPressable>
      {waiting && reason !== undefined ? (
        <Text variant="body-small" tone="secondary" style={styles.reason}>
          {t(reason)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.extraSmall },
  stretch: { alignSelf: 'stretch' },
  inline: { alignSelf: 'flex-start' },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.small,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.large,
    paddingVertical: spacing.medium,
    borderRadius: shape.medium,
    borderWidth: RING,
  },
  square: { minWidth: MIN_TOUCH_TARGET, paddingHorizontal: spacing.small },
  dimmed: { opacity: state.disabledContent },
  reason: { marginTop: spacing.extraSmall },
});
