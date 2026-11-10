// Phase 2 security evidence (rules S1, S9, A1 to A4, A7): nothing secret ever reaches the logs
// or a table in the clear, every stored secret is an Argon2id PHC string, refresh rows carry the
// 30-day TTL, access tokens last 5 minutes, subjects carry no digits â€” and the A7 timing
// measurement compares the pair that matters on every dummy-verify route: unknown email vs
// known row + WRONG secret, asserted within 25% of each other.
// The timing numbers printed here are copied into docs/SECURITY.md as gate evidence.
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pino from 'pino';
import { REFRESH_TOKEN_TTL_SECONDS, ACCESS_TOKEN_TTL_SECONDS, CODE_TTL_SECONDS, CODE_MAX_ATTEMPTS, emailField } from '@rowta/shared';
import { createApp } from '../src/index.ts';
import { buildLoggerOptions } from '../src/lib/logger.ts';
import { globalDb } from '../src/db/clients.ts';
import { signIn, verifyCode, verifyResetCode } from '../src/auth/service.ts';
import { DECOY_PENDING_EMAIL, DECOY_USER_EMAIL, timingDecoys } from '../src/auth/timing-decoy.ts';
import { getDummyHash, hashSecret, verifySecret } from '../src/security/argon2.ts';
import {
  TEST_COUNTRY,
  capturedMails,
  clearRateKeys,
  createVerifiedUser,
  ensureTestCountries,
  mailCaptureClear,
  post,
  redis,
  shutdownAuthTest,
  startEmailWorker,
  testApp,
  uniqueEmail,
  waitForMail,
} from './helpers/auth-test.ts';
import type { Hono } from 'hono';
import type { Worker } from 'bullmq';

const CODE_SUBJECT = 'Your Rowta verification code';

let app: Hono;
let worker: Worker;

beforeAll(async () => {
  await clearRateKeys();
  await ensureTestCountries();
  await mailCaptureClear();
  worker = await startEmailWorker();
  app = testApp('auth-security');
});

afterAll(async () => {
  await shutdownAuthTest(worker);
});

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

describe('secrets never leak', () => {
  it('no email, password, code or token appears anywhere in the request log (S9)', async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    });
    const log = pino(buildLoggerOptions('info'), stream);
    const watched = createApp({ log, redis });

    const email = uniqueEmail('logwatch');
    const password = 'LogPoison-Password-9x7!';
    const signup = await post(watched, '/auth/signup', {
      displayName: 'Log Watcher',
      email,
      country: TEST_COUNTRY,
      password,
      confirm: password,
    });
    expect(signup.status).toBe(200);
    const mail = await waitForMail(email, CODE_SUBJECT);
    const code = /\b(\d{6})\b/.exec(mail.text)?.[1] ?? '';

    const verify = await post(watched, '/auth/signup/verify', { email, code });
    expect(verify.status).toBe(200);
    const tokens = (await verify.json()) as { data: { accessToken: string; refreshToken: string; userId: string } };

    const signin = await post(watched, '/auth/signin', { email, password });
    expect(signin.status).toBe(200);

    const logout = await post(
      watched,
      '/auth/logout',
      { refreshToken: tokens.data.refreshToken },
      { authorization: `Bearer ${tokens.data.accessToken}` },
    );
    expect(logout.status).toBe(200);

    const text = chunks.join('');
    // Real traffic was captured...
    expect(text).toContain('"route"');
    // ...and none of the secrets or personal data reached it.
    expect(text).not.toContain(password);
    expect(text).not.toContain(code);
    expect(text).not.toContain(tokens.data.accessToken);
    expect(text).not.toContain(tokens.data.refreshToken);
    expect(text).not.toContain(email);
    expect(text).not.toContain('@example.test');
    expect(text).not.toContain('$argon2id$');
  });

  it('every stored secret is an Argon2id PHC string, never the plaintext (A1 to A3)', async () => {
    const email = uniqueEmail('phc');
    const password = 'Storage-Password-9x7!';
    const signup = await post(app, '/auth/signup', {
      displayName: 'PHC Checker',
      email,
      country: TEST_COUNTRY,
      password,
      confirm: password,
    });
    expect(signup.status).toBe(200);
    const mail = await waitForMail(email, CODE_SUBJECT);
    const code = /\b(\d{6})\b/.exec(mail.text)?.[1] ?? '';

    const db = globalDb();
    const pending = await db.pending_signups.findUnique({ where: { email } });
    expect(pending).not.toBeNull();
    expect(pending?.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(pending?.password_hash).not.toContain(password);
    expect(await verifySecret(pending?.password_hash ?? '', password)).toBe(true);
    expect(pending?.code_hash.startsWith('$argon2id$')).toBe(true);
    expect(pending?.code_hash).not.toBe(code);
    expect(pending?.attempts).toBe(0);
    expect(pending?.expires_at.getTime()).toBeGreaterThan(Date.now() + 240_000); // TTL restarted at send

    const verify = await post(app, '/auth/signup/verify', { email, code });
    expect(verify.status).toBe(200);
    const data = (await verify.json()) as { data: { accessToken: string; refreshToken: string; userId: string } };

    const user = await db.users.findUnique({ where: { id: data.data.userId } });
    expect(user?.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(user?.password_hash).not.toContain(password);
    expect(await verifySecret(user?.password_hash ?? '', password)).toBe(true);

    const selector = data.data.refreshToken.split('.')[0] ?? '';
    const refreshRow = await db.refresh_tokens.findUnique({ where: { selector } });
    expect(refreshRow).not.toBeNull();
    expect(refreshRow?.verifier_hash.startsWith('$argon2id$')).toBe(true);
    expect(refreshRow?.verifier_hash).not.toContain(data.data.refreshToken);
    expect(refreshRow?.used_at).toBeNull();
    expect(refreshRow?.revoked_at).toBeNull();
    // 30-day refresh lifetime, measured from a moment close to now.
    const remaining = (refreshRow?.expires_at.getTime() ?? 0) - Date.now();
    const ttlMs = REFRESH_TOKEN_TTL_SECONDS * 1_000;
    expect(remaining).toBeGreaterThan(ttlMs - 120_000);
    expect(remaining).toBeLessThanOrEqual(ttlMs);
    expect(ACCESS_TOKEN_TTL_SECONDS).toBe(300);
  });

  it('no delivered subject contains a digit (skill section 7)', async () => {
    const summaries = capturedMails();
    expect(summaries.length).toBeGreaterThan(0); // this file really did send mail
    for (const summary of summaries) {
      expect(summary.subject, `subject "${summary.subject}" must carry no digits`).not.toMatch(/\d/);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// A7 timing. The pair that matters on every dummy-verify route is the two FAILURE paths:
//   side A = unknown email  â€” lookup misses, one Argon2id verify against the process dummy hash;
//   side B = known row + wrong secret â€” lookup hits, the attempts guard runs, one Argon2id verify
//            against the stored hash.
// The dominant cost is one real Argon2id verify on BOTH sides; side B may additionally run the
// conditional attempts UPDATE, which is one cheap database round-trip. The correct-secret path is
// measured separately because it does strictly more (issues a refresh-verifier hash, writes rows,
// signs a JWT) and is allowed to be slower â€” it is not the path an attacker's probe exercises.
//
// Method (per the Phase 2b task): >= 50 measured runs per side, the two paths ALTERNATED inside
// one loop so neither side monopolises warm-up/GC, the first 5 runs of each side discarded, both
// medians and the max/min ratio printed, and the ratio asserted within 25%.
// beforeA/beforeB run OUTSIDE the timed window (fixture bookkeeping such as resetting an attempts
// counter must never be counted â€” it is not work the server does on the real path).
//
// Tolerance = 25%. Why that number: the only structural difference between A and B is which row
// the hash comes from (process dummy vs stored) plus, on the known-row paths, one conditional
// UPDATE for the attempts guard â€” all dwarfed by the ~40-60 ms Argon2id cost. 25% absorbs laptop
// scheduler noise (GC, frequency scaling) without hiding a real defect: a missing dummy verify
// would drop side A to ~1-3 ms (a lone database lookup), a 15-50x gap.
// ---------------------------------------------------------------------------------------------

const TIMING_RUNS = 60; // 60 total, first 5 discarded => 55 measured per side (>= 50 required)
const TIMING_DISCARD = 5;
const TIMING_TOLERANCE = 0.25;

async function measureAlternatingPair(
  label: string,
  runA: () => Promise<unknown>,
  runB: () => Promise<unknown>,
  beforeA?: () => Promise<unknown>,
  beforeB?: () => Promise<unknown>,
): Promise<{ aMedian: number; bMedian: number }> {
  const aSamples: number[] = [];
  const bSamples: number[] = [];
  for (let i = 0; i < TIMING_RUNS; i += 1) {
    // Alternate inside one loop: neither path owns the warm-up runs, and a slow GC pause hits
    // both sides about equally across 60 interleaved samples.
    await beforeA?.();
    const tA = process.hrtime.bigint();
    await runA().catch(() => undefined);
    aSamples.push(Number(process.hrtime.bigint() - tA) / 1e6);
    await beforeB?.();
    const tB = process.hrtime.bigint();
    await runB().catch(() => undefined);
    bSamples.push(Number(process.hrtime.bigint() - tB) / 1e6);
  }
  const aMedian = median(aSamples.slice(TIMING_DISCARD));
  const bMedian = median(bSamples.slice(TIMING_DISCARD));
  const ratio = Math.max(aMedian, bMedian) / Math.min(aMedian, bMedian);
  console.log(
    `[A7 ${label}] A(unknown) ${aMedian.toFixed(1)}ms vs B(wrong) ${bMedian.toFixed(1)}ms, ratio ${ratio.toFixed(2)} ` +
      `(n=${TIMING_RUNS - TIMING_DISCARD} each after discarding ${TIMING_DISCARD}, alternating)`,
  );
  // Both failure paths must also clear the absolute floor: without a real Argon2id verify the
  // path would finish in ~1-3 ms (one database lookup), so >= 5 ms proves the verify ran.
  expect(aMedian, `${label}: unknown side below the Argon2id floor`).toBeGreaterThanOrEqual(5);
  expect(bMedian, `${label}: wrong side below the Argon2id floor`).toBeGreaterThanOrEqual(5);
  expect(ratio, `${label}: medians differ by more than ${TIMING_TOLERANCE * 100}%`).toBeLessThanOrEqual(
    1 + TIMING_TOLERANCE,
  );
  return { aMedian, bMedian };
}

describe('A7 timing (evidence for docs/SECURITY.md section 5)', () => {
  it('sign-in: unknown email + any password vs known email + WRONG password (the A7 pair)', async () => {
    const knownEmail = uniqueEmail('timing-known');
    const password = 'Timing-Password-1';
    await createVerifiedUser(knownEmail, password);
    const unknownEmail = uniqueEmail('timing-unknown');
    await getDummyHashWarmedUp();

    await measureAlternatingPair(
      'sign-in unknown-vs-wrong',
      () => signIn({ email: unknownEmail, password }),
      () => signIn({ email: knownEmail, password: 'Not-The-Password-1' }),
    );
  });

  it('sign-in: known email + CORRECT password is a separate, longer path (issues tokens)', async () => {
    const email = uniqueEmail('timing-correct');
    const password = 'Timing-Password-1';
    await createVerifiedUser(email, password);
    await getDummyHashWarmedUp();

    const samples: number[] = [];
    for (let i = 0; i < TIMING_RUNS; i += 1) {
      const start = process.hrtime.bigint();
      await signIn({ email, password });
      samples.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
    const correctMedian = median(samples.slice(TIMING_DISCARD));
    // Printed as its own line: this path is LONGER by design â€” after the password verify it runs
    // needsRehash, hashes a fresh refresh verifier (a second Argon2id), inserts the refresh row
    // and signs the HS512 access token. It is NOT the A7 comparison pair.
    console.log(
      `[A7 sign-in correct-password] median ${correctMedian.toFixed(1)}ms ` +
        `(n=${TIMING_RUNS - TIMING_DISCARD}; longer by design: issues refresh verifier + JWT)`,
    );
    expect(correctMedian).toBeGreaterThanOrEqual(5);
  });

  it('verify-code: unknown email vs known pending row + WRONG code', async () => {
    const db = globalDb();
    const email = uniqueEmail('timing-verify');
    const correctCode = '123456';
    const wrongCode = '000000';
    await db.pending_signups.create({
      data: {
        email,
        display_name: 'Timing Verify',
        country: TEST_COUNTRY,
        password_hash: await hashSecret('Timing-Password-1'),
        code_hash: await hashSecret(correctCode),
        expires_at: new Date(Date.now() + CODE_TTL_SECONDS * 1_000),
      },
    });
    const unknownEmail = uniqueEmail('timing-verify-unknown');
    await getDummyHashWarmedUp();

    await measureAlternatingPair(
      'verify-code unknown-vs-wrong',
      () => verifyCode({ email: unknownEmail, code: wrongCode }),
      () => verifyCode({ email, code: wrongCode }),
      undefined,
      // OUTSIDE the timed window: each wrong attempt increments `attempts`; reset it so side B
      // always takes the real-verify branch (past the cap it would fall back to the dummy â€”
      // a different shape of work). This reset is test bookkeeping, not server-path work.
      () => db.pending_signups.update({ where: { email }, data: { attempts: 0 } }),
    );
  });

  it('reset-code: unknown email vs known user + WRONG code', async () => {
    const db = globalDb();
    const email = uniqueEmail('timing-reset');
    const userId = await createVerifiedUser(email, 'Timing-Password-1');
    const correctCode = '123456';
    const wrongCode = '000000';
    await db.password_resets.create({
      data: {
        user_id: userId,
        code_hash: await hashSecret(correctCode),
        expires_at: new Date(Date.now() + CODE_TTL_SECONDS * 1_000),
      },
    });
    const unknownEmail = uniqueEmail('timing-reset-unknown');
    await getDummyHashWarmedUp();

    await measureAlternatingPair(
      'reset-code unknown-vs-wrong',
      () => verifyResetCode({ email: unknownEmail, code: wrongCode }),
      () => verifyResetCode({ email, code: wrongCode }),
      undefined,
      // OUTSIDE the timed window (test bookkeeping, see verify-code test).
      () => db.password_resets.updateMany({ where: { user_id: userId }, data: { attempts: 0 } }),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// ADR 0010 escalation evidence: the unknown-email guards must hit the SEEDED decoy rows â€” a
// zero-row mirror would leave the counters untouched.
// ---------------------------------------------------------------------------------------------

describe('A7 timing decoys (ADR 0010 escalation)', () => {
  it('unknown-email probes increment the seeded decoy counters, proving a matched write', async () => {
    const db = globalDb();
    const decoys = await timingDecoys();
    if (decoys === null) throw new Error('decoy seed did not run although the country fixture exists');
    const pendingBefore = await db.pending_signups.findUnique({ where: { id: decoys.pendingId } });
    const resetBefore = await db.password_resets.findUnique({ where: { id: decoys.resetId } });
    expect(pendingBefore, 'decoy pending row must be seeded').not.toBeNull();
    expect(resetBefore, 'decoy reset row must be seeded').not.toBeNull();

    await verifyCode({ email: uniqueEmail('decoy-probe'), code: '000000' }).catch(() => undefined);
    await verifyResetCode({ email: uniqueEmail('decoy-probe'), code: '000000' }).catch(() => undefined);

    const pendingAfter = await db.pending_signups.findUnique({ where: { id: decoys.pendingId } });
    const resetAfter = await db.password_resets.findUnique({ where: { id: decoys.resetId } });
    // The guard's CASE cycles 0..CAP-1 inside WHERE attempts < CAP: the counter must have MOVED
    // by exactly one step â€” a zero-row mirror would leave it at its previous value.
    expect(pendingAfter?.attempts).toBe(((pendingBefore?.attempts ?? 0) + 1) % CODE_MAX_ATTEMPTS);
    expect(resetAfter?.attempts).toBe(((resetBefore?.attempts ?? 0) + 1) % CODE_MAX_ATTEMPTS);
    // The decoy emails carry no '@': the shared API email field rejects them, so no user flow
    // can ever name these rows (A7: unreachable by any request).
    expect(emailField.safeParse(DECOY_PENDING_EMAIL).success).toBe(false);
    expect(emailField.safeParse(DECOY_USER_EMAIL).success).toBe(false);
  });
});

/** Force the process dummy hash to exist before any timed sample, so no side pays its creation. */
async function getDummyHashWarmedUp(): Promise<void> {
  await getDummyHash();
}
