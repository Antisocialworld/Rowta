// FORM READINESS for the not-ready submit buttons (rules V1, V2, V6, X14).
//
// Each helper below IS the shared Zod schema for that endpoint: the view hands it the raw field
// values and the schema decides — no rule is re-typed or copied into the app (V1: duplicated
// schemas are a defect). This replaces the Phase-1 temporary email/password patterns that lived
// here while /shared was not yet built.
//
// Readiness is convenience only: the server validates everything again (X14f, V2), and the API
// client already parses every request body with the same shared schema before sending it
// (lib/api.ts, V1), so a ready button can never send a body the server would reject for shape.
import {
  forgotSchema,
  magicRequestSchema,
  resetNewPasswordSchema,
  signInSchema,
  signUpSchema,
} from '@rowta/shared';

/** Sign in — signInSchema: a well-formed email and a NON-EMPTY password. Never a strength rule (V7, X14e). */
export function signInReady(email: string, password: string): boolean {
  return signInSchema.safeParse({ email, password }).success;
}

/** Create account — signUpSchema: display name (NFKC, 1-60, allowed characters), normalised email,
 *  two-letter country code (membership is the server's, PRD 8.1), password 8-128 and an identical
 *  confirmation. */
export function signUpReady(
  displayName: string,
  email: string,
  country: string,
  password: string,
  confirm: string,
): boolean {
  return signUpSchema.safeParse({ displayName, email, country, password, confirm }).success;
}

/** Forgot password — forgotSchema: the normalised email shape only. The uniform next step stays the
 *  server's enumeration-safety answer (A5/A6); the client checks format and nothing else. */
export function forgotReady(email: string): boolean {
  return forgotSchema.safeParse({ email }).success;
}

/** Magic-link request — magicRequestSchema: the same email shape as forgot. */
export function magicRequestReady(email: string): boolean {
  return magicRequestSchema.safeParse({ email }).success;
}

/** Reset (new password) — resetNewPasswordSchema: password 8-128 plus an identical confirmation.
 *  The 10-minute GRANT rides in the flow context (A10), not in a form field: when no grant is held
 *  the two password fields alone decide readiness and the view's existing missing-grant guard still
 *  answers the press with generic.error and NO request (unchanged behaviour); when a grant is held
 *  the whole server schema applies. The stand-in below is a syntactic placeholder only — it is
 *  never sent anywhere and it is not a credential. */
const GRANT_NOT_IN_CONTEXT = 'grant-not-in-context';

export function resetNewPasswordReady(grant: string | null, newPassword: string, confirm: string): boolean {
  return resetNewPasswordSchema.safeParse({ grant: grant ?? GRANT_NOT_IN_CONTEXT, newPassword, confirm }).success;
}
