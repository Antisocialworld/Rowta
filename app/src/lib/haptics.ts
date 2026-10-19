// HAPTICS ON KEY ACTIONS ONLY (rule U6): confirming a choice or signalling success/failure — never a haptic for
// every tap, and never information the user cannot also see or hear read out (X10).
// API verified against the installed expo-haptics build/Haptics.d.ts: impactAsync, selectionAsync and
// notificationAsync with NotificationFeedbackType. Every call is fire-and-forget with a catch, so a device with
// no vibration motor (or a rejected permission) can never break a press, and no promise floats (lint rule).
import * as Haptics from 'expo-haptics';

/** A key confirmation: accepting a dialog, finishing a step. */
export function hapticImpact(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
}

/** Success feedback paired with a visible/announced success message. */
export function hapticSuccess(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}

/** Failure feedback paired with a visible/announced error message. */
export function hapticError(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
}

/** Cheap tick for small state changes (a chip selected, a toggle flipped). */
export function hapticSelection(): void {
  void Haptics.selectionAsync().catch(() => undefined);
}
