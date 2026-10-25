// Argon2id everywhere test suite (Rule A1, A2, A3, A4, PRD 8.1).
// Proves:
// 1. SHA-256 and banned hashes are absent in server/src, shared/src, app/src.
// 2. Every stored secret is an Argon2id PHC string ($argon2id$), never raw plaintext.
// 3. Right secret passes, wrong secret fails.
// 4. Wrong verifier with a valid selector fails (refresh, magic, reset grant).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authTokensResponseSchema, resetGrantResponseSchema } from '@rowta/shared';
import { globalDb } from '../src/db/clients.ts';
import { verifySecret } from '../src/security/argon2.ts';
import {
  TEST_COUNTRY,
  clearRateKeys,
  createVerifiedUser,
  dataOf,
  ensureTestCountries,
  mailCaptureClear,
  post,
  shutdownAuthTest,
  startEmailWorker,
  testApp,
  uniqueEmail,
  waitForMail,
} from './helpers/auth-test.ts';
import type { Hono } from 'hono';
import type { Worker } from 'bullmq';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

let app: Hono;
let worker: Worker;

beforeAll(async () => {
  await clearRateKeys();
  await ensureTestCountries();
  await mailCaptureClear();
  worker = await startEmailWorker();
  app = testApp('argon2-everywhere');
});

afterAll(async () => {
  await shutdownAuthTest(worker);
});

describe('Argon2id everywhere & banned algorithm scan (Rule A4)', () => {
  it('fails if SHA-256 or any banned algorithm appears anywhere in server/src, shared/src, app/src, or server/prisma/sql', () => {
    const scanDirs = [
      join(repoRoot, 'server', 'src'),
      join(repoRoot, 'shared', 'src'),
      join(repoRoot, 'app', 'src'),
      join(repoRoot, 'server', 'prisma', 'sql'),
    ];

    const bannedRegex = /\b(sha-?256|hmac-sha-?256|hs256|rs256|es256|ps256|md5|sha-?1)\b/i;

    function walk(dir: string): string[] {
      const files: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) files.push(...walk(full));
        else if (/\.(ts|tsx|js|jsx|mjs|cjs|json|sql)$/.test(entry)) files.push(full);
      }
      return files;
    }

    const violations: string[] = [];
    for (const dir of scanDirs) {
      for (const file of walk(dir)) {
        const content = readFileSync(file, 'utf8');
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (bannedRegex.test(lines[i]!)) {
            violations.push(`${file}:${i + 1}: ${lines[i]!.trim()}`);
          }
        }
      }
    }

    expect(violations, `Banned algorithms found: \n${violations.join('\n')}`).toEqual([]);
  });
});

describe('Every stored secret uses Argon2id (Rules A1, A2, A3)', () => {
  const password = 'Argon2-Password-8x!';

  it('stored value is an Argon2id PHC string and never the raw secret', async () => {
    const email = uniqueEmail('stored-secrets');
    const signup = await post(app, '/auth/signup', {
      displayName: 'Stored Secret Check',
      email,
      country: TEST_COUNTRY,
      password,
      confirm: password,
    });
    expect(signup.status).toBe(200);

    const mail = await waitForMail(email, 'Your Rowta verification code');
    const signupCode = /\b(\d{6})\b/.exec(mail.text)?.[1] ?? '';
    expect(signupCode).toHaveLength(6);

    const db = globalDb();

    // 1. pending_signups (password_hash and code_hash)
    const pending = await db.pending_signups.findUnique({ where: { email } });
    expect(pending).not.toBeNull();
    expect(pending?.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(pending?.code_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(pending?.password_hash).not.toContain(password);
    expect(pending?.code_hash).not.toContain(signupCode);

    // Verify right secret passes, wrong secret fails
    expect(await verifySecret(pending!.password_hash, password)).toBe(true);
    expect(await verifySecret(pending!.password_hash, 'Wrong-Password-1')).toBe(false);
    expect(await verifySecret(pending!.code_hash, signupCode)).toBe(true);
    expect(await verifySecret(pending!.code_hash, '000000')).toBe(false);

    // 2. users (password_hash) & refresh_tokens (verifier_hash)
    const verifyRes = await post(app, '/auth/signup/verify', { email, code: signupCode });
    expect(verifyRes.status).toBe(200);
    const session = authTokensResponseSchema.parse(await dataOf(verifyRes));

    const user = await db.users.findUnique({ where: { id: session.userId } });
    expect(user?.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(user?.password_hash).not.toContain(password);
    expect(await verifySecret(user!.password_hash, password)).toBe(true);
    expect(await verifySecret(user!.password_hash, 'Wrong-Password-1')).toBe(false);

    const [refreshSelector, refreshVerifier] = session.refreshToken.split('.');
    const refreshRow = await db.refresh_tokens.findUnique({ where: { selector: refreshSelector } });
    expect(refreshRow).not.toBeNull();
    expect(refreshRow?.verifier_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(refreshRow?.verifier_hash).not.toContain(refreshVerifier!);
    expect(await verifySecret(refreshRow!.verifier_hash, refreshVerifier!)).toBe(true);
    expect(await verifySecret(refreshRow!.verifier_hash, 'invalidverifier1234567890abcdef12345')).toBe(false);

    // 3. password_resets (code_hash and grant_verifier_hash)
    const forgotRes = await post(app, '/auth/forgot', { email });
    expect(forgotRes.status).toBe(200);
    const resetMail = await waitForMail(email, 'Your Rowta password reset code');
    const resetCode = /\b(\d{6})\b/.exec(resetMail.text)?.[1] ?? '';
    expect(resetCode).toHaveLength(6);

    const resetRow = await db.password_resets.findFirst({ where: { user_id: session.userId, consumed_at: null } });
    expect(resetRow).not.toBeNull();
    expect(resetRow?.code_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(resetRow?.code_hash).not.toContain(resetCode);
    expect(await verifySecret(resetRow!.code_hash, resetCode)).toBe(true);
    expect(await verifySecret(resetRow!.code_hash, '000000')).toBe(false);

    // Verify reset code to issue grant
    const codeVerifyRes = await post(app, '/auth/forgot/verify', { email, code: resetCode });
    expect(codeVerifyRes.status).toBe(200);
    const grantData = resetGrantResponseSchema.parse(await dataOf(codeVerifyRes));
    const [grantSelector, grantVerifier] = grantData.grant.split('.');

    const grantRow = await db.password_resets.findFirst({ where: { grant_selector: grantSelector } });
    expect(grantRow).not.toBeNull();
    expect(grantRow?.grant_verifier_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(grantRow?.grant_verifier_hash).not.toContain(grantVerifier!);
    expect(await verifySecret(grantRow!.grant_verifier_hash!, grantVerifier!)).toBe(true);
    expect(await verifySecret(grantRow!.grant_verifier_hash!, 'invalidverifier1234567890abcdef12345')).toBe(false);

    // 4. magic_tokens (verifier_hash)
    const magicEmail = uniqueEmail('stored-magic');
    await createVerifiedUser(magicEmail, password);
    const magicReq = await post(app, '/auth/magic/request', { email: magicEmail });
    expect(magicReq.status).toBe(200);
    const magicMail = await waitForMail(magicEmail, 'Your Rowta sign-in link');
    const magicToken = /magic#([A-Za-z0-9_.~-]+)/.exec(magicMail.text)?.[1] ?? '';
    const [magicSelector, magicVerifier] = magicToken.split('.');

    const magicRow = await db.magic_tokens.findUnique({ where: { selector: magicSelector } });
    expect(magicRow).not.toBeNull();
    expect(magicRow?.verifier_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(magicRow?.verifier_hash).not.toContain(magicVerifier!);
    expect(await verifySecret(magicRow!.verifier_hash, magicVerifier!)).toBe(true);
    expect(await verifySecret(magicRow!.verifier_hash, 'invalidverifier1234567890abcdef12345')).toBe(false);
  });

  it('wrong verifier with a valid selector fails with 401 (refresh, magic, reset grant)', async () => {
    // 1. Refresh token with valid selector + wrong verifier
    const sessionEmail = uniqueEmail('verifier-fail-refresh');
    await createVerifiedUser(sessionEmail, password);
    const signinRes = await post(app, '/auth/signin', { email: sessionEmail, password });
    expect(signinRes.status).toBe(200);
    const session = authTokensResponseSchema.parse(await dataOf(signinRes));
    const [refreshSelector] = session.refreshToken.split('.');

    const badRefreshRes = await post(app, '/auth/refresh', {
      refreshToken: `${refreshSelector}.wrongverifierwhichislongenough1234567890`,
    });
    expect(badRefreshRes.status).toBe(401);
    const badRefreshBody = (await badRefreshRes.json()) as { error: { code: string } };
    expect(badRefreshBody.error.code).toBe('auth.refresh_invalid');

    // 2. Magic link token with valid selector + wrong verifier
    const magicEmail = uniqueEmail('verifier-fail-magic');
    await createVerifiedUser(magicEmail, password);
    await post(app, '/auth/magic/request', { email: magicEmail });
    const magicMail = await waitForMail(magicEmail, 'Your Rowta sign-in link');
    const magicToken = /magic#([A-Za-z0-9_.~-]+)/.exec(magicMail.text)?.[1] ?? '';
    const [magicSelector] = magicToken.split('.');

    const badMagicRes = await post(app, '/auth/magic/consume', {
      token: `${magicSelector}.wrongverifierwhichislongenough1234567890`,
    });
    expect(badMagicRes.status).toBe(401);
    const badMagicBody = (await badMagicRes.json()) as { error: { code: string } };
    expect(badMagicBody.error.code).toBe('auth.link_invalid');

    // 3. Password reset grant with valid selector + wrong verifier
    const resetEmail = uniqueEmail('verifier-fail-reset');
    await createVerifiedUser(resetEmail, password);
    await post(app, '/auth/forgot', { email: resetEmail });
    const resetMail = await waitForMail(resetEmail, 'Your Rowta password reset code');
    const resetCode = /\b(\d{6})\b/.exec(resetMail.text)?.[1] ?? '';
    const verifyResetRes = await post(app, '/auth/forgot/verify', { email: resetEmail, code: resetCode });
    expect(verifyResetRes.status).toBe(200);
    const grantData = resetGrantResponseSchema.parse(await dataOf(verifyResetRes));
    const [grantSelector] = grantData.grant.split('.');

    const badGrantRes = await post(app, '/auth/reset', {
      grant: `${grantSelector}.wrongverifierwhichislongenough1234567890`,
      newPassword: 'BrandNew-Password-99!',
      confirm: 'BrandNew-Password-99!',
    });
    expect(badGrantRes.status).toBe(401);
    const badGrantBody = (await badGrantRes.json()) as { error: { code: string } };
    expect(badGrantBody.error.code).toBe('auth.link_invalid');
  });
});
