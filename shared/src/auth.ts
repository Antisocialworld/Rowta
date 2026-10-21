// Shared Zod schemas for every auth form, request and response (rules V1 to V8, A8, A9).
//
// Written ONCE here and imported by BOTH the app (client validation, not-ready buttons, V6) and
// the server (authoritative validation, V2). Strict objects reject unknown keys (V3). Emails are
// normalised in the schema itself (V4): NFKC, trimmed, lower-cased. The password is NEVER
// transformed here (A8: never alter the password); the server applies NFKC itself before hashing.
import { z } from 'zod';
import {
  CODE_TTL_SECONDS,
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  RESEND_COOLDOWN_SECONDS,
  RESET_GRANT_TTL_SECONDS,
} from './constants.ts';

/** NFKC + trim + lower-case, the normalised form used for storage, lookup and rate-limit keys (V4, A7). */
export function normaliseEmail(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

export const emailField = z
  .string()
  .transform((value) => normaliseEmail(value))
  .pipe(z.string().min(3).max(254).email());

export const passwordField = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

export const displayNameField = z
  .string()
  .transform((value) => value.normalize('NFKC').trim())
  .pipe(
    z
      .string()
      .min(DISPLAY_NAME_MIN_LENGTH)
      .max(DISPLAY_NAME_MAX_LENGTH)
      // V8: no control characters or line breaks (Cc covers \n and \r; Cf covers format controls).
      .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), { message: 'control characters are not allowed' })
      // V8: letters, marks, numbers, spaces, apostrophes and hyphens are allowed.
      .refine((value) => /^[\p{L}\p{M}\p{N} '’-]+$/u.test(value), { message: 'unsupported characters' }),
  );

// The country must be an ISO-style two-letter code; the server then checks it against the
// `countries` table (PRD 8.1). Format only here, membership there.
export const countryField = z.string().regex(/^[A-Z]{2}$/);

export const codeField = z.string().regex(/^\d{6}$/);

// selector.verifier (A3): structure is checked by the server against the row it finds; the schema
// only bounds the size so a giant string cannot reach a lookup.
export const tokenField = z.string().min(1).max(2048);

export const deviceIdField = z.string().min(1).max(128);

// ---------------------------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------------------------

export const signUpSchema = z
  .strictObject({
    displayName: displayNameField,
    email: emailField,
    country: countryField,
    password: passwordField,
    confirm: passwordField,
  })
  .refine((value) => value.password === value.confirm, {
    message: 'passwords do not match',
    path: ['confirm'],
  });

export const verifyCodeSchema = z.strictObject({
  email: emailField,
  code: codeField,
});

export const resendCodeSchema = z.strictObject({
  email: emailField,
});

// V7: sign-in checks ONLY that the email looks like an email and the password is not empty.
export const signInSchema = z.strictObject({
  email: emailField,
  password: z.string().min(1),
});

export const refreshSchema = z.strictObject({
  refreshToken: tokenField,
  deviceId: deviceIdField.optional(),
});

export const logoutSchema = z.strictObject({
  refreshToken: tokenField,
});

export const forgotSchema = z.strictObject({
  email: emailField,
});

export const resetCodeSchema = z.strictObject({
  email: emailField,
  code: codeField,
});

export const resetNewPasswordSchema = z
  .strictObject({
    grant: tokenField,
    newPassword: passwordField,
    confirm: passwordField,
  })
  .refine((value) => value.newPassword === value.confirm, {
    message: 'passwords do not match',
    path: ['confirm'],
  });

export const magicRequestSchema = z.strictObject({
  email: emailField,
});

// The magic token arrives ONLY as a POST body from the confirm button, never as a query string
// and never from a GET (A13, PRD 8.1).
export const magicConsumeSchema = z.strictObject({
  token: tokenField,
});

// ---------------------------------------------------------------------------------------------
// Response schemas (for the app and for tests; the server builds these shapes)
// ---------------------------------------------------------------------------------------------

/** Uniform-message responses (sign-up, resend, forgot, magic request, reset done). */
export const messageResponseSchema = z.strictObject({
  message: z.string(),
});

/** Empty data envelope for endpoints whose success body is `{}` (logout, logout-all). */
export const emptyResponseSchema = z.strictObject({});

/**
 * Success responses for the flows that sign someone in (sign-in, verify code, refresh,
 * magic consume). `accountStatus` appears only when a correct password was presented to an
 * account that is pending deletion, so the app can offer "Restore account" after success (8.10).
 */
export const authTokensResponseSchema = z
  .strictObject({
    accessToken: z.string(),
    refreshToken: z.string(),
    userId: z.string(),
    accountStatus: z.literal('pending_deletion').optional(),
  });

/** The 10-minute grant returned by verifying a reset code (A10). */
export const resetGrantResponseSchema = z.strictObject({
  grant: z.string(),
});

/**
 * Timer metadata carried in `meta` alongside a uniform message so the code screen can show the
 * lifetime and the resend countdown without trusting the phone clock (A9): remaining SECONDS,
 * never a clock time.
 */
export const codeTimerMetaSchema = z.strictObject({
  expiresInSeconds: z.number().int().min(0).max(CODE_TTL_SECONDS),
  resendInSeconds: z.number().int().min(0).max(RESEND_COOLDOWN_SECONDS),
});

export const grantTimerMetaSchema = z.strictObject({
  expiresInSeconds: z.number().int().min(0).max(RESET_GRANT_TTL_SECONDS),
});

/**
 * GET /auth/me response (server decides — S5): the signed-in user's id and display name.
 * The name is trimmed server-side; empty is allowed (V8 minimum is 1 but legacy rows may be blank,
 * so the app treats empty as "no name to show").
 */
export const meResponseSchema = z.strictObject({
  userId: z.string().min(1),
  displayName: z.string().max(DISPLAY_NAME_MAX_LENGTH),
});

/**
 * One offered country for the sign-up list (PRD 8.1). The SERVER owns the list: `countries`
 * only holds rows whose currency is sold (docs/DATABASE.md), so the app never hard-codes
 * its own copy (S5). Format matches 010-global.sql's CHECK constraints.
 */
export const countryItemSchema = z.strictObject({
  code: z.string().regex(/^[A-Z]{2}$/),
  name: z.string().min(1).max(100),
});

/** GET /auth/countries response: every country the server currently offers, ordered by name. */
export const countryListResponseSchema = z.array(countryItemSchema);

export type CountryItem = z.infer<typeof countryItemSchema>;

// Response types (inferred ONCE here so the app's API client never imports zod itself, V1).
export type AuthTokensResponse = z.infer<typeof authTokensResponseSchema>;
export type MessageResponse = z.infer<typeof messageResponseSchema>;
export type ResetGrantResponse = z.infer<typeof resetGrantResponseSchema>;
export type CodeTimerMeta = z.infer<typeof codeTimerMetaSchema>;
export type GrantTimerMeta = z.infer<typeof grantTimerMetaSchema>;

// ---------------------------------------------------------------------------------------------
// Input types (inferred ONCE from the schemas above; the server service functions use these)
// ---------------------------------------------------------------------------------------------

export type SignUpInput = z.infer<typeof signUpSchema>;
export type VerifyCodeInput = z.infer<typeof verifyCodeSchema>;
export type ResendCodeInput = z.infer<typeof resendCodeSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;
export type ForgotInput = z.infer<typeof forgotSchema>;
export type ResetCodeInput = z.infer<typeof resetCodeSchema>;
export type ResetNewPasswordInput = z.infer<typeof resetNewPasswordSchema>;
export type MagicRequestInput = z.infer<typeof magicRequestSchema>;
export type MagicConsumeInput = z.infer<typeof magicConsumeSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
