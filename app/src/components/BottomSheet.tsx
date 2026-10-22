// BottomSheet — modal sheet (rules X4, X1, X5, X6, U5, X8, A13-adjacent navigation).
//
// States: open (slides up over motion.bottomSheet; under reduce-motion it appears in place, X8) | closed
//         (unmounted).
// Focus (X4): focus moves INTO the sheet when it opens (the close button, or the caller's initialFocusRef),
//         Android back closes it (Modal onRequestClose), and focus returning to the opener is the caller's job in
//         onClose — the sheet never traps focus permanently (never trap focus outside a modal, U7/X4 note).
// Scrim:   colour-scrim token dimmed with state.disabledContent — the design system ships a scrim COLOUR but no
//         scrim alpha, so the closest accepted state opacity is used and the gap is reported, never invented (U5).
// Gesture: no drag-to-dismiss; every dismissal has a BUTTON (scrim tap, close control, Android back — X11).
// Width:   the sheet is width 100% capped at CONTENT_MAX_WIDTH and centred, so on a wide desktop viewport it
//          matches the auth card's column instead of spanning the browser (phones stay full width); title,
//          children and full-width buttons all live inside the sheet's horizontal padding either way.
// Props: visible, onClose, titleKey (optional heading), initialFocusRef, children, testID.
import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  type PressableInstance,
  type TextInstance,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors, shape, spacing, state } from '../theme/tokens';
import { MIN_TOUCH_TARGET, TOUCH_SLOP, CONTENT_MAX_WIDTH, iconSize } from '../theme/layout';
import { elevated } from '../theme/shadows';
import { motion } from '../theme/motion';
import { focusOn, useReducedMotion } from '../lib/a11y';
import { t, type MessageKey } from '../i18n/en';
import { Text } from './Text';

export type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Optional catalog heading; the sheet focuses it when present, otherwise the close control. */
  titleKey?: MessageKey;
  /** Caller-supplied target to focus on open (X4); defaults to the sheet's own close button. */
  initialFocusRef?: { current: unknown };
  children?: React.ReactNode;
  testID?: string;
};

export function BottomSheet({ visible, onClose, titleKey, initialFocusRef, children, testID }: BottomSheetProps) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const closeRef = useRef<PressableInstance>(null);
  const headingRef = useRef<TextInstance>(null);
  const [sheetHeight, setSheetHeight] = useState(0);

  useEffect(() => {
    if (!visible) return;
    if (reduced) {
      progress.value = 1;
      return;
    }
    progress.value = 0;
    progress.value = withTiming(1, { duration: motion.bottomSheet });
    return () => {
      cancelAnimation(progress);
    };
  }, [visible, reduced, progress]);

  // The sheet starts exactly one own-height below the screen: no invented travel distance (U5).
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * sheetHeight }],
  }));

  const moveFocusIn = () => {
    const target = initialFocusRef?.current ?? (titleKey !== undefined ? headingRef.current : closeRef.current);
    focusOn(target);
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} onShow={moveFocusIn}>
      <Pressable
        style={[styles.scrim, { backgroundColor: colors['color-scrim'], opacity: state.disabledContent }]}
        onPress={onClose}
        accessible
        accessibilityRole="button"
        accessibilityLabel={t('action.close')}
        testID={testID !== undefined ? `${testID}-scrim` : undefined}
      />
      <Animated.View
        testID={testID}
        onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}
        style={[styles.sheet, { backgroundColor: colors['color-surface-container'] }, elevated('medium'), animatedStyle]}
      >
        <View style={styles.header}>
          {titleKey !== undefined ? (
            <Text ref={headingRef} variant="title-medium" accessibilityRole="header" style={styles.title} numberOfLines={2}>
              {t(titleKey)}
            </Text>
          ) : (
            <View style={styles.spacer} />
          )}
          <Pressable
            ref={closeRef}
            onPress={onClose}
            hitSlop={{ top: TOUCH_SLOP, bottom: TOUCH_SLOP, left: TOUCH_SLOP, right: TOUCH_SLOP }}
            accessible
            accessibilityRole="button"
            accessibilityLabel={t('action.close')}
            style={styles.close}
            testID={testID !== undefined ? `${testID}-close` : undefined}
          >
            <MaterialIcons name="close" size={iconSize('title-large')} color={colors['color-on-surface-variant']} accessibilityElementsHidden />
          </Pressable>
        </View>
        {children}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: StyleSheet.absoluteFill,
  sheet: {
    position: 'absolute',
    bottom: 0,
    alignSelf: 'center',
    width: '100%',
    maxWidth: CONTENT_MAX_WIDTH,
    borderTopLeftRadius: shape.extraLarge,
    borderTopRightRadius: shape.extraLarge,
    paddingHorizontal: spacing.base,
    paddingTop: spacing.large,
    paddingBottom: spacing.extraLarge,
    gap: spacing.base,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.small },
  title: { flex: 1 },
  spacer: { flex: 1 },
  close: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
