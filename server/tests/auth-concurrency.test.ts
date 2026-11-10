// Phase 2b concurrency evidence (rules A7, D, J): the conditional-UPDATE guards that prevent
// double-success under a race, proven against the real Docker stack with 10 repeated rounds per
// scenario. Each scenario names the DB mechanism that serialises the race and asserts the
// post-race row state, not just HTTP statuses. Numbers and outcomes are copied into
// docs/gates/phase-2.md.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CODE_TTL_SECONDS, MAGIC_LINK_TTL_SECONDS } from '@rowta/shared';
import { globalDb } from '../src/db/clients.ts';
import { signIn, verifyCode, verifyResetCode } from '../src/auth/service.ts';
import { createTokenParts, formatToken } from '../src/security/tokens.ts';
import { hashSecret } from '../src/security/argon2.ts';
import {
  TEST_COUNTRY,
  clearRateKeys,
  createVerifiedUser,
  ensureTestCountries,
  post,
  shutdownAuthTest,
  testApp,
  uniqueEmail,
} from './helpers/auth-test.ts';
import type { Hono } from 'hono';

const ROUNDS = 10;
const CONCURRENCY = 8;
const TEST_TIMEOUT_MS = 120_000;

let app: Hono;

beforeAll(async () => {
  await clearRateKeys();
  await ensureTestCountries();
  app = testApp('auth-concurrency');
});

afterAll(async () => {
  await shutdownAuthTest();
});

function normaliseBody(text: string): string {
  return text.replace(/"requestId":"[^"]*"/, '"requestId":"<id>"');
}

async function createMagicTokenFor(userId: string): Promise<string> {
  const parts = createTokenParts();
  await globalDb().magic_tokens.create({
    data: {
      selector: parts.selector,
      verifier_hash: await hashSecret(parts.verifier),
      user_id: userId,
      expires_at: new Date(Date.now() + MAGIC_LINK_TTL_SECONDS * 1_000),
    },
  });
  return formatToken(parts);
}

async function createPendingSignup(email: string, code: string): Promise<void> {
  await globalDb().pending_signups.create({
    data: {
      email,
      display_name: 'Concurrency',
      country: TEST_COUNTRY,
      password_hash: await hashSecret('Concurrency-Password-1'),
      code_hash: await hashSecret(code),
      expires_at: new Date(Date.now() + CODE_TTL_SECONDS * 1_000),
    },
  });
}

async function createResetRow(userId: string, code: string): Promise<void> {
  await globalDb().password_resets.create({
    data: {
      user_id: userId,
      code_hash: await hashSecret(code),
      expires_at: new Date(Date.now() + CODE_TTL_SECONDS * 1_000),
    },
  });
}

async function sessionRows(userId: string) {
  const rows = await globalDb().refresh_tokens.findMany({ where: { user_id: userId } });
  return {
    all: rows,
    live: rows.filter((r) => r.revoked_at === null && r.used_at === null),
    children: rows.filter((r) => r.parent_id !== null),
    liveChildren: rows.filter((r) => r.parent_id !== null && r.revoked_at === null),
  };
}

// ---------------------------------------------------------------------------------------------
// a. Magic link consume. Mechanism: a conditional
//    UPDATE magic_tokens SET consumed_at = now() WHERE id = ? AND consumed_at IS NULL RETURNING *
//    inside one transaction — the row lock serialises the racers and only the first transaction
//    sees the token still unconsumed.
// ---------------------------------------------------------------------------------------------
describe('magic link consume race', () => {
  it(
    `2-way race over ${ROUNDS} rounds: exactly one 200, one session family, byte-identical 401s`,
    async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        await clearRateKeys();
        const email = uniqueEmail('race-magic2');
        const userId = await createVerifiedUser(email, 'Race-Password-1');
        const token = await createMagicTokenFor(userId);

        const responses = await Promise.all([
          post(app, '/auth/magic/consume', { token }),
          post(app, '/auth/magic/consume', { token }),
        ]);
        const ok = responses.filter((r) => r.status === 200);
        const bad = responses.filter((r) => r.status === 401);

        expect(ok.length, `round ${round}`).toBe(1);
        expect(bad.length, `round ${round}`).toBe(1);

        const bodies = await Promise.all(bad.map((r) => r.text()));
        expect(new Set(bodies.map(normaliseBody)).size, `round ${round}: failure bodies differ`).toBe(1);
        expect(JSON.parse(bodies[0] ?? '{}')).toMatchObject({ error: { code: 'auth.link_invalid' } });

        const rows = await sessionRows(userId);
        expect(rows.all.length, `round ${round}: winner must create exactly one refresh row`).toBe(1);
        expect(new Set(rows.all.map((r) => r.family_id)).size, `round ${round}`).toBe(1);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `${CONCURRENCY}-way race over ${ROUNDS} rounds: exactly one winner, losers indistinguishable`,
    async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        await clearRateKeys();
        const email = uniqueEmail('race-magic8');
        const userId = await createVerifiedUser(email, 'Race-Password-1');
        const token = await createMagicTokenFor(userId);

        const responses = await Promise.all(
          Array.from({ length: CONCURRENCY }, () => post(app, '/auth/magic/consume', { token })),
        );
        const ok = responses.filter((r) => r.status === 200);
        const bad = responses.filter((r) => r.status === 401);

        expect(ok.length, `round ${round}: winners`).toBe(1);
        expect(bad.length, `round ${round}: losers`).toBe(CONCURRENCY - 1);

        const bodies = await Promise.all(bad.map((r) => r.text()));
        expect(new Set(bodies.map(normaliseBody)).size, `round ${round}`).toBe(1);
        expect(JSON.parse(bodies[0] ?? '{}')).toMatchObject({ error: { code: 'auth.link_invalid' } });

        const rows = await sessionRows(userId);
        expect(rows.all.length, `round ${round}`).toBe(1);
        expect(new Set(rows.all.map((r) => r.family_id)).size, `round ${round}`).toBe(1);
      }
    },
    TEST_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------------------------
// b. Reset grant consume. Mechanism: a conditional
//    UPDATE password_resets SET consumed_at = now(), grant_selector = NULL, ... WHERE id = ?
//    AND grant_selector IS NOT NULL — the row lock serialises; the loser finds no matching row
//    (LinkInvalid). Proven further: the loser's chosen password is never the one that becomes
//    active.
// ---------------------------------------------------------------------------------------------
describe('reset grant consume race', () => {
  it(
    `${ROUNDS} rounds: exactly one reset succeeds and only the winner's password becomes active`,
    async () => {
      const WIN = 'Winner-Password-1';
      const LOSE = 'Loser-Password-1';
      for (let round = 0; round < ROUNDS; round += 1) {
        await clearRateKeys();
        const email = uniqueEmail('race-grant');
        const userId = await createVerifiedUser(email, 'Race-Password-1');
        await createResetRow(userId, '654321');
        const grant = (await verifyResetCode({ email, code: '654321' })).grant;

        const responses = await Promise.all([
          post(app, '/auth/reset', { grant, newPassword: WIN, confirm: WIN }),
          post(app, '/auth/reset', { grant, newPassword: LOSE, confirm: LOSE }),
        ]);
        const ok = responses.filter((r) => r.status === 200);
        const bad = responses.filter((r) => r.status === 401);
        expect(ok.length, `round ${round}: winners`).toBe(1);
        expect(bad.length, `round ${round}: losers`).toBe(1);

        // results[0] carried WIN, results[1] carried LOSE — identify the winner's password.
        const winnerPassword = responses[0]?.status === 200 ? WIN : LOSE;
        const loserPassword = winnerPassword === WIN ? LOSE : WIN;
        await signIn({ email, password: winnerPassword });
        let loserFailed = false;
        await signIn({ email, password: loserPassword }).catch(() => {
          loserFailed = true;
        });
        expect(loserFailed, `round ${round}: loser's password must not work`).toBe(true);

        // Single use: the grant is dead even for the winner's row.
        let reuseFailed = false;
        await verifyResetCode({ email, code: '654321' }).catch(() => {
          reuseFailed = true;
        });
        expect(reuseFailed, `round ${round}: code single use`).toBe(true);
      }
    },
    TEST_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------------------------
// c. Verify-code races. Mechanisms: a conditional attempts++ UPDATE
//    (SET attempts = attempts + 1 WHERE attempts < CODE_MAX_ATTEMPTS), then a SELECT ... FOR
//    UPDATE on users plus the unique-email constraint inside one transaction. Single use holds
//    because the winner deletes the pending row inside the same transaction; the cap holds
//    because the guard refuses to increment past CODE_MAX_ATTEMPTS.
// ---------------------------------------------------------------------------------------------
describe('verify-code races', () => {
  it(
    `concurrent CORRECT-code sign-up verify over ${ROUNDS} rounds: exactly one success, code single use`,
    async () => {
      const CODE = '123456';
      for (let round = 0; round < ROUNDS; round += 1) {
        await clearRateKeys();
        const email = uniqueEmail('race-verify-ok');
        await createPendingSignup(email, CODE);

        const responses = await Promise.all(
          Array.from({ length: CONCURRENCY }, () => post(app, '/auth/signup/verify', { email, code: CODE })),
        );
        expect(responses.filter((r) => r.status === 200).length, `round ${round}: winners`).toBe(1);
        expect(responses.filter((r) => r.status === 401).length, `round ${round}: losers`).toBe(
          CONCURRENCY - 1,
        );

        const users = await globalDb().users.count({ where: { email } });
        expect(users, `round ${round}: one user created`).toBe(1);
        const pending = await globalDb().pending_signups.count({ where: { email } });
        expect(pending, `round ${round}: pending row deleted`).toBe(0);

        // Single use of the code: re-verify fails.
        let reuseFailed = false;
        await verifyCode({ email, code: CODE }).catch(() => {
          reuseFailed = true;
        });
        expect(reuseFailed, `round ${round}`).toBe(true);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `concurrent WRONG-code sign-up verify over ${ROUNDS} rounds: attempts cap holds (== ${5})`,
    async () => {
      const CODE = '123456';
      const WRONG = '000000';
      for (let round = 0; round < ROUNDS; round += 1) {
        await clearRateKeys();
        const email = uniqueEmail('race-verify-cap');
        await createPendingSignup(email, CODE);

        const responses = await Promise.all(
          Array.from({ length: CONCURRENCY }, () =>
            post(app, '/auth/signup/verify', { email, code: WRONG }),
          ),
        );
        expect(responses.filter((r) => r.status === 200).length, `round ${round}`).toBe(0);

        const row = await globalDb().pending_signups.findUnique({ where: { email } });
        expect(row, `round ${round}`).not.toBeNull();
        expect(row?.attempts, `round ${round}: cap must hold under a race`).toBeLessThanOrEqual(5);
        expect(row?.attempts, `round ${round}: guard admits exactly ${5} increments`).toBe(5);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `concurrent CORRECT-code reset verify over ${ROUNDS} rounds: exactly one grant, code single use`,
    async () => {
      const CODE = '123456';
      for (let round = 0; round < ROUNDS; round += 1) {
        await clearRateKeys();
        const email = uniqueEmail('race-reset-ok');
        const userId = await createVerifiedUser(email, 'Race-Password-1');
        await createResetRow(userId, CODE);

        // Service-level call: losers throw LinkInvalid, so allSettled not all.
        const results = await Promise.allSettled(
          Array.from({ length: CONCURRENCY }, () => verifyResetCode({ email, code: CODE })),
        );
        const grants = results.filter((r) => r.status === 'fulfilled' && 'grant' in r.value);
        expect(grants.length, `round ${round}: winners`).toBe(1);

        const row = await globalDb().password_resets.findFirst({
          where: { user_id: userId, consumed_at: { not: null } },
        });
        expect(row, `round ${round}: row consumed exactly once`).not.toBeNull();

        let reuseFailed = false;
        await verifyResetCode({ email, code: CODE }).catch(() => {
          reuseFailed = true;
        });
        expect(reuseFailed, `round ${round}: code single use`).toBe(true);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `concurrent WRONG-code reset verify over ${ROUNDS} rounds: attempts cap holds (== ${5})`,
    async () => {
      const CODE = '123456';
      const WRONG = '000000';
      for (let round = 0; round < ROUNDS; round += 1) {
        await clearRateKeys();
        const email = uniqueEmail('race-reset-cap');
        const userId = await createVerifiedUser(email, 'Race-Password-1');
        await createResetRow(userId, CODE);

        // Service-level call: every attempt fails (dummy verify or capped attempts).
        const results = await Promise.allSettled(
          Array.from({ length: CONCURRENCY }, () => verifyResetCode({ email, code: WRONG })),
        );
        expect(results.filter((r) => r.status === 'fulfilled').length, `round ${round}`).toBe(0);

        const row = await globalDb().password_resets.findFirst({
          where: { user_id: userId, consumed_at: null },
        });
        expect(row, `round ${round}`).not.toBeNull();
        expect(row?.attempts, `round ${round}: cap must hold under a race`).toBeLessThanOrEqual(5);
        expect(row?.attempts, `round ${round}: guard admits exactly ${5} increments`).toBe(5);
      }
    },
    TEST_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------------------------
// d. Refresh rotation race (ADR 0007). Mechanism: the guarded conditional
//    UPDATE refresh_tokens SET used_at = now(), ... WHERE id = ? AND used_at IS NULL AND
//    revoked_at IS NULL AND expires_at > now() RETURNING * inside one transaction. The row lock
//    serialises the racers; the loser's UPDATE matches zero rows -> RotationLost -> revokeFamily
//    of the whole family (parent + any child). So the documented outcome is: one 200, one 401,
//    and zero live tokens afterwards — a forced re-login of the family, never two live sessions.
// ---------------------------------------------------------------------------------------------
describe('refresh rotation race (ADR 0007)', () => {
  it(
    `${ROUNDS} rounds: one 200 + one 401, family fully revoked, exactly one child ever created`,
    async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        await clearRateKeys();
        const email = uniqueEmail('race-refresh');
        const password = 'Race-Password-1';
        await createVerifiedUser(email, password);
        const result = await signIn({ email, password });
        if (!('tokens' in result)) {
          throw new Error('expected tokens');
        }
        const parentToken = result.tokens.refreshToken;

        const responses = await Promise.all([
          post(app, '/auth/refresh', { refreshToken: parentToken }),
          post(app, '/auth/refresh', { refreshToken: parentToken }),
        ]);
        const ok = responses.filter((r) => r.status === 200);
        const bad = responses.filter((r) => r.status === 401);
        expect(ok.length, `round ${round}: winner`).toBe(1);
        expect(bad.length, `round ${round}: loser`).toBe(1);
        expect(JSON.parse((await bad[0]?.text()) ?? '{}')).toMatchObject({
          error: { code: 'auth.refresh_invalid' },
        });

        const userId = (await globalDb().users.findUniqueOrThrow({ where: { email } })).id;
        const rows = await sessionRows(userId);
        expect(rows.live.length, `round ${round}: zero live tokens (family revoked)`).toBe(0);
        expect(rows.liveChildren.length, `round ${round}: never a live child`).toBe(0);
        expect(rows.children.length, `round ${round}: exactly one child ever created`).toBe(1);
      }
    },
    TEST_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------------------------
// e. logout-all vs refresh. Mechanisms: logout-all is an unconditional
//    UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = 'logout_all'
//    WHERE user_id = ? AND revoked_at IS NULL; refresh is the guarded conditional UPDATE above.
//    Every interleaving ends with zero live tokens: either refresh commits first and logout-all
//    then revokes parent+child, or logout-all revokes first and refresh's guard matches nothing.
// ---------------------------------------------------------------------------------------------
describe('logout-all vs refresh race', () => {
  it(
    `${ROUNDS} rounds: logout-all always 200, zero live tokens, a winning child is already dead`,
    async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        await clearRateKeys();
        const email = uniqueEmail('race-logout');
        const password = 'Race-Password-1';
        await createVerifiedUser(email, password);
        const result = await signIn({ email, password });
        if (!('tokens' in result)) {
          throw new Error('expected tokens');
        }
        const { accessToken, refreshToken } = result.tokens;

        const responses = await Promise.all([
          post(app, '/auth/logout-all', {}, { authorization: `Bearer ${accessToken}` }),
          post(app, '/auth/refresh', { refreshToken }),
        ]);
        expect(responses[0]?.status, `round ${round}: logout-all`).toBe(200);
        // refresh may win (200) or lose (401) depending on interleaving — never a 5xx.
        expect([200, 401]).toContain(responses[1]?.status);

        const userId = (await globalDb().users.findUniqueOrThrow({ where: { email } })).id;
        const rows = await sessionRows(userId);
        expect(rows.live.length, `round ${round}: zero live tokens`).toBe(0);
        expect(rows.liveChildren.length, `round ${round}: zero live children`).toBe(0);

        if (responses[1]?.status === 200) {
          // The winner's child is already revoked by logout-all: it cannot be refreshed again.
          const child = JSON.parse((await responses[1].text()) ?? '{}').refreshToken as string;
          const re = await post(app, '/auth/refresh', { refreshToken: child });
          expect(re.status, `round ${round}: winning child must be dead`).toBe(401);
        }
      }
    },
    TEST_TIMEOUT_MS,
  );
});
