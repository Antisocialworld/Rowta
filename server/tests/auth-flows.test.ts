// Phase 2 sign-up / verify / sign-in flows end to end (PRD 8.1, rules A5 to A9, V1 to V5).
//
// Real stack: in-process app with the full middleware order, the REAL email worker, Mailpit as
// the mailbox, real Redis rate limits and cooldowns, real PostgreSQL. Assertions compare against
// the SHARED Zod schemas and the SHARED message catalog, so drift between server output and the
// one source of truth fails the suite (V1, V5).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Worker } from 'bullmq';
import { SignJWT, jwtVerify } from 'jose';
import {
  AUTH_MESSAGES,
  CODE_TTL_SECONDS,
  RESEND_COOLDOWN_SECONDS,
  authTokensResponseSchema,
  codeTimerMetaSchema,
  messageResponseSchema,
  normaliseEmail,
} from '@rowta/shared';
import { env } from '../src/config/env.ts';
import { globalDb } from '../src/db/clients.ts';
import { processEmailJob } from '../src/jobs/email/processor.ts';
import type { EmailJobData } from '../src/jobs/email/types.ts';
import { fingerprint } from '../src/security/rate-limit.ts';
import { verifySecret } from '../src/security/argon2.ts';
import type { Job } from 'bullmq';
import {
  TEST_COUNTRY,
  clearRateKeys,
  dataOf,
  ensureTestCountries,
  errorOf,
  mailpitClear,
  post,
  createVerifiedUser,
  redis,
  shutdownAuthTest,
  startEmailWorker,
  testApp,
  uniqueEmail,
  waitForMail,
  countMailTo,
} from './helpers/auth-test.ts';
import type { Hono } from 'hono';

const CODE_SUBJECT = 'Your Rowta verification code';
const SIGNUP_MESSAGE = AUTH_MESSAGES['auth.signUp.submitted'];

let app: Hono;
let worker: Worker;
/** The real 6-digit code delivered for the first sign-up in this file. */
let realCode = '';

beforeAll(async () => {
  await clearRateKeys();
  await ensureTestCountries();
  await mailpitClear();
  worker = await startEmailWorker();
  app = testApp('auth-flows');
});

afterAll(async () => {
  await shutdownAuthTest(worker);
});

function signUpBody(email: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    displayName: 'Ada Lovelace',
    email,
    country: TEST_COUNTRY,
    password: 'PhaseTwo-Password-1',
    confirm: 'PhaseTwo-Password-1',
    ...overrides,
  };
}

/** A code that is guaranteed to differ from the real one (no 1-in-a-million flakes). */
function wrongCodeOf(real: string): string {
  const first = Number(real[0]);
  return String((first + 1) % 10) + real.slice(1);
}

describe('sign up with code', () => {
  let signupEmail = '';
  let signupRawBody = '';

  it('answers with the shared schema, the catalog message and second-based timers', async () => {
    signupEmail = uniqueEmail('signup');
    const res = await post(app, '/auth/signup', signUpBody(signupEmail));
    expect(res.status).toBe(200);
    signupRawBody = await res.text();

    const body = JSON.parse(signupRawBody) as { data: unknown; meta: unknown };
    expect(messageResponseSchema.parse(body.data)).toEqual({ message: SIGNUP_MESSAGE });
    expect(codeTimerMetaSchema.parse(body.meta)).toEqual({
      expiresInSeconds: CODE_TTL_SECONDS,
      resendInSeconds: RESEND_COOLDOWN_SECONDS,
    });
  });

  it('a resend inside the window gets the SAME bytes and restarts nothing (A9)', async () => {
    const cooldownKey = `cooldown:signup:${fingerprint(normaliseEmail(signupEmail))}`;
    const ttlBefore = await redis.ttl(cooldownKey);
    expect(ttlBefore).toBeGreaterThan(50);

    const res = await post(app, '/auth/signup/resend', { email: signupEmail });
    expect(res.status).toBe(200);
    // Byte-for-byte identical to the first answer: same uniform message and timers.
    expect(await res.text()).toBe(signupRawBody);

    const ttlAfter = await redis.ttl(cooldownKey);
    expect(ttlAfter).toBeGreaterThan(50); // the window was NOT restarted
    expect(ttlAfter).toBeLessThanOrEqual(ttlBefore);
  });

  it('delivers the code email: neutral subject, no digits in it, footer, 5-minute wording', async () => {
    const mail = await waitForMail(signupEmail, CODE_SUBJECT);
    expect(mail.Subject).not.toMatch(/\d/);
    expect(mail.Text).toContain('Hi Ada Lovelace,');
    expect(mail.Text).toContain('This code expires in 5 minutes.');
    expect(mail.Text).toContain('You can ask for a new code after 60 seconds');
    expect(mail.Text).toContain('This is an automated message. Please do not reply.');
    expect(mail.Text).toContain('The Rowta team');
    // The same words appear in the HTML part, and the code is in both.
    const code = /\b(\d{6})\b/.exec(mail.Text)?.[1];
    expect(code).toMatch(/^\d{6}$/);
    expect(mail.HTML).toContain(`>${code}</p>`);
    // Exactly one code email: the in-window resend above never enqueued a second one.
    expect(await countMailTo(signupEmail, CODE_SUBJECT)).toBe(1);
    realCode = code ?? '';
  });

  it('a wrong code and an unknown email fail byte-identically (A5)', async () => {
    const real = realCode;
    const wrongRes = await post(app, '/auth/signup/verify', { email: signupEmail, code: wrongCodeOf(real) });
    expect(wrongRes.status).toBe(401);
    const unknownRes = await post(app, '/auth/signup/verify', {
      email: uniqueEmail('no-such'),
      code: '123456',
    });
    expect(unknownRes.status).toBe(401);

    const wrongText = await wrongRes.text();
    const unknownText = await unknownRes.text();
    const wrong = JSON.parse(wrongText) as { error: { code: string; message: string; requestId: string } };
    expect(wrong.error.code).toBe('auth.code_invalid');
    expect(wrong.error.message).toBe(AUTH_MESSAGES['auth.code.invalid']);
    expect(normaliseForCompare(wrongText)).toBe(normaliseForCompare(unknownText));
  });

  it('the right code creates the account and signs the user in', async () => {
    const res = await post(app, '/auth/signup/verify', { email: signupEmail, code: realCode });
    expect(res.status).toBe(200);
    const tokens = authTokensResponseSchema.parse(await dataOf(res));
    expect(tokens.accessToken).toMatch(/^eyJ/);
    expect(tokens.refreshToken).toContain('.');

    const key = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
    const { payload } = await jwtVerify(tokens.accessToken, key, { algorithms: ['HS512'] });
    expect(payload.sub).toBe(tokens.userId);
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(900); // A4: 15-minute access token
  });

  it('stores the user, deletes the pending row and sends the welcome email exactly once (C4)', async () => {
    const db = globalDb();
    const user = await db.users.findUnique({ where: { email: signupEmail } });
    expect(user).not.toBeNull();
    expect(user?.email_verified_at).not.toBeNull();
    expect(user?.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(await db.pending_signups.findUnique({ where: { email: signupEmail } })).toBeNull();

    await waitForMail(signupEmail, 'Welcome to Rowta');
    expect(await countMailTo(signupEmail, 'Welcome to Rowta')).toBe(1);

    // Running the job a second time claims nothing: the sent_emails row already exists.
    const userId = user?.id ?? '';
    const result = await processEmailJob({ data: { kind: 'welcome', userId } } as unknown as Job<EmailJobData>);
    expect(result).toEqual({ kind: 'welcome', sent: false });
    expect(await countMailTo(signupEmail, 'Welcome to Rowta')).toBe(1);
    expect(
      await db.sent_emails.count({ where: { user_id: userId, kind: 'welcome' } }),
    ).toBe(1);
  });

  it('an address without an account gets the identical uniform answer (A6)', async () => {
    const unknownEmail = uniqueEmail('uniform');
    const res = await post(app, '/auth/signup', signUpBody(unknownEmail));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(signupRawBody); // identical bytes, existence never leaks
  });

  it('an address that already has an account gets the same answer plus a notice email (A6)', async () => {
    const res = await post(app, '/auth/signup', signUpBody(signupEmail));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(signupRawBody); // identical bytes again

    const notice = await waitForMail(signupEmail, 'A sign-up was attempted with your email');
    expect(notice.Subject).not.toMatch(/\d/);
    expect(notice.Text).toContain('but an account already exists');
    // The notice replaced no code: exactly the one code email from earlier still exists.
    expect(await countMailTo(signupEmail, CODE_SUBJECT)).toBe(1);
  });
});

function normaliseForCompare(text: string): string {
  return text.replace(/"requestId":"[^"]*"/, '"requestId":"<id>"');
}

describe('sign in', () => {
  const signInEmail = uniqueEmail('signin');
  const signInPassword = 'Correct-Horse-Battery-9';

  beforeAll(async () => {
    await createVerifiedUser(signInEmail, signInPassword);
  });

  it('the right password returns tokens that pass the shared response schema', async () => {
    const res = await post(app, '/auth/signin', { email: signInEmail, password: signInPassword });
    expect(res.status).toBe(200);
    const tokens = authTokensResponseSchema.parse(await dataOf(res));
    expect(tokens.accountStatus).toBeUndefined();
  });

  it('a wrong password and an unknown email are byte-identical failures (A5)', async () => {
    const wrongRes = await post(app, '/auth/signin', { email: signInEmail, password: 'NotThePassword-1' });
    expect(wrongRes.status).toBe(401);
    const unknownRes = await post(app, '/auth/signin', {
      email: uniqueEmail('ghost'),
      password: 'Whatever-Password-1',
    });
    expect(unknownRes.status).toBe(401);

    const wrongRaw = await wrongRes.text();
    const unknownRaw = await unknownRes.text();
    const wrong = await errorOf(wrongRaw);
    const unknown = await errorOf(unknownRaw);
    expect(wrong.code).toBe('auth.failed');
    expect(wrong.message).toBe(AUTH_MESSAGES['auth.signIn.failed']);
    expect(unknown.code).toBe(wrong.code);
    expect(unknown.message).toBe(wrong.message);
    expect(normaliseForCompare(wrongRaw)).toBe(normaliseForCompare(unknownRaw));
  });

  it('a correct password on an UNVERIFIED account gives the uniform prompt and re-sends the code', async () => {
    const email = uniqueEmail('unverified');
    const password = 'Unverified-Password-1';
    const userId = await createVerifiedUser(email, password, { verified: false });

    const res = await post(app, '/auth/signin', { email, password });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown; meta: unknown };
    expect(messageResponseSchema.parse(body.data)).toEqual({ message: SIGNUP_MESSAGE });
    expect(codeTimerMetaSchema.parse(body.meta)).toBeTruthy();

    // The job delivered a code, and the pending row carries the USER's own hash (never a payload).
    const mail = await waitForMail(email, CODE_SUBJECT);
    const code = /\b(\d{6})\b/.exec(mail.Text)?.[1] ?? '';
    const db = globalDb();
    const pending = await db.pending_signups.findUnique({ where: { email } });
    const user = await db.users.findUnique({ where: { id: userId } });
    expect(pending).not.toBeNull();
    expect(pending?.password_hash).toBe(user?.password_hash);

    // The code verifies THE SAME ACCOUNT — no duplicate user is created.
    const verifyRes = await post(app, '/auth/signup/verify', { email, code });
    expect(verifyRes.status).toBe(200);
    const tokens = authTokensResponseSchema.parse(await dataOf(verifyRes));
    expect(tokens.userId).toBe(userId);
    const verified = await db.users.findUnique({ where: { id: userId } });
    expect(verified?.email_verified_at).not.toBeNull();
  });

  it('the 5-attempts guard stops even the CORRECT code (A9)', async () => {
    const email = uniqueEmail('attempts');
    await post(app, '/auth/signup', signUpBody(email));
    const mail = await waitForMail(email, CODE_SUBJECT);
    const code = /\b(\d{6})\b/.exec(mail.Text)?.[1] ?? '';
    expect(code).toMatch(/^\d{6}$/);

    for (let i = 0; i < 5; i += 1) {
      const digits = code.split('');
      digits[i % 6] = String((Number(digits[i % 6]) + 1) % 10);
      const res = await post(app, '/auth/signup/verify', { email, code: digits.join('') });
      expect(res.status).toBe(401);
      expect((await errorOf(res)).code).toBe('auth.code_invalid');
    }

    // Sixth attempt with the REAL code: refused by the attempts counter, not by the code.
    const blocked = await post(app, '/auth/signup/verify', { email, code });
    expect(blocked.status).toBe(401);
    expect((await errorOf(blocked)).code).toBe('auth.code_invalid');

    const db = globalDb();
    const pending = await db.pending_signups.findUnique({ where: { email } });
    expect(pending?.attempts).toBe(5);
  });

  it('an account pending deletion still signs in and is told (8.10)', async () => {
    const email = uniqueEmail('pending-del');
    await createVerifiedUser(email, 'Pending-Deletion-1', { status: 'pending_deletion' });
    const res = await post(app, '/auth/signin', { email, password: 'Pending-Deletion-1' });
    expect(res.status).toBe(200);
    const tokens = authTokensResponseSchema.parse(await dataOf(res));
    expect(tokens.accountStatus).toBe('pending_deletion');
  });

  it('a password hashed with stale parameters is re-hashed on the next sign-in (A1)', async () => {
    const { hash } = await import('@node-rs/argon2');
    const email = uniqueEmail('rehash');
    const password = 'Rehash-Me-Please-1';
    const userId = await createVerifiedUser(email, password);
    const db = globalDb();
    // Deliberately stale parameters (4 MiB): the app can no longer produce this, so the test
    // builds it directly through the same library the security module pins.
    const stale = await hash(password, { algorithm: 2, memoryCost: 4_096, timeCost: 2, parallelism: 1 });
    await db.users.update({ where: { id: userId }, data: { password_hash: stale } });

    const res = await post(app, '/auth/signin', { email, password });
    expect(res.status).toBe(200);

    const after = await db.users.findUnique({ where: { id: userId } });
    expect(after?.password_hash).not.toBe(stale);
    expect(after?.password_hash).toContain('$m=19456');
    expect(await verifySecret(after?.password_hash ?? '', password)).toBe(true);
  });
});

describe('access tokens (A4)', () => {
  const signingKey = () => new TextEncoder().encode(env.JWT_ACCESS_SECRET);

  async function logoutWith(bearer: string | null): Promise<Response> {
    const headers: Record<string, string> = bearer === null ? {} : { authorization: `Bearer ${bearer}` };
    return post(app, '/auth/logout', {}, headers);
  }

  it('rejects every forged or broken token with the SAME generic 401', async () => {
    const now = Math.floor(Date.now() / 1000);
    const hs256 = await new SignJWT({ sub: 'someone-else' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(now)
      .setExpirationTime(now + 900)
      .sign(signingKey());
    const expired = await new SignJWT({ sub: 'someone-else' })
      .setProtectedHeader({ alg: 'HS512' })
      .setIssuedAt(now - 1_800)
      .setExpirationTime(now - 60)
      .sign(signingKey());
    const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const nonePayload = Buffer.from(JSON.stringify({ sub: 'someone-else', exp: now + 900 })).toString('base64url');
    const noneToken = `${noneHeader}.${nonePayload}.`;

    const cases = [hs256, expired, noneToken, 'not.a.token'];
    const bodies: string[] = [];
    for (const token of cases) {
      const res = await logoutWith(token);
      expect(res.status).toBe(401);
      const raw = await res.text();
      const error = await errorOf(raw);
      expect(error.code).toBe('auth.not_authenticated');
      expect(error.message).toBe('Not authenticated.');
      bodies.push(normaliseForCompare(raw));
    }
    // Missing header and a wrong scheme land on the identical body too.
    const missing = await logoutWith(null);
    expect(normaliseForCompare(await missing.text())).toBe(bodies[0]);
    const basic = await post(app, '/auth/logout', {}, { authorization: 'Basic dXNlcjpwYXNz' });
    expect(normaliseForCompare(await basic.text())).toBe(bodies[0]);
    // Every variant is identical to every other variant.
    expect(new Set(bodies).size).toBe(1);
  });

  it('a tampered signature is rejected with that same body', async () => {
    // Craft an otherwise valid token and flip one payload character.
    const token = await new SignJWT({ sub: 'aaaaaaaa-0000-0000-0000-000000000001' })
      .setProtectedHeader({ alg: 'HS512' })
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 900)
      .sign(signingKey());
    const [header, payload, signature] = token.split('.');
    const last = payload?.at(-1) ?? 'A';
    const tampered = `${header}.${payload?.slice(0, -1)}${last === 'A' ? 'B' : 'A'}.${signature}`;
    const logoutRes = await logoutWith(tampered);
    expect(logoutRes.status).toBe(401);
    expect((await errorOf(logoutRes)).code).toBe('auth.not_authenticated');
  });
});
