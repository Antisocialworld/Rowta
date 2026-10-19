// FORMAT CHECKS the auth forms use for their not-ready reasons (X14b/e; rule V7).
// [TEMPORARY, Phase 1] The real rules live in /shared as Zod schemas validated on the client AND the server (V1,
// V2); that package is built in Phase 2. Until then these two patterns only drive the convenience readiness of
// the buttons — the server validates everything again (X14f), so nothing here is a security control.

/** Email shape: one @, a non-empty local part and a dot in the domain (V7, PRD 8.1). */
export const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailLike(value: string): boolean {
  return EMAIL_FORMAT.test(value.trim());
}

/** Password minimum length from PRD 11 (auth.password.tooShort: "Use at least 8 characters."). */
export const PASSWORD_MIN = 8;
