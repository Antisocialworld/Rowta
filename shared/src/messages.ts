// The server-facing slice of the message catalog (PRD section 11; rules A5, A6, U8, V5).
//
// These are the EXACT strings from PRD section 11. The server returns them as `message` text so
// the gate can prove every failure message equals the catalog (grep gate); the app keeps the same
// wording in its catalog file (app/src/i18n/en.ts, added when the auth views land) and maps error
// CODES to text (V5) instead of ever showing raw server text.
//
// NEVER change a value here without the owner, and NEVER add a string that confirms or denies
// whether an email or account exists (A5, A6).
export const AUTH_MESSAGES = {
  'auth.signIn.failed': 'Invalid email or password.',
  'auth.signUp.submitted': 'Check your email for a code to finish creating your account.',
  'auth.code.invalid': 'Invalid or expired code.',
  'auth.forgot.submitted': 'If that email is registered, we have sent instructions to it.',
  'auth.magic.submitted': 'If that email is registered, we have sent a sign-in link to it.',
  'auth.link.invalid': 'This link is invalid or has expired. Request a new one.',
  'auth.rateLimited': 'Too many attempts. Please wait before trying again.',
  'auth.reset.done': 'Password updated. Sign in with your new password.',
  'generic.error': 'Something went wrong. Try again.',
} as const;

export type AuthMessageKey = keyof typeof AUTH_MESSAGES;

/** Look up a catalog text. Throws on an unknown key so a typo cannot ship a non-catalog string. */
export function authMessage(key: AuthMessageKey): string {
  return AUTH_MESSAGES[key];
}
