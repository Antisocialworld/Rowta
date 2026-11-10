// Phase 6 server tests: settings API routes, defaults, upsert, validation, isolation (PRD 7.1, 8.8, 12).
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { globalDb } from '../src/db/clients.ts';
import { signAccessToken } from '../src/security/access-token.ts';
import {
  clearRateKeys,
  createVerifiedUser,
  dataOf,
  ensureTestCountries,
  errorOf,
  post,
  shutdownAuthTest,
  testApp,
  uniqueEmail,
} from './helpers/auth-test.ts';

let app: Hono;

async function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return app.request(path, { method: 'GET', headers });
}

describe('Phase 6 settings routes', () => {
  let userAId: string;
  let userBId: string;
  let userAAuth: { authorization: string };
  let userBAuth: { authorization: string };

  beforeAll(async () => {
    await clearRateKeys();
    await ensureTestCountries();
    app = testApp('settings-routes');

    const emailA = uniqueEmail('settings-user-a');
    const emailB = uniqueEmail('settings-user-b');

    userAId = await createVerifiedUser(emailA, 'Password123#');
    userBId = await createVerifiedUser(emailB, 'Password123#');

    const tokenA = await signAccessToken(userAId);
    const tokenB = await signAccessToken(userBId);

    userAAuth = { authorization: `Bearer ${tokenA}` };
    userBAuth = { authorization: `Bearer ${tokenB}` };
  });

  afterAll(async () => {
    await shutdownAuthTest();
  });

  it('rejects unauthenticated GET /me/settings with 401', async () => {
    const res = await get('/me/settings');
    expect(res.status).toBe(401);
    const err = await errorOf(res);
    expect(err.code).toBe('auth.not_authenticated');
  });

  it('rejects unauthenticated POST /me/settings with 401', async () => {
    const res = await post(app, '/me/settings', { language: 'en' });
    expect(res.status).toBe(401);
    const err = await errorOf(res);
    expect(err.code).toBe('auth.not_authenticated');
  });

  it('returns defaults on GET when no row exists and does NOT create a row in the DB', async () => {
    // Verify no row exists initially for user A
    const db = globalDb();
    const existing = await db.user_settings.findUnique({ where: { user_id: userAId } });
    expect(existing).toBeNull();

    const res = await get('/me/settings', userAAuth);
    expect(res.status).toBe(200);
    const data = await dataOf(res);

    expect(data).toEqual({
      quietStart: null,
      quietEnd: null,
      timeZone: 'UTC',
      notifyShiftChanges: true,
      notifySwaps: true,
      notifyBilling: true,
      language: 'en',
      theme: 'system',
      updatedAt: null,
    });

    // Verify still no row exists in the database
    const stillNone = await db.user_settings.findUnique({ where: { user_id: userAId } });
    expect(stillNone).toBeNull();
  });

  it('creates the row on POST with only booleans, returning new values and non-null updatedAt', async () => {
    const res = await post(app, '/me/settings', { notifyBilling: false }, userAAuth);
    expect(res.status).toBe(200);
    const data = await dataOf(res);

    expect(data.notifyBilling).toBe(false);
    expect(data.notifyShiftChanges).toBe(true);
    expect(data.notifySwaps).toBe(true);
    expect(data.timeZone).toBe('UTC');
    expect(data.language).toBe('en');
    expect(data.theme).toBe('system');
    expect(data.quietStart).toBeNull();
    expect(data.quietEnd).toBeNull();
    expect(data.updatedAt).not.toBeNull();
    expect(typeof data.updatedAt).toBe('string');

    // Verify in database
    const db = globalDb();
    const row = await db.user_settings.findUnique({ where: { user_id: userAId } });
    expect(row).not.toBeNull();
    expect(row?.notify_billing).toBe(false);
  });

  it('advances updatedAt and updates only sent fields on a second POST', async () => {
    const res1 = await get('/me/settings', userAAuth);
    const data1 = await dataOf(res1);
    const firstUpdatedAt = data1.updatedAt as string;

    // Small delay so updatedAt advances according to clock
    await new Promise((r) => setTimeout(r, 20));

    const res2 = await post(app, '/me/settings', { theme: 'dark' }, userAAuth);
    expect(res2.status).toBe(200);
    const data2 = await dataOf(res2);

    expect(data2.theme).toBe('dark');
    expect(data2.notifyBilling).toBe(false); // retains previous write
    expect(data2.updatedAt).not.toBe(firstUpdatedAt);
    expect(new Date(data2.updatedAt as string).getTime()).toBeGreaterThan(
      new Date(firstUpdatedAt).getTime(),
    );
  });

  it('sets quiet hours with both fields and clears them with both null', async () => {
    // 1. Set quiet hours
    const resSet = await post(
      app,
      '/me/settings',
      { quietStart: '22:00', quietEnd: '06:00' },
      userAAuth,
    );
    expect(resSet.status).toBe(200);
    const dataSet = await dataOf(resSet);
    expect(dataSet.quietStart).toBe('22:00');
    expect(dataSet.quietEnd).toBe('06:00');

    // 2. Clear quiet hours with both null
    const resClear = await post(
      app,
      '/me/settings',
      { quietStart: null, quietEnd: null },
      userAAuth,
    );
    expect(resClear.status).toBe(200);
    const dataClear = await dataOf(resClear);
    expect(dataClear.quietStart).toBeNull();
    expect(dataClear.quietEnd).toBeNull();
  });

  it('rejects quietStart alone with 422 settings.quiet_pair', async () => {
    const resStart = await post(app, '/me/settings', { quietStart: '22:00' }, userAAuth);
    expect(resStart.status).toBe(422);
    const errStart = await errorOf(resStart);
    expect(errStart.fields?.quietEnd).toBe('settings.quiet_pair');

    const resEnd = await post(app, '/me/settings', { quietEnd: '06:00' }, userAAuth);
    expect(resEnd.status).toBe(422);
    const errEnd = await errorOf(resEnd);
    expect(errEnd.fields?.quietStart).toBe('settings.quiet_pair');

    const resMismatchedNull = await post(
      app,
      '/me/settings',
      { quietStart: '22:00', quietEnd: null },
      userAAuth,
    );
    expect(resMismatchedNull.status).toBe(422);
    const errMismatched = await errorOf(resMismatchedNull);
    expect(errMismatched.fields?.quietEnd).toBe('settings.quiet_pair');
  });

  it('rejects equal quietStart and quietEnd with 422 settings.quiet_equal', async () => {
    const res = await post(
      app,
      '/me/settings',
      { quietStart: '22:00', quietEnd: '22:00' },
      userAAuth,
    );
    expect(res.status).toBe(422);
    const err = await errorOf(res);
    expect(err.fields?.quietEnd).toBe('settings.quiet_equal');
  });

  it('rejects malformed quiet times with 422 settings.quiet_invalid', async () => {
    const res1 = await post(
      app,
      '/me/settings',
      { quietStart: '25:00', quietEnd: '06:00' },
      userAAuth,
    );
    expect(res1.status).toBe(422);
    const err1 = await errorOf(res1);
    expect(err1.fields?.quietStart).toBe('settings.quiet_invalid');

    const res2 = await post(
      app,
      '/me/settings',
      { quietStart: '22:00', quietEnd: 'invalid' },
      userAAuth,
    );
    expect(res2.status).toBe(422);
    const err2 = await errorOf(res2);
    expect(err2.fields?.quietEnd).toBe('settings.quiet_invalid');
  });

  it('rejects invalid time zone with 422 settings.time_zone_invalid', async () => {
    const res = await post(
      app,
      '/me/settings',
      { timeZone: 'Atlantis/Sunken_City' },
      userAAuth,
    );
    expect(res.status).toBe(422);
    const err = await errorOf(res);
    expect(err.fields?.timeZone).toBe('settings.time_zone_invalid');
  });

  it('stores and returns a valid time zone (Africa/Lagos)', async () => {
    const res = await post(app, '/me/settings', { timeZone: 'Africa/Lagos' }, userAAuth);
    expect(res.status).toBe(200);
    const data = await dataOf(res);
    expect(data.timeZone).toBe('Africa/Lagos');

    const getRes = await get('/me/settings', userAAuth);
    const getData = await dataOf(getRes);
    expect(getData.timeZone).toBe('Africa/Lagos');
  });

  it('rejects invalid language and invalid theme with 422', async () => {
    const resLang = await post(app, '/me/settings', { language: 'invalid-lang' }, userAAuth);
    expect(resLang.status).toBe(422);
    const errLang = await errorOf(resLang);
    expect(errLang.fields?.language).toBe('settings.language_invalid');

    const resTheme = await post(app, '/me/settings', { theme: 'neon' }, userAAuth);
    expect(resTheme.status).toBe(422);
    const errTheme = await errorOf(resTheme);
    expect(errTheme.fields?.theme).toBe('settings.theme_invalid');
  });

  it('rejects an empty request body with 422 settings.empty', async () => {
    const res = await post(app, '/me/settings', {}, userAAuth);
    expect(res.status).toBe(422);
    const err = await errorOf(res);
    expect(err.fields?.form).toBe('settings.empty');
  });

  it('rejects unknown fields and an updatedAt field in the body with 422', async () => {
    const resUnknown = await post(
      app,
      '/me/settings',
      { unknownField: 'not_allowed' },
      userAAuth,
    );
    expect(resUnknown.status).toBe(422);
    const errUnknown = await errorOf(resUnknown);
    expect(errUnknown.fields?.unknownField).toBe('validation.unknown_field');

    const resUpdatedAt = await post(
      app,
      '/me/settings',
      { updatedAt: '2026-01-01T00:00:00.000Z' },
      userAAuth,
    );
    expect(resUpdatedAt.status).toBe(422);
    const errUpdatedAt = await errorOf(resUpdatedAt);
    expect(errUpdatedAt.fields?.updatedAt).toBe('validation.unknown_field');
  });

  it('ensures two different users keep independent settings', async () => {
    // User A sets Lagos and dark
    await post(app, '/me/settings', { timeZone: 'Africa/Lagos', theme: 'dark' }, userAAuth);

    // User B sets Kolkata and light
    await post(app, '/me/settings', { timeZone: 'Asia/Kolkata', theme: 'light' }, userBAuth);

    // Verify user A
    const resA = await get('/me/settings', userAAuth);
    const dataA = await dataOf(resA);
    expect(dataA.timeZone).toBe('Africa/Lagos');
    expect(dataA.theme).toBe('dark');

    // Verify user B
    const resB = await get('/me/settings', userBAuth);
    const dataB = await dataOf(resB);
    expect(dataB.timeZone).toBe('Asia/Kolkata');
    expect(dataB.theme).toBe('light');
  });

  it('ensures two sequential writes to the same user: the later one wins', async () => {
    await post(app, '/me/settings', { theme: 'light' }, userAAuth);
    await post(app, '/me/settings', { theme: 'dark' }, userAAuth);

    const res = await get('/me/settings', userAAuth);
    const data = await dataOf(res);
    expect(data.theme).toBe('dark');
  });
});

