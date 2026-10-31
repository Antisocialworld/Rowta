// Button — ONE component owns every button state (skill §48; rules X14, X6, X1, U5, U8, X8).
//
// Variants: primary | secondary | ghost | danger — colours come from tokens.ts only (U5), each pairing measured
//           in docs/a11y/contrast.md (X5).
// States:   ready      full contrast, accepts presses.
//           not ready  dimmed via state.disabledContent INSIDE the animated style (Reanimated's inline opacity
//                      would otherwise override the static dim — proven in docs/gates), accessibilityState
//                      {{disabled:true}} for Android, aria-disabled set on the DOM node by the web shim
//                      (react-native-web 0.21 clobbers the prop — see platform/web-not-ready.ts), STILL
//                      focusable, NEVER the native `disabled` prop (X14a). The reason is rendered under the
//                      button, linked with aria-describedby on web and accessibilityHint in the app (X14b).
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
import { useEffect, useId, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors, shape, spacing, state } from '../theme/tokens';
import { MIN_TOUCH_TARGET, RING, iconSize } from '../theme/layout';
import { motion } from '../theme/motion';
import { announce, useReducedMotion } from '../lib/a11y';
import { t, type MessageKey } from '../i18n/en';
import { syncNotReadyDomState } from '../platform/web-not-ready';
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
  labelParams?: Record<string, string | number>;
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
  labelParams,
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
  const reasonDomId = useId();
  // Held as unknown because react-native's Pressable ref wants its private ReactNativeElement type
  // (not exported from the root); the shim only calls DOM methods when the instance has them (web).
  const controlRef = useRef<unknown>(null);
  const v = VARIANTS[variant];
  const waiting = ready === false;

  // Web DOM sync (X14a): runs after EVERY commit, so the imperative attribute can never go stale
  // when ready/busy flips (a ref callback alone was not re-invoked reliably under React 19 — probed).
  useEffect(() => {
    syncNotReadyDomState(controlRef.current, waiting || busy);
  });

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
    // X14a dim: Reanimated writes opacity inline, so a static dimmed style later in the array would
    // be overridden back to 1 (probed on web: computed opacity was 1 while not ready). The dim lives
    // HERE so both platforms keep it; pressed feedback still scales and dims.
    opacity: (waiting ? state.disabledContent : 1) * (1 - state.pressed * pressed.value),
  }));

  return (
    <View style={[styles.root, fullWidth ? styles.stretch : styles.inline]}>
      <AnimatedPressable
        testID={testID}
        ref={controlRef as never}
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
        accessibilityLabel={t(label, labelParams)}
        accessibilityHint={waiting && reason !== undefined ? t(reason) : undefined}
        accessibilityState={{ disabled: waiting || busy, busy }}
        // X14b web half: react-native-web never renders accessibilityHint (it has no mapping), so
        // the visible reason line is linked with the standard aria attribute on web; Android keeps
        // the hint above (X14b's app channel).
        aria-describedby={waiting && reason !== undefined ? reasonDomId : undefined}
        style={[styles.box, { backgroundColor: v.bg, borderColor: focused ? v.content : v.bg }, iconOnly && styles.square, animatedStyle]}
      >
        {busy ? (
          <ActivityIndicator color={v.content} />
        ) : icon !== undefined ? (
          <MaterialIcons name={icon} size={iconSize('label-large')} color={v.content} accessibilityElementsHidden />
        ) : null}
        {iconOnly ? null : (
          <Text variant="label-large" style={{ color: v.content }}>
            {t(label, labelParams)}
          </Text>
        )}
      </AnimatedPressable>
      {waiting && reason !== undefined ? (
        <Text variant="body-small" tone="secondary" nativeID={reasonDomId} style={styles.reason}>
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
  reason: { marginTop: spacing.extraSmall },
});
