// Email job payload types (rule J3: payloads hold IDs and the recipient, never a secret).
// For codes and links the JOB generates the value, hashes it, stores the hash and sends the raw
// value only inside the message (skill rowta-notifications-email-recipes section 5) — that is why
// no payload below carries a code, password, verifier or token string.
export type EmailJobData =
  | { kind: 'signupCode'; email: string }
  | { kind: 'signupNotice'; email: string }
  | { kind: 'welcome'; userId: string }
  | { kind: 'resetCode'; email: string }
  | { kind: 'magicLink'; email: string }
  | {
      kind: 'teamInvite';
      email: string;
      teamName: string;
      inviterName: string | null;
      role: string;
      token: string;
    }
  // T17 billing move notices.
  | { kind: 'transferStillPaying'; email: string; team: string; name: string; from: string }
  | { kind: 'moveRequested'; email: string; team: string; from: string; date: string }
  | { kind: 'moveAccepted'; email: string; team: string; name: string }
  | { kind: 'moveDeclined'; email: string; team: string; name: string }
  | { kind: 'moveCancelled'; email: string; team: string; from: string }
  | { kind: 'moveExpired'; email: string; team: string; name: string; date: string }
  | { kind: 'movePaymentNeeded'; email: string; team: string; name: string }
  | { kind: 'moveTrialStarted'; email: string; team: string; date: string }
  // A2 Admin notices when payer's plan changes.
  | { kind: 'billingPlanCancelled'; email: string; date: string }
  | { kind: 'billingPlanKept'; email: string }
  | { kind: 'billingPlanEnded'; email: string };

export type EmailJobKind = EmailJobData['kind'];

export interface EmailJobResult {
  kind: EmailJobKind;
  sent: boolean;
}
