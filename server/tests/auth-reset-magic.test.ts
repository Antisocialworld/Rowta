// Phase 2 password recovery and magic link (PRD 8.1, rules A6, A9, A10, A13 and the owner's
// 5-minute magic-link override). Uniform responses, single-use codes and grants, single-winner
// token consumption, POST-only magic consume, and byte-identical failures everywhere.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AUTH_MESSAGES,
  RESET_GRANT_TTL_SECONDS,
  authTokensResponseSchema,
  codeTimerMetaSchema,
  grantTimerMetaSchema,
  messageResponseSchema,
  resetGrantResponseSchema,
} from '@rowta/shared';
import { env } from '../src/config/env.ts';
import { globalDb } from '../src/db/clients.ts';
import {
  clearRateKeys,
  countMailTo,
  createVerifiedUser,
  dataOf,
  ensureTestCountries,
  errorOf,
  mailpitClear,
  post,
  shutdownAuthTest,
  startEmailWorker,
  testApp,
  uniqueEmail,
  waitForMail,
} from './helpers/auth-test.ts';
import type { Hono } from 'hono';
import type { Worker } from 'bullmq';

const RESET_SUBJECT = 'Your Rowta password reset code';
const MAGIC_SUBJECT = 'Your Rowta sign-in link';
const OLD_PASSWORD = 'Recovery-Password-1';

let app: Hono;
let worker: Worker;

// Shared across the describes below (set as the flows run, read by the next describe).
let knownForgotEmail = '';
let knownGrant = '';
let resetReplayBody = '';
let magicToken = '';
let magicReplayBody = '';

beforeAll(async () => {
  await clearRateKeys();
  await ensureTestCountries();
  await mailpitClear();
  worker = await startEmailWorker();
  app = testApp('auth-reset-magic');
});

afterAll(async () => {
  await shutdownAuthTest(worker);
});

function normaliseForCompare(text: string): string {
  return text.replace(/"requestId":"[^"]*"/, '"requestId":"<id>"');
}

function codeFrom(mailText: string): string {
  return /\b(\d{6})\b/.exec(mailText)?.[1] ?? '';
}

function tokenFromLink(mailText: string): string {
  return /magic#([A-Za-z0-9_.~-]+)/.exec(mailText)?.[1] ?? '';
}

describe('forgot password (A6)', () => {
  const unknownEmail = uniqueEmail('forgot-unknown');
  let knownBody = '';
  let resetCode = '';

  it('answers byte-identically for known and unknown addresses', async () => {
    knownForgotEmail = uniqueEmail('forgot-known');
    await createVerifiedUser(knownForgotEmail, OLD_PASSWORD);

    const unknown = await post(app, '/auth/forgot', { email: unknownEmail });
    expect(unknown.status).toBe(200);
    const unknownText = await unknown.text();

    const known = await post(app, '/auth/forgot', { email: knownForgotEmail });
    expect(known.status).toBe(200);
    knownBody = await known.text();

    expect(knownBody).toBe(unknownText); // existence never leaks (A6)
    const body = JSON.parse(knownBody) as { data: unknown; meta: unknown };
    expect(messageResponseSchema.parse(body.data)).toEqual({
      message: AUTH_MESSAGES['auth.forgot.submitted'],
    });
    expect(codeTimerMetaSchema.parse(body.meta)).toEqual({
      expiresInSeconds: 300,
      resendInSeconds: 60,
    });
  });

  it('only the registered address receives a code; a resend inside the window changes nothing', async () => {
    // The unknown-address job ran FIRST (FIFO); once the known one delivered, job one is done.
    const mail = await waitForMail(knownForgotEmail, RESET_SUBJECT);
    expect(await countMailTo(unknownEmail)).toBe(0);
    resetCode = codeFrom(mail.Text);
    expect(resetCode).toMatch(/^\d{6}$/);
    expect(mail.Subject).not.toMatch(/\d/);
    expect(mail.Text).toContain('This code expires in 5 minutes.');

    // Resend inside 60 seconds: identical bytes, no second email.
    const resend = await post(app, '/auth/forgot/resend', { email: knownForgotEmail });
    expect(resend.status).toBe(200);
    expect(await resend.text()).toBe(knownBody);
    expect(await countMailTo(knownForgotEmail, RESET_SUBJECT)).toBe(1);
  });

  it('the code verifies exactly once and returns a 10-minute grant', async () => {
    const unknownRes = await post(app, '/auth/forgot/verify', { email: uniqueEmail('ghost'), code: '123456' });
    expect(unknownRes.status).toBe(401);

    const wrong = await post(app, '/auth/forgot/verify', { email: knownForgotEmail, code: '000000' });
    expect(wrong.status).toBe(401);
    expect(normaliseForCompare(await wrong.text())).toBe(normaliseForCompare(await unknownRes.text()));

    const good = await post(app, '/auth/forgot/verify', { email: knownForgotEmail, code: resetCode });
    expect(good.status).toBe(200);
    const body = (await good.json()) as { data: unknown; meta: unknown };
    const grant = resetGrantResponseSchema.parse(body.data);
    expect(grant.grant).toContain('.');
    expect(grantTimerMetaSchema.parse(body.meta)).toEqual({ expiresInSeconds: RESET_GRANT_TTL_SECONDS });
    knownGrant = grant.grant;

    // Single use: the same code never grants twice.
    const replay = await post(app, '/auth/forgot/verify', { email: knownForgotEmail, code: resetCode });
    expect(replay.status).toBe(401);
    expect((await errorOf(replay)).code).toBe('auth.code_invalid');
  });
});

describe('reset password (A10)', () => {
  const newPassword = 'Brand-New-Password-1';

  it('sets the new password once, kills every session, and the grant cannot be replayed', async () => {
    expect(knownGrant).toContain('.');
    expect(knownForgotEmail).toContain('forgot-known');

    // A live session on the OLD password, to prove the reset revokes it.
    const before = await post(app, '/auth/signin', { email: knownForgotEmail, password: OLD_PASSWORD });
    expect(before.status).toBe(200);
    const session = authTokensResponseSchema.parse(await dataOf(before));

    const reset = await post(app, '/auth/reset', {
      grant: knownGrant,
      newPassword,
      confirm: newPassword,
    });
    expect(reset.status).toBe(200);
    expect(messageResponseSchema.parse(await dataOf(reset))).toEqual({
      message: AUTH_MESSAGES['auth.reset.done'],
    });

    const oldFail = await post(app, '/auth/signin', { email: knownForgotEmail, password: OLD_PASSWORD });
    expect(oldFail.status).toBe(401);
    expect((await errorOf(oldFail)).code).toBe('auth.failed');

    const newOk = await post(app, '/auth/signin', { email: knownForgotEmail, password: newPassword });
    expect(newOk.status).toBe(200);

    const replaySession = await post(app, '/auth/refresh', { refreshToken: session.refreshToken });
    expect(replaySession.status).toBe(401); // every refresh token of the user was revoked (A10)

    const replayGrant = await post(app, '/auth/reset', {
      grant: knownGrant,
      newPassword: 'Another-Password-1',
      confirm: 'Another-Password-1',
    });
    const replayRaw = await replayGrant.text();
    expect(replayGrant.status).toBe(401);
    const replayError = await errorOf(replayRaw);
    expect(replayError.code).toBe('auth.link_invalid');
    expect(replayError.message).toBe(AUTH_MESSAGES['auth.link.invalid']);
    resetReplayBody = normaliseForCompare(replayRaw);
  });

  it('an expired grant fails with that identical body', async () => {
    const email = uniqueEmail('grant-expiry');
    await createVerifiedUser(email, 'Grant-Expiry-Password-1');

    const forgot = await post(app, '/auth/forgot', { email });
    expect(forgot.status).toBe(200);
    const mail = await waitForMail(email, RESET_SUBJECT);
    const verified = await post(app, '/auth/forgot/verify', { email, code: codeFrom(mail.Text) });
    expect(verified.status).toBe(200);
    const grant = resetGrantResponseSchema.parse(await dataOf(verified)).grant;

    const db = globalDb();
    const selector = grant.split('.')[0] ?? '';
    await db.password_resets.updateMany({
      where: { grant_selector: selector },
      data: { grant_expires_at: new Date(Date.now() - 1_000) },
    });

    const expired = await post(app, '/auth/reset', {
      grant,
      newPassword: 'Expired-Grant-Password-1',
      confirm: 'Expired-Grant-Password-1',
    });
    const expiredRaw = await expired.text();
    expect(expired.status).toBe(401);
    expect((await errorOf(expiredRaw)).code).toBe('auth.link_invalid');
    expect(normaliseForCompare(expiredRaw)).toBe(resetReplayBody);
  });
});

describe('magic link (A13, owner override: 5 minutes)', () => {
  const magicEmail = uniqueEmail('magic');
  const unknownMagicEmail = uniqueEmail('magic-unknown');

  it('request is uniform, and only a real account gets the link', async () => {
    await createVerifiedUser(magicEmail, 'Magic-Password-1');

    const unknown = await post(app, '/auth/magic/request', { email: unknownMagicEmail });
    expect(unknown.status).toBe(200);
    const unknownText = await unknown.text();

    const known = await post(app, '/auth/magic/request', { email: magicEmail });
    expect(known.status).toBe(200);
    expect(await known.text()).toBe(unknownText);
    const body = JSON.parse(unknownText) as { data: unknown };
    expect(messageResponseSchema.parse(body.data)).toEqual({
      message: AUTH_MESSAGES['auth.magic.submitted'],
    });

    const mail = await waitForMail(magicEmail, MAGIC_SUBJECT);
    expect(await countMailTo(unknownMagicEmail)).toBe(0); // FIFO: the unknown job already ran
    expect(mail.Subject).not.toMatch(/\d/);
    // OWNER OVERRIDE: the lifetime comes from the shared constant (300 s), the email says 5 minutes.
    expect(mail.Text).toContain('The link expires in 5 minutes and works once.');
    const prefix = env.PUBLIC_WEB_URL.replace(/\/+$/, '');
    expect(mail.Text).toContain(`${prefix}/magic#`);
    magicToken = tokenFromLink(mail.Text);
    expect(magicToken).toContain('.');
  });

  it('GET /auth/magic/consume does not exist: the token only ever arrives by POST (A13)', async () => {
    const res = await app.request(`/auth/magic/consume?token=${magicToken}`);
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('not.found');
  });

  it('the token works exactly once', async () => {
    const first = await post(app, '/auth/magic/consume', { token: magicToken });
    expect(first.status).toBe(200);
    const tokens = authTokensResponseSchema.parse(await dataOf(first));
    const user = await globalDb().users.findUnique({ where: { email: magicEmail } });
    expect(tokens.userId).toBe(user?.id);

    const replay = await post(app, '/auth/magic/consume', { token: magicToken });
    const replayRaw = await replay.text();
    expect(replay.status).toBe(401);
    expect((await errorOf(replayRaw)).code).toBe('auth.link_invalid');
    magicReplayBody = normaliseForCompare(replayRaw);
  });

  it('an expired magic token fails with that identical body', async () => {
    const email = uniqueEmail('magic-expired');
    await createVerifiedUser(email, 'Magic-Expiry-Password-1');
    const request = await post(app, '/auth/magic/request', { email });
    expect(request.status).toBe(200);
    const mail = await waitForMail(email, MAGIC_SUBJECT);
    const token = tokenFromLink(mail.Text);

    const db = globalDb();
    const selector = token.split('.')[0] ?? '';
    await db.magic_tokens.updateMany({
      where: { selector },
      data: { expires_at: new Date(Date.now() - 1_000) },
    });

    const expired = await post(app, '/auth/magic/consume', { token });
    const expiredRaw = await expired.text();
    expect(expired.status).toBe(401);
    expect((await errorOf(expiredRaw)).code).toBe('auth.link_invalid');
    expect(normaliseForCompare(expiredRaw)).toBe(magicReplayBody);
  });
});
