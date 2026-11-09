// WelcomeScreen — Animated first-launch welcome screen (rules U1, U3, U5, X1, X8).
// Seamless hand-off from native splash, token-driven animations, skip control, and reduce-motion support.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { colors, spacing } from '../../theme/tokens';
import { typeStyle } from '../../theme/fonts';
import { useReducedMotion } from '../../lib/a11y';
import { t } from '../../i18n/en';
import {
  computeTileLayout,
  GEOMETRY,
  SCALE,
  shouldExitOnHardwareBack,
  TIMELINE,
  type LetterKey,
} from '../../lib/welcome-logic';
import { welcomeStore } from '../../lib/welcome-platform';
import { RowtaLogo } from './RowtaLogo';

export type WelcomeScreenProps = {
  /** Called when the welcome animation finishes or the user skips it. */
  onFinish: () => void;
};

const minTouchTarget = spacing.veryLarge + spacing.medium; // 44 pt minimum touch target (X6)
const skipLabelStyle = typeStyle('label-large');

export function WelcomeScreen({ onFinish }: WelcomeScreenProps) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const [finished, setFinished] = useState(false);
  const finishedRef = useRef(false);
  const skipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reanimated shared values
  const screenOpacity = useSharedValue(1);
  const pageProgress = useSharedValue(0);

  // Shared values for letter drops (fall + tilt + settle)
  const dropR = useSharedValue(0);
  const dropO = useSharedValue(0);
  const dropW = useSharedValue(0);
  const dropT = useSharedValue(0);
  const dropA = useSharedValue(0);

  // Shared values for letter pops (scale 1 -> 1.2 -> 1)
  const popR = useSharedValue(1);
  const popO = useSharedValue(1);
  const popW = useSharedValue(1);
  const popT = useSharedValue(1);
  const popA = useSharedValue(1);

  // Shared values for wordmark letters (fade + tiny rise)
  const wmR = useSharedValue(0);
  const wmO = useSharedValue(0);
  const wmW = useSharedValue(0);
  const wmT = useSharedValue(0);
  const wmA = useSharedValue(0);

  const completeWelcome = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (skipTimerRef.current) {
      clearTimeout(skipTimerRef.current);
      skipTimerRef.current = null;
    }
    setFinished(true);
    void welcomeStore.markSeen();
    onFinish();
  }, [onFinish]);

  // Clean up skip timer on unmount
  useEffect(() => {
    return () => {
      if (skipTimerRef.current) {
        clearTimeout(skipTimerRef.current);
        skipTimerRef.current = null;
      }
    };
  }, []);

  // Android hardware back: exits the app during the welcome screen
  useEffect(() => {
    if (!shouldExitOnHardwareBack(Platform.OS)) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      BackHandler.exitApp();
      return true;
    });
    return () => subscription.remove();
  }, []);

  // Hide the native splash once the first frame of the welcome screen is laid out
  const onLayoutRoot = useCallback(() => {
    void SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  // Run animations or respect reduce motion
  useEffect(() => {
    if (reducedMotion) {
      // Show finished logo statically for 1.2s, then hand over
      pageProgress.value = 1;
      dropR.value = 1;
      dropO.value = 1;
      dropW.value = 1;
      dropT.value = 1;
      dropA.value = 1;
      wmR.value = 1;
      wmO.value = 1;
      wmW.value = 1;
      wmT.value = 1;
      wmA.value = 1;

      const timer = setTimeout(() => {
        completeWelcome();
      }, TIMELINE.reducedMotionDuration * 1000);
      return () => clearTimeout(timer);
    }

    // Normal motion: orchestrate full timeline
    // 0.4s to 0.9s: page + base strip appear (fade and small rise)
    pageProgress.value = withDelay(
      TIMELINE.pageAppearStart * 1000,
      withTiming(1, { duration: (TIMELINE.pageAppearEnd - TIMELINE.pageAppearStart) * 1000, easing: Easing.out(Easing.ease) }),
    );

    // Letters drop: 0.4s each, slight tilt (~14deg) settling with overshoot
    const dropEasing = Easing.bezier(0.34, 1.3, 0.64, 1); // slight overshoot curve
    const dropDuration = 400;

    dropR.value = withDelay(TIMELINE.letterDrops.R.start * 1000, withTiming(1, { duration: dropDuration, easing: dropEasing }));
    dropO.value = withDelay(TIMELINE.letterDrops.O.start * 1000, withTiming(1, { duration: dropDuration, easing: dropEasing }));
    dropW.value = withDelay(TIMELINE.letterDrops.W.start * 1000, withTiming(1, { duration: dropDuration, easing: dropEasing }));
    dropT.value = withDelay(TIMELINE.letterDrops.T.start * 1000, withTiming(1, { duration: dropDuration, easing: dropEasing }));
    dropA.value = withDelay(TIMELINE.letterDrops.A.start * 1000, withTiming(1, { duration: dropDuration, easing: dropEasing }));

    // 4.8s onward: letter pops (scale 1 -> 1.2 -> 1, 0.3s each)
    const popSequence = () =>
      withSequence(
        withTiming(1.2, { duration: 150, easing: Easing.out(Easing.quad) }),
        withTiming(1.0, { duration: 150, easing: Easing.in(Easing.quad) }),
      );

    popR.value = withDelay(TIMELINE.letterPops.R.start * 1000, popSequence());
    popO.value = withDelay(TIMELINE.letterPops.O.start * 1000, popSequence());
    popW.value = withDelay(TIMELINE.letterPops.W.start * 1000, popSequence());
    popT.value = withDelay(TIMELINE.letterPops.T.start * 1000, popSequence());
    popA.value = withDelay(TIMELINE.letterPops.A.start * 1000, popSequence());

    // Wordmark typing: each letter fades in with tiny rise, 0.25s each
    const wmDuration = 250;
    const wmEasing = Easing.out(Easing.quad);

    wmR.value = withDelay(TIMELINE.wordmarkTypes.R.start * 1000, withTiming(1, { duration: wmDuration, easing: wmEasing }));
    wmO.value = withDelay(TIMELINE.wordmarkTypes.o.start * 1000, withTiming(1, { duration: wmDuration, easing: wmEasing }));
    wmW.value = withDelay(TIMELINE.wordmarkTypes.w.start * 1000, withTiming(1, { duration: wmDuration, easing: wmEasing }));
    wmT.value = withDelay(TIMELINE.wordmarkTypes.t.start * 1000, withTiming(1, { duration: wmDuration, easing: wmEasing }));
    wmA.value = withDelay(TIMELINE.wordmarkTypes.a.start * 1000, withTiming(1, { duration: wmDuration, easing: wmEasing }));

    // 9.0s to 9.4s: screen fade out over 0.4s
    screenOpacity.value = withDelay(
      TIMELINE.totalSeconds * 1000,
      withTiming(0, { duration: TIMELINE.fadeDuration * 1000, easing: Easing.inOut(Easing.ease) }),
    );

    const totalTimer = setTimeout(() => {
      completeWelcome();
    }, (TIMELINE.totalSeconds + TIMELINE.fadeDuration) * 1000);

    return () => {
      clearTimeout(totalTimer);
      cancelAnimation(screenOpacity);
      cancelAnimation(pageProgress);
      cancelAnimation(dropR);
      cancelAnimation(dropO);
      cancelAnimation(dropW);
      cancelAnimation(dropT);
      cancelAnimation(dropA);
      cancelAnimation(popR);
      cancelAnimation(popO);
      cancelAnimation(popW);
      cancelAnimation(popT);
      cancelAnimation(popA);
      cancelAnimation(wmR);
      cancelAnimation(wmO);
      cancelAnimation(wmW);
      cancelAnimation(wmT);
      cancelAnimation(wmA);
    };
  }, [reducedMotion, completeWelcome]);

  // Skip handler: jump to end state immediately and complete handover
  const handleSkip = useCallback(() => {
    if (finishedRef.current) return;

    cancelAnimation(screenOpacity);
    cancelAnimation(pageProgress);
    pageProgress.value = 1;
    dropR.value = 1;
    dropO.value = 1;
    dropW.value = 1;
    dropT.value = 1;
    dropA.value = 1;
    popR.value = 1;
    popO.value = 1;
    popW.value = 1;
    popT.value = 1;
    popA.value = 1;
    wmR.value = 1;
    wmO.value = 1;
    wmW.value = 1;
    wmT.value = 1;
    wmA.value = 1;

    // Quick 150ms fade to seamless sign-in without calling JS functions from the UI thread
    screenOpacity.value = withTiming(0, { duration: 150 });

    if (skipTimerRef.current) clearTimeout(skipTimerRef.current);
    skipTimerRef.current = setTimeout(() => {
      completeWelcome();
    }, 160);
  }, [
    completeWelcome,
    screenOpacity,
    pageProgress,
    dropR,
    dropO,
    dropW,
    dropT,
    dropA,
    popR,
    popO,
    popW,
    popT,
    popA,
    wmR,
    wmO,
    wmW,
    wmT,
    wmA,
  ]);

  // Layout positioning matching native splash
  const layout = computeTileLayout(windowWidth, windowHeight);

  // Animated styles
  const screenAnimatedStyle = useAnimatedStyle(() => ({
    opacity: screenOpacity.value,
  }));

  const animatedPageStyle = useAnimatedStyle(() => {
    const p = pageProgress.value;
    const riseOffset = (1 - p) * 12; // small 12pt rise
    return {
      opacity: p,
      transform: [{ translateY: riseOffset }],
    };
  });

  const createLetterDropStyle = (dropVal: typeof dropR, popVal: typeof popR) =>
    useAnimatedStyle(() => {
      const p = dropVal.value;
      const initialDropY = -(GEOMETRY.tile.size * SCALE + 24);
      const translateY = (1 - p) * initialDropY;
      const rotationDeg = (1 - p) * 14; // 14deg tilt during fall, settles at 0deg
      const scale = popVal.value;

      return {
        opacity: p > 0.01 ? 1 : 0,
        transform: [
          { translateY },
          { rotate: `${rotationDeg}deg` },
          { scale },
        ],
      };
    });

  const animatedLetterStyles: Record<LetterKey, ReturnType<typeof createLetterDropStyle>> = {
    R: createLetterDropStyle(dropR, popR),
    O: createLetterDropStyle(dropO, popO),
    W: createLetterDropStyle(dropW, popW),
    T: createLetterDropStyle(dropT, popT),
    A: createLetterDropStyle(dropA, popA),
  };

  const createWordmarkStyle = (val: typeof wmR) =>
    useAnimatedStyle(() => {
      const p = val.value;
      const translateY = (1 - p) * 6; // tiny 6pt rise
      return {
        opacity: p,
        transform: [{ translateY }],
      };
    });

  const animatedWordmarkStyles = {
    R: createWordmarkStyle(wmR),
    o: createWordmarkStyle(wmO),
    w: createWordmarkStyle(wmW),
    t: createWordmarkStyle(wmT),
    a: createWordmarkStyle(wmA),
  };

  if (finished) return null;

  return (
    <Animated.View
      style={[
        styles.screen,
        { backgroundColor: colors['color-pry-98'] },
        screenAnimatedStyle,
      ]}
      onLayout={onLayoutRoot}
    >
      {/* Skip Button */}
      <View style={[styles.skipContainer, { top: insets.top + spacing.small }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('welcome.skip')}
          hitSlop={spacing.small}
          style={styles.skipButton}
          onPress={handleSkip}
        >
          <Animated.Text
            style={[
              skipLabelStyle,
              { color: colors['color-primary'] },
            ]}
          >
            {t('welcome.skip')}
          </Animated.Text>
        </Pressable>
      </View>

      {/* Perfectly Centred Logo Matching Native Splash */}
      <View
        style={[
          styles.logoWrapper,
          {
            left: layout.tileLeft,
            top: layout.tileTop,
          },
        ]}
      >
        <RowtaLogo
          animatedPageStyle={animatedPageStyle}
          animatedLetterStyles={animatedLetterStyles}
          animatedWordmarkStyles={animatedWordmarkStyles}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    ...StyleSheet.absoluteFill,
    zIndex: 9999,
  },
  skipContainer: {
    position: 'absolute',
    right: spacing.base,
    zIndex: 10000,
  },
  skipButton: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.medium,
  },
  logoWrapper: {
    position: 'absolute',
  },
});

