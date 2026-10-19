// FOCUS AND ANNOUNCEMENT HELPERS (rules U7, X3, X8).
// Verified against the installed React Native 0.88 types and https://reactnative.dev/docs/accessibilityinfo
// (fetched 2026-10-19): announceForAccessibility, isReduceMotionEnabled/reduceMotionChanged and
// sendAccessibilityEvent are current; setAccessibilityFocus is DEPRECATED there, so this module never calls it.
// The docs also note the focus target must be accessible (a heading with accessibilityRole="header" is).
import { AccessibilityInfo } from 'react-native';
import { useEffect, useState } from 'react';

/**
 * X3: announce a change to the screen reader immediately (errors, successes, view changes, not-ready reasons).
 * Politeness lives in LiveRegion components, whose text changes are read without interrupting; announce() is for
 * changes that are not already visible text. Never announce account existence (A6): the caller passes catalog text.
 */
export function announce(message: string): void {
  if (message.trim().length === 0) return;
  AccessibilityInfo.announceForAccessibility(message);
}

/**
 * U7: move accessibility focus to one target.
 * - A TextInput-like ref receives .focus() (input focus, which TalkBack follows).
 * - Anything else (a heading, a card) receives a `focus` accessibility event through sendAccessibilityEvent.
 * Returns whether a focus move was attempted, so callers can assert it in tests. [VERIFY on a device with
 * TalkBack: focus lands on the heading after a view change.]
 */
export function focusOn(target: unknown): boolean {
  if (target === null || target === undefined) return false;
  const candidate = target as { focus?: () => void };
  if (typeof candidate.focus === 'function') {
    candidate.focus();
    return true;
  }
  try {
    AccessibilityInfo.sendAccessibilityEvent(
      target as Parameters<typeof AccessibilityInfo.sendAccessibilityEvent>[0],
      'focus',
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * X8: true when the system asks for reduced motion — animations are then skipped and the end state applied at
 * once (motion durations in app/src/theme/motion.ts). Updates live when the setting changes.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value: boolean) => {
        if (active) setReduced(value);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value: boolean) => {
      setReduced(value);
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}
