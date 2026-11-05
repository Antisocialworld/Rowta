// magic-request-logic.ts — pure state decision and reset for MagicRequestView (M1; rules U1, U7, X3).
// Allows unit testing without React rendering or device emulator.

export type MagicRequestPhase = 'request' | 'submitted';

/** Pure phase resolver: decides whether to render the email input form or the confirmation card. */
export function resolveMagicRequestPhase(submitted: boolean): MagicRequestPhase {
  return submitted ? 'submitted' : 'request';
}

/** Pure reset helper: resets the submission flag and clears email for "Use a different email". */
export function resetMagicRequestState(): { submitted: false; email: string } {
  return { submitted: false, email: '' };
}

