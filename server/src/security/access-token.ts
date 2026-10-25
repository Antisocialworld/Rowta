// Access tokens: JWT HS512 with the algorithm pinned (rules A4, A11, S8; skill 3.16).
//
// - HS512 only: the verify call allows ONLY 'HS512', so `none` and every other algorithm
//   are rejected (A4).
// - Claims: subject (user ID), issued-at, expiry 15 minutes (A11), a token ID (jti). NO role and
//   no team role anywhere in the token (S8).
// - The signing secret comes from env JWT_ACCESS_SECRET, validated to >= 64 characters at boot
//   by config/env.ts; it is never logged (S1, A4).
import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { ACCESS_TOKEN_TTL_SECONDS } from '@rowta/shared';
import { env } from '../config/env.ts';

// Encoded once at import. The env schema already failed fast if the secret is missing/short (A4).
const SIGNING_KEY = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export interface AccessTokenClaims {
  sub: string;
  jti: string;
}

export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS512' })
    .setSubject(userId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS)
    .sign(SIGNING_KEY);
}

/**
 * Verify an access token. Any problem (wrong algorithm, expired, tampered, missing sub/jti)
 * returns null and the caller answers with the same generic 401 — no reason is revealed.
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, SIGNING_KEY, { algorithms: ['HS512'] });
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
    if (typeof payload.jti !== 'string' || payload.jti.length === 0) return null;
    return { sub: payload.sub, jti: payload.jti };
  } catch {
    return null;
  }
}
