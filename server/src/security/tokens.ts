// Selector-and-verifier tokens and 6-digit codes (rules A3, A9).
//
// Token: `<selector>.<verifier>` — selector random and unique (finds the row), verifier at least
// 256 bits from the CSPRNG (only its Argon2id hash is stored). The raw token exists only in the
// response or email that delivers it (A3).
// Code: 6 digits from crypto.randomInt, left-padded (A9).
import { randomBytes, randomInt } from 'node:crypto';

/** Random URL-safe string (base64url, no padding). */
export function randomUrlSafe(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

export interface TokenParts {
  selector: string;
  verifier: string;
}

/** A fresh token pair: 16-byte selector, 32-byte verifier (256 bits, A3). */
export function createTokenParts(): TokenParts {
  return { selector: randomUrlSafe(16), verifier: randomUrlSafe(32) };
}

/** The only place a raw token string is assembled. */
export function formatToken(parts: TokenParts): string {
  return `${parts.selector}.${parts.verifier}`;
}

const TOKEN_PART_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Split a presented token. Malformed input (wrong shape, wrong charset, wrong part count) returns
 * null and the caller answers with the generic invalid-link error — no reason is ever revealed (A3).
 */
export function splitToken(token: string): TokenParts | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [selector, verifier] = parts;
  if (selector === undefined || verifier === undefined) return null;
  if (selector.length === 0 || verifier.length === 0) return null;
  if (selector.length > 64 || verifier.length > 128) return null;
  if (!TOKEN_PART_PATTERN.test(selector) || !TOKEN_PART_PATTERN.test(verifier)) return null;
  return { selector, verifier };
}

/** A 6-digit verification code from the CSPRNG, left-padded to 6 digits (A9). */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}
