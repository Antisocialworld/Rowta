// MESSAGE CATALOG — the ONLY place user-facing text lives in the app (rule U8, PRD 11).
// Nothing may be hand-written in a component: every title, heading, label, hint, error, button word and
// announcement comes from here through t() below. Server error codes map to these keys (V5); raw server or
// Zod text never reaches a screen.
//
// RULE (PRD 11, rules A5/A6): never add a string that confirms or denies that an email or account exists.
// Fixed wording: the block marked PRD 11 is copied from .agents/PRD/PRD-001-rowta.md section 11 and must not be
// reworded. In that table the trailing "(announced once)" on auth.code.resendWait and auth.code.resendReady is a
// behaviour note for the agent, not part of the spoken text, so it is kept as a comment here and never announced.

export const en = {
  // ---------------------------------------------------------------- PRD 11 fixed wording (do not reword)
  'auth.signIn.failed': 'Invalid email or password.',
  'auth.signUp.submitted': 'Check your email for a code to finish creating your account.',
  'auth.code.invalid': 'Invalid or expired code.',
  'auth.forgot.submitted': 'If that email is registered, we have sent instructions to it.',
  'auth.magic.submitted': 'If that email is registered, we have sent a sign-in link to it.',
  'auth.link.invalid': 'This link is invalid or has expired. Request a new one.',
  'auth.rateLimited': 'Too many attempts. Try again in a few minutes.',
  'auth.code.hint': 'Enter the 6-digit code we sent to {email}.',
  'auth.code.expiresIn': 'The code expires in 5 minutes.',
  'auth.code.expired': 'This code has expired. Send a new code.',
  'auth.code.resendIn': 'Send a new code in {time}',
  'auth.code.resend': 'Send a new code',
  // announced once (polite live region) when the screen opens:
  'auth.code.resendWait': 'You can ask for a new code in 60 seconds.',
  'auth.ready.signUp':
    'Enter your name, a valid email, choose your country, a password that meets the rules, and the same password again.',
  'auth.ready.signIn': 'Enter your email and your password.',
  'auth.ready.forgot': 'Enter a valid email address.',
  'auth.ready.resetNew': 'Choose a password that meets the rules and enter it again to match.',
  'auth.ready.code': 'Enter all 6 digits of the code.',
  // announced once (polite live region) when resend becomes available:
  'auth.code.resendReady': 'You can now send a new code.',
  'auth.reset.done': 'Password updated. Sign in with your new password.',
  'auth.password.tooShort': 'Minimum of 8 characters',
  'auth.password.uppercase': 'Password must contain an uppercase letter',
  'auth.password.lowercase': 'Password must contain a lowercase letter',
  'auth.password.numberOrSpecial': 'Password must contain a number or a special character (#@>^%*+=$&)',
  'auth.password.tooLong': 'Use 128 characters or fewer.',
  'auth.password.mismatch': 'The two passwords do not match.',
  'auth.rule.met': 'Met',
  'auth.rule.notMet': 'Not met',
  'auth.email.invalid': 'Enter a valid email address.',
  'auth.name.required': 'Enter your name.',
  'auth.name.tooLong': 'Use 60 characters or fewer.',
  'auth.magic.confirm': 'Sign in to Rowta',
  'auth.magic.button': 'Sign in',
  'auth.field.required': 'This field is required.',
  'auth.deleteOwner.blocked': 'Transfer or delete your team first.',
  'generic.error': 'Something went wrong. Try again.',
  // Server 422 field codes (routes.ts fieldCode) that are not PRD-11 rows above, and the 429
  // countdown line. The countdown is VISUAL only — the announcement is the fixed auth.rateLimited
  // line above, so screen readers are not spammed every second.
  'validation.invalid': 'This value is not valid.',
  'validation.unknown_field': 'This field is not expected here.',
  'validation.too_long': 'Use fewer characters.',
  'validation.name_invalid': "Use letters, numbers, spaces, apostrophes or hyphens.",
  'validation.country': 'Choose a country from the list.',
  'auth.countries.unavailable': 'The country list could not be loaded.',
  'auth.rateLimit.retryIn': 'Try again in {seconds} seconds.',

  // ---------------------------------------------------------------- view chrome (PRD 6.1: title + heading per view)
  'auth.view.signIn.title': 'Sign in',
  'auth.view.signIn.heading': 'Sign in to Rowta',
  'auth.view.signUp.title': 'Create account',
  'auth.view.signUp.heading': 'Create your account',
  'auth.view.verifyCode.title': 'Enter the 6-digit code',
  'auth.view.verifyCode.heading': 'Enter your code',
  'auth.view.forgot.title': 'Forgot password',
  'auth.view.forgot.heading': 'Reset your password',
  'auth.view.resetCode.title': 'Enter reset code',
  'auth.view.resetCode.heading': 'Enter the code we sent you',
  'auth.view.resetNewPassword.title': 'Set a new password',
  'auth.view.resetNewPassword.heading': 'Choose a new password',
  'auth.view.magicRequest.title': 'Sign in by email link',
  'auth.view.magicRequest.heading': 'Email me a sign-in link',
  'auth.view.magicSent.title': 'Check your email',
  'auth.view.magicSent.heading': 'Check your email for a sign-in link',
  // magicConfirm has no line of its own: its title is auth.magic.confirm and its one button is auth.magic.button.
  'auth.view.acceptInvite.title': 'Accept invite',
  'auth.view.acceptInvite.heading': 'You have been invited to a team',

  // ---------------------------------------------------------------- fields and actions
  'field.email': 'Email',
  'field.password': 'Password',
  'field.newPassword': 'New password',
  'field.confirmPassword': 'Confirm new password',
  'field.name': 'Name',
  'field.country': 'Country',
  'field.code': '6-digit code',
  'action.signIn': 'Sign in',
  'action.createAccount': 'Create account',
  'action.verify': 'Verify',
  'action.sendLink': 'Email me a link',
  'action.continue': 'Continue',
  'action.back': 'Back',
  'action.cancel': 'Cancel',
  'action.retry': 'Try again',
  'action.close': 'Close',
  'action.delete': 'Delete',
  'action.edit': 'Edit',
  'action.showPassword': 'Show password',
  'action.hidePassword': 'Hide password',
  'action.resetPassword': 'Reset password',
  'action.signOut': 'Sign out',
  'action.backToSignIn': 'Back to sign in',
  'brand.logo': 'Rowta',
  'generic.loading': 'Loading',
  'generic.loadingLong': 'Loading, please wait',
  'generic.empty.title': 'Nothing here yet',
  'generic.empty.body': 'When there is something to show, it appears here.',
  'generic.error.title': 'Something went wrong',
  'generic.error.body': 'The list could not be loaded.',
  'generic.endOfList': 'You have reached the end of the list.',
  'toast.saved': 'Saved',
  'home.placeholder.title': 'You are signed in',
  'home.placeholder.body': 'The Dashboard arrives in Phase 8. This is the signed-in placeholder.',
  'gallery.title': 'Component gallery',
  'gallery.body': 'Every component in every state, for review and screenshots.',
  'gallery.section.text': 'Text',
  'gallery.section.buttons': 'Buttons',
  'gallery.section.inputs': 'Inputs',
  'gallery.section.cards': 'Cards',
  'gallery.section.status': 'Status and feedback',
  'gallery.section.overlays': 'Overlays',
  'gallery.section.size': 'Size matrix',
  'gallery.showToast': 'Show toast',
  'gallery.hideToast': 'Hide toast',
  'gallery.openSheet': 'Open bottom sheet',
  'gallery.openDialog': 'Open confirm dialog',
  'gallery.demo.announce': 'Announce change',
  'gallery.demo.busy': 'Busy',
  'gallery.badge.upcoming': 'Upcoming',
  'gallery.badge.open': 'Open',
  'gallery.matrix.current': 'This window',
  'gallery.glyph': 'Aa',
} as const;

export type MessageKey = keyof typeof en;
export type Messages = typeof en;

/** Runtime guard for values that arrive as strings (server field codes): unknown keys fall back
 *  to generic.error instead of ever rendering raw server text (V5, U8). */
export function isMessageKey(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}

/** Params are substituted for {name} placeholders. Unknown keys are impossible: MessageKey is a union. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const text: string = en[key];
  if (params === undefined) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

/** Every key in the catalog, for the string gate and the gallery. */
export const messageKeys = Object.keys(en) as MessageKey[];
