// Email job payload types (rule J3: payloads hold IDs and the recipient, never a secret).
// For codes and links the JOB generates the value, hashes it, stores the hash and sends the raw
// value only inside the message (skill rowta-notifications-email-recipes section 5) — that is why
// no payload below carries a code, password, verifier or token string.
export type EmailJobData =
  | { kind: 'signupCode'; email: string }
  | { kind: 'signupNotice'; email: string }
  | { kind: 'welcome'; userId: string }
  | { kind: 'resetCode'; email: string }
  | { kind: 'magicLink'; email: string };

export type EmailJobKind = EmailJobData['kind'];

export interface EmailJobResult {
  kind: EmailJobKind;
  sent: boolean;
}
