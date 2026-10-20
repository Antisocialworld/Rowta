// Phase 2 session lifecycle (PRD 8.1, rule A11): refresh rotation with family-wide reuse
// detection, expiry, logout, log out of all devices. Every failure body is compared byte for
// byte: a stolen, expired or garbage refresh token must be indistinguishable (A5).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authTokensResponseSchema } from '@rowta/shared';
import { globalDb } from '../src/db/clients.ts';
import {
  TEST_COUNTRY,
  clearRateKeys,
  dataOf,
  ensureTestCountries,
  errorOf,
  post,
  shutdownAuthTest,
  startEmailWorker,
  testApp,
  uniqueEmail,
  waitForMail,
} from './helpers/auth-test.ts';
import type { Hono } from 'hono';
import type { Worker } from 'bullmq';

let app: Hono;
let worker: Worker;

beforeAll(async () => {
  await clearRateKeys();
  await ensureTestCountries();
  worker = await startEmailWorker();
  app = testApp('auth-sessions');
});

afterAll(async () => {
  await shutdownAuthTest(worker);
});

interface Session {
  userId: string;
  accessToken: string;
  refreshToken: string;
}

function normaliseForCompare(text: string): string {
  return text.replace(/"requestId":"[^"]*"/, '"requestId":"<id>"');
}

/** A complete, verified session through the real HTTP surface (costs one sign-up budget unit). */
async function signupAndVerify(email: string): Promise<Session> {
  const password = 'Session-Password-1';
  const signup = await post(app, '/auth/signup', {
    displayName: 'Session User',
    email,
    country: TEST_COUNTRY,
    password,
    confirm: password,
  });
  expect(signup.status).toBe(200);
  const mail = await waitForMail(email, 'Your Rowta verification code');
  const code = /\b(\d{6})\b/.exec(mail.Text)?.[1] ?? '';
  const verify = await post(app, '/auth/signup/verify', { email, code });
  expect(verify.status).toBe(200);
  return authTokensResponseSchema.parse(await dataOf(verify));
}

async function refreshWith(refreshToken: string): Promise<Response> {
  return post(app, '/auth/refresh', { refreshToken });
}

describe('refresh rotation (A11)', () => {
  it('rotates once; replaying the used token revokes the whole family', async () => {
    const first = await signupAndVerify(uniqueEmail('rotate'));

    const rotate = await refreshWith(first.refreshToken);
    expect(rotate.status).toBe(200);
    const rotated = authTokensResponseSchema.parse(await dataOf(rotate));
    expect(rotated.refreshToken).not.toBe(first.refreshToken);
    expect(rotated.userId).toBe(first.userId);
    expect(rotated.accessToken).not.toBe(first.accessToken);

    // Replay of the USED token: 401, and the family — including the brand-new child — dies (A11).
    const replay = await refreshWith(first.refreshToken);
    expect(replay.status).toBe(401);
    const replayRaw = await replay.text();
    const replayError = await errorOf(replayRaw);
    expect(replayError.code).toBe('auth.refresh_invalid');
    expect(replayError.message).toBe('Not authenticated.');

    const child = await refreshWith(rotated.refreshToken);
    expect(child.status).toBe(401);
    expect(normaliseForCompare(await child.text())).toBe(normaliseForCompare(replayRaw));
  });

  it('an expired token and a garbage token fail with that identical body', async () => {
    const session = await signupAndVerify(uniqueEmail('expired'));
    const db = globalDb();
    const selector = session.refreshToken.split('.')[0] ?? '';
    await db.refresh_tokens.update({
      where: { selector },
      data: { expires_at: new Date(Date.now() - 1_000) },
    });

    const expired = await refreshWith(session.refreshToken);
    expect(expired.status).toBe(401);
    const expiredText = normaliseForCompare(await expired.text());

    const garbage = await refreshWith('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    expect(garbage.status).toBe(401);
    expect(normaliseForCompare(await garbage.text())).toBe(expiredText);

    // ...and it equals the reuse failure from the previous test too: one answer, always.
    const notFound = await refreshWith('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz.zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz');
    expect(notFound.status).toBe(401);
    expect(normaliseForCompare(await notFound.text())).toBe(expiredText);
  });
});

describe('log out (8.1, A11)', () => {
  it('revokes the presented family, answers with an empty object, and is idempotent', async () => {
    const session = await signupAndVerify(uniqueEmail('logout'));

    const first = await post(
      app,
      '/auth/logout',
      { refreshToken: session.refreshToken },
      { authorization: `Bearer ${session.accessToken}` },
    );
    expect(first.status).toBe(200);
    expect(await first.text()).toBe('{"data":{}}');

    const afterLogout = await refreshWith(session.refreshToken);
    expect(afterLogout.status).toBe(401);

    // Same logout again: still 200, still the same bytes (revoking twice is harmless).
    const second = await post(
      app,
      '/auth/logout',
      { refreshToken: session.refreshToken },
      { authorization: `Bearer ${session.accessToken}` },
    );
    expect(second.status).toBe(200);
    expect(await second.text()).toBe('{"data":{}}');
  });

  it("a token belonging to user B cannot log user A out of anything", async () => {
    const userA = await signupAndVerify(uniqueEmail('logout-a'));
    const userB = await signupAndVerify(uniqueEmail('logout-b'));

    const spoof = await post(
      app,
      '/auth/logout',
      { refreshToken: userB.refreshToken },
      { authorization: `Bearer ${userA.accessToken}` },
    );
    expect(spoof.status).toBe(200); // the call is fine...

    // ...but B's family is untouched: B can still rotate.
    const bStillWorks = await refreshWith(userB.refreshToken);
    expect(bStillWorks.status).toBe(200); // revoked nothing of B's
  });

  it('without an access token, logout and logout-all are the same generic 401', async () => {
    const out = await post(app, '/auth/logout', { refreshToken: 'a'.repeat(32) + '.' + 'b'.repeat(43) });
    expect(out.status).toBe(401);
    const all = await post(app, '/auth/logout-all', {});
    expect(all.status).toBe(401);
    const outRaw = await out.text();
    const allRaw = await all.text();
    const outError = await errorOf(outRaw);
    expect(outError.code).toBe('auth.not_authenticated');
    expect(normaliseForCompare(outRaw)).toBe(normaliseForCompare(allRaw));
  });
});

describe('log out of all devices (8.1)', () => {
  it('revokes every refresh token, deletes every device row, and ends both sessions', async () => {
    const email = uniqueEmail('logout-all');
    const first = await signupAndVerify(email);
    // A second device: sign in again on the same account.
    const signin = await post(app, '/auth/signin', { email, password: 'Session-Password-1' });
    expect(signin.status).toBe(200);
    const second = authTokensResponseSchema.parse(await dataOf(signin));

    const db = globalDb();
    const device = await db.devices.create({
      data: {
        user_id: first.userId,
        device_id: `dev-${first.userId.slice(0, 8)}`,
        push_token: 'ExponentPush[phase2-test]',
      },
    });
    expect(device.user_id).toBe(first.userId);

    const res = await post(app, '/auth/logout-all', {}, { authorization: `Bearer ${first.accessToken}` });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"data":{}}');

    expect((await refreshWith(first.refreshToken)).status).toBe(401);
    expect((await refreshWith(second.refreshToken)).status).toBe(401);
    expect(await db.devices.count({ where: { user_id: first.userId } })).toBe(0);
    expect(
      await db.refresh_tokens.count({ where: { user_id: first.userId, revoked_at: null } }),
    ).toBe(0);
  });
});
