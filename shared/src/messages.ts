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
  'auth.deleteOwner.blocked': 'Transfer or delete your team first.',
  'team.invite.sent': 'Invitation sent.',
  'team.seatLimit': 'Seat limit reached.',
  'team.name.required': 'Enter a team name.',
  'team.name.tooLong': 'Use 80 characters or fewer.',
  'team.notFound': 'Team not found.',
  'team.forbidden': 'You do not have permission to perform this action.',
  'team.restoreExpired': 'The 30-day restore window for this team has expired.',
  // Phase 4 — shifts, calendar, activity feed, search.
  'shift.notFound': 'Shift not found.',
  'shift.timeOrder': 'The end time must be after the start time.',
  'shift.time.invalid': 'Enter a valid date and time.',
  'shift.label.required': 'Enter a shift label.',
  'shift.label.tooLong': 'Use 100 characters or fewer.',
  'shift.notes.tooLong': 'Use 2000 characters or fewer.',
  'shift.assignee.invalid': 'Choose an active member of this team.',
  'shift.range.invalid': 'Choose a valid date range.',
  'shift.range.tooLong': 'Choose a range of 42 days or fewer.',
  'activity.cursor.invalid': 'This page link is not valid. Refresh the list.',
  'search.query.tooShort': 'Type at least 2 characters.',
  // Phase 5 — swaps.
  'swap.notFound': 'Swap request not found.',
  'swap.shift.notFound': 'Shift not found.',
  'swap.shift.inPast': 'Cannot swap a shift that has already ended.',
  'swap.shift.notAssigned': 'You can only request swaps on shifts assigned to you.',
  'swap.already_pending': 'A swap request is already pending for this shift.',
  'swap.target_invalid': 'Target colleague must be an active member of this team.',
  'swap.target_required': 'Approval requires a target colleague to reassign the shift to.',
  'swap.self_swap': 'Cannot request a swap with yourself.',
  'swap.not_pending': 'Swap request is not pending.',
  'swap.conflict': 'This swap request was already decided.',
  'swap.cannot_cancel': 'Cannot cancel a swap that is no longer pending.',
  'swap.assignee_changed': 'The shift is no longer assigned to the requester.',
  'swap.requester_removed': 'The requester is no longer an active member of this team.',
  'swap.shift_deleted': 'This shift was deleted, so this swap can no longer be approved or rejected.',
  'swap.decline_reason_required': 'Enter a decline reason.',
  'swap.decline_reason_invalid': 'Use 140 characters or fewer.',
  'swap.note_invalid': 'Use 140 characters or fewer.',
  // Phase 6 — user settings & quiet hours.
  'settings.empty': 'Provide at least one setting to update.',
  'settings.quiet_pair': 'Quiet hours start and end must be set or cleared together.',
  'settings.quiet_equal': 'Quiet hours start and end times cannot be equal.',
  'settings.quiet_invalid': 'Enter a valid time in 24-hour format (HH:MM).',
  'settings.time_zone_invalid': 'Choose a valid time zone.',
  'settings.language_invalid': 'Choose a valid language code.',
  'settings.theme_invalid': 'Choose a valid theme.',
  'generic.error': 'Something went wrong. Try again.',
} as const;

export type AuthMessageKey = keyof typeof AUTH_MESSAGES;

/** Look up a catalog text. Throws on an unknown key so a typo cannot ship a non-catalog string. */
export function authMessage(key: AuthMessageKey): string {
  return AUTH_MESSAGES[key];
}
