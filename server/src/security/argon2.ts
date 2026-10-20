// Argon2id hashing module — the ONLY module that imports a hashing library (rules A1, A2, C6).
//
// Parameters live here and nowhere else (A1): OWASP minimums m=19456 KiB (19 MiB), t=2, p=1,
// algorithm Argon2id, full PHC string stored. The async API only (C6); a small semaphore capped
// at ARGON2_MAX_CONCURRENCY stops a burst of sign-ins from exhausting memory (A1).
//
// A dummy PHC hash is created once from random bytes (never stored, never logged). Every caller
// that must not reveal whether a row exists passes a missing hash through getDummyHash() so the
// unknown path costs one real verify (A7).
//
// Passwords are NFKC-normalised inside hashSecret/verifySecret (A8: normalise before hashing, both
// sides, so callers cannot forget; the password itself is never trimmed or altered otherwise).
import { randomBytes } from 'node:crypto';
import { hash, parseOptions, verify } from '@node-rs/argon2';
import { env } from '../config/env.ts';

// @node-rs/argon2 declares Algorithm as an AMBIENT CONST ENUM, which verbatimModuleSyntax
// forbids referencing as a value across modules (TS2748). Argon2id's value is 2 in that enum
// (Argon2d = 0, Argon2i = 1, Argon2id = 2) and it is the library's own default; the number is
// pinned here ONCE (A1: parameters live in this file and nowhere else).
const ARGON2ID = 2;

/** A1: the one Argon2id configuration, at or above OWASP's 19 MiB / 2 iterations / 1 thread. */
export const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

const MAX_CONCURRENCY = env.ARGON2_MAX_CONCURRENCY;

let active = 0;
const waiters: Array<() => void> = [];

/** Counting semaphore so concurrent hashes never exceed the configured cap (A1, C6). */
async function withSlot<T>(run: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active += 1;
  try {
    return await run();
  } finally {
    active -= 1;
    const next = waiters.shift();
    if (next !== undefined) next();
  }
}

function normalise(secret: string | Uint8Array): string | Uint8Array {
  return typeof secret === 'string' ? secret.normalize('NFKC') : secret;
}

/** Hash any short secret (password, 6-digit code, token verifier) with Argon2id (A1, A2, A3). */
export async function hashSecret(secret: string | Uint8Array): Promise<string> {
  const value = normalise(secret);
  return withSlot(() => hash(value, ARGON2_OPTIONS));
}

/**
 * Verify a secret against a stored PHC hash. A malformed hash (wrong table contents, a corrupted
 * row) is simply `false`, never a 500. The await is deliberately inside the semaphore slot so an
 * unknown-email sign-in and a known-email sign-in queue the same way (A7 timing).
 */
export async function verifySecret(phc: string, secret: string | Uint8Array): Promise<boolean> {
  const value = normalise(secret);
  return withSlot(async () => {
    try {
      return await verify(phc, value, ARGON2_OPTIONS);
    } catch {
      return false;
    }
  });
}

/** A1: re-hash on successful login when the stored parameters differ from today's policy. */
export function needsRehash(phc: string): boolean {
  try {
    const parsed = parseOptions(phc);
    return (
      Number(parsed.algorithm) !== ARGON2ID ||
      parsed.memoryCost !== ARGON2_OPTIONS.memoryCost ||
      parsed.timeCost !== ARGON2_OPTIONS.timeCost ||
      parsed.parallelism !== ARGON2_OPTIONS.parallelism
    );
  } catch {
    return true;
  }
}

let dummyHash: Promise<string> | null = null;

/**
 * The dummy PHC hash for unknown rows (A7). Hashed once per process from random bytes, never
 * stored to a table and never logged. Lazy so importing this module costs nothing.
 */
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashSecret(randomBytes(32));
  return dummyHash;
}
