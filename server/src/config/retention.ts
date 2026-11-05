// Retention and grace period configuration (rules D4 to D6, PRD 7.3, 8.10, 8.11).
//
// ONE configuration file holding all lifecycle, retention, and grace period numbers
// so they cannot drift between documentation, queries, and background purge jobs.

/**
 * Cutoff for purging used or expired short secrets, codes, and tokens:
 * hard-delete rows whose expiry passed more than 7 days ago.
 * Applies to: pending_signups, password_resets, magic_tokens, refresh_tokens, invites.
 */
export const TOKEN_EXPIRY_GRACE_DAYS = 7;
export const TOKEN_EXPIRY_GRACE_SECONDS = TOKEN_EXPIRY_GRACE_DAYS * 86_400;
export const TOKEN_EXPIRY_GRACE_MS = TOKEN_EXPIRY_GRACE_SECONDS * 1_000;

/**
 * Cutoff for purging idempotency records:
 * hard-delete keys whose created_at is older than 48 hours.
 */
export const IDEMPOTENCY_RETENTION_HOURS = 48;
export const IDEMPOTENCY_RETENTION_SECONDS = IDEMPOTENCY_RETENTION_HOURS * 3_600;
export const IDEMPOTENCY_RETENTION_MS = IDEMPOTENCY_RETENTION_SECONDS * 1_000;

/**
 * Maximum rows to delete in a single batch statement to prevent long table locks
 * and event loop delays (rules C6, D5).
 */
export const PURGE_BATCH_SIZE = 1_000;

/**
 * Account and team deletion grace period: 30 days before permanent hard purge.
 * (PRD 7.3, 8.10; used in PRD Phase 9 purge-soft-deleted).
 */
export const ACCOUNT_DELETION_GRACE_DAYS = 30;
export const TEAM_DELETION_GRACE_DAYS = 30;

/**
 * Soft-deleted shifts retention: 90 days.
 */
export const SHIFT_RETENTION_DAYS = 90;

/**
 * Payment grace period: 7 days.
 */
export const PAYMENT_GRACE_DAYS = 7;
