// Phase 2 rate limiting and validation (rules S14, V1 to V3, A7, A9; skill
// rowta-rate-limiting-recipes). Covers: the route registry cannot grow a limit-less route, the
// exact 30-per-IP walk to 429 with Retry-After, counters shared across two app instances,
// X-Forwarded-For behaviour vs TRUST_PROXY_HOPS, fail-closed and fail-open Redis-outage modes,
// and 422 with field-level codes (never raw Zod text) on every one of the 15 auth routes.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Context } from 'hono';
import { Hono } from 'hono';
import type { Redis } from 'ioredis';
import { AUTH_MESSAGES, countryListResponseSchema } from '@rowta/shared';
import { env } from '../src/config/env.ts';
import { registerPost, registeredRoutes } from '../src/http/routes.ts';
import { LIMITS, limitDef } from '../src/security/limits.ts';
import { __setRateLimitRedisForTests } from '../src/security/rate-limit.ts';
import { clientIp, normaliseAddress } from '../src/security/client-ip.ts';
import { signAccessToken } from '../src/security/access-token.ts';
import {
  clearRateKeys,
  createVerifiedUser,
  ensureTestCountries,
  errorOf,
  post,
  shutdownAuthTest,
  testApp,
  uniqueEmail,
} from './helpers/auth-test.ts';

const AUTH_PATHS = [
  '/auth/countries',
  '/auth/forgot',
  '/auth/forgot/resend',
  '/auth/forgot/verify',
  '/auth/logout',
  '/auth/logout-all',
  '/auth/magic/consume',
  '/auth/magic/request',
  '/auth/me',
  '/auth/reset',
  '/auth/restore-account',
  '/auth/signin',
  '/auth/signup',
  '/auth/signup/resend',
  '/auth/signup/verify',
  '/auth/refresh',
].sort();

let app: Hono;

beforeAll(async () => {
  await clearRateKeys();
  await ensureTestCountries();
  app = testApp('auth-limits');
});

afterAll(async () => {
  __setRateLimitRedisForTests(null);
  await shutdownAuthTest();
});

describe('route registry (S14)', () => {
  it('exactly the 15 auth routes are registered, each with at least one limit id', () => {
    const routes = registeredRoutes().filter((r) => r.path.startsWith('/auth/'));
    expect(routes.map((r) => r.path).sort()).toEqual(AUTH_PATHS);
    for (const route of routes) {
      // The two reads (me, countries) are GET; every other auth route is POST.
      const isGet = route.path === '/auth/me' || route.path === '/auth/countries';
      expect(route.method).toBe(isGet ? 'GET' : 'POST');
      expect(route.limitIds.length).toBeGreaterThanOrEqual(1);
      for (const id of route.limitIds) expect(limitDef(id)).toBeDefined();
    }
    // Only the session-ending routes and the profile read carry a user-keyed limit; all require auth.
    const userKeyed = routes.filter((r) => r.limitIds.some((id) => limitDef(id).key === 'user'));
    expect(userKeyed.map((r) => r.path).sort()).toEqual(['/auth/logout', '/auth/logout-all', '/auth/me']);
    for (const route of userKeyed) expect(route.auth).toBe(true);
    // Every limit id used anywhere exists in the one config file.
    const declared = new Set(routes.flatMap((r) => r.limitIds));
    const configured = new Set(LIMITS.map((l) => l.id));
    for (const id of declared) expect(configured.has(id)).toBe(true);
  });

  it('registration refuses a route with no limit id, an unknown id, or a user key without auth', () => {
    const handler = async (c: Context): Promise<Response> => c.json({ data: {} });
    expect(() => registerPost(new Hono(), '/auth/x', { limits: [] }, handler)).toThrow(/no rate limit id/);
    expect(() => registerPost(new Hono(), '/auth/x', { limits: ['does.not.exist'] }, handler)).toThrow(
      /unknown rate limit id/,
    );
    expect(() => registerPost(new Hono(), '/auth/x', { limits: ['logout.user'] }, handler)).toThrow(
      /does not require auth/,
    );
  });
});

describe('validation (V1 to V3)', () => {
  it('every route answers 422 with field codes and never raw Zod text', async () => {
    // A real access token, because logout authenticates before its body schema runs.
    const email = uniqueEmail('validation-auth');
    const userId = await createVerifiedUser(email, 'Validation-Password-1');
    const accessToken = await signAccessToken(userId);
    const authHeader = { authorization: `Bearer ${accessToken}` };

    for (const path of AUTH_PATHS) {
      // GETs have no body by construction; me's auth behaviour is asserted in auth-sessions.test.ts.
      if (path === '/auth/me' || path === '/auth/countries') continue;
      // logout-all's only input is the access token: with a real one, an empty body is VALID (200).
      if (path === '/auth/logout-all') {
        const ok = await post(app, path, {}, authHeader);
        expect(ok.status, `${path} accepts an empty body with a real access token`).toBe(200);
        continue;
      }
      // logout authenticates FIRST (401 beats 422 by design), so it gets a real access token;
      // the handler's schema then rejects the empty body (refreshToken is required).
      const isLogout = path === '/auth/logout';
      const res = await post(app, path, {}, isLogout ? authHeader : {});
      expect(res.status, `${path} should reject an empty body`).toBe(422);
      const text = await res.text();
      const error = JSON.parse(text) as {
        error: { code: string; message: string; requestId: string; fields?: Record<string, string> };
      };
      expect(error.error.code).toBe('validation.failed');
      expect(error.error.message).toBe('Validation failed.');
      expect(error.error.requestId).toBeTruthy();
      expect(Object.keys(error.error.fields ?? {}).length).toBeGreaterThan(0);
      expect(text).not.toMatch(/ZodError|Too small|Too big|invalid_type|unrecognized_keys|received|expected/i);
    }
  });

  it('missing fields are auth.field.required on sign-up and sign-in', async () => {
    const signUp = await post(app, '/auth/signup', {});
    const signUpFields = (await errorOf(signUp)).fields ?? {};
    expect(signUpFields).toMatchObject({
      displayName: 'auth.field.required',
      email: 'auth.field.required',
      country: 'auth.field.required',
      password: 'auth.field.required',
      confirm: 'auth.field.required',
    });

    const signIn = await post(app, '/auth/signin', {});
    expect((await errorOf(signIn)).fields).toMatchObject({
      email: 'auth.field.required',
      password: 'auth.field.required',
    });
  });

  it('maps each specific failure to its own code', async () => {
    const badEmail = await post(app, '/auth/signin', { email: 'not-an-email', password: 'whatever' });
    expect((await errorOf(badEmail)).fields).toMatchObject({ email: 'auth.email.invalid' });

    const shortPassword = await post(app, '/auth/signup', {
      displayName: 'Shorty',
      email: uniqueEmail('short'),
      country: 'ZZ',
      password: 'short',
      confirm: 'short',
    });
    expect((await errorOf(shortPassword)).fields).toMatchObject({ password: 'auth.password.tooShort' });

    const mismatch = await post(app, '/auth/signup', {
      displayName: 'Mismatch',
      email: uniqueEmail('mismatch'),
      country: 'ZZ',
      password: 'LongEnough-Password-1',
      confirm: 'Different-Password-1',
    });
    expect((await errorOf(mismatch)).fields).toMatchObject({ confirm: 'auth.password.mismatch' });

    const badCountryFormat = await post(app, '/auth/signup', {
      displayName: 'Country',
      email: uniqueEmail('country-format'),
      country: 'xx',
      password: 'LongEnough-Password-1',
      confirm: 'LongEnough-Password-1',
    });
    expect((await errorOf(badCountryFormat)).fields).toMatchObject({ country: 'validation.country' });

    const absentCountry = await post(app, '/auth/signup', {
      displayName: 'Country',
      email: uniqueEmail('country-absent'),
      country: 'XX', // well-formed, but not in `countries` (PRD 8.1)
      password: 'LongEnough-Password-1',
      confirm: 'LongEnough-Password-1',
    });
    expect(absentCountry.status).toBe(422);
    expect((await errorOf(absentCountry)).fields).toMatchObject({ country: 'validation.country' });

    const unknownKey = await post(app, '/auth/signup', {
      displayName: 'Extra',
      email: uniqueEmail('extra-key'),
      country: 'ZZ',
      password: 'LongEnough-Password-1',
      confirm: 'LongEnough-Password-1',
      termsAccepted: true,
    });
    expect((await errorOf(unknownKey)).fields).toMatchObject({ termsAccepted: 'validation.unknown_field' });

    const badCode = await post(app, '/auth/signup/verify', { email: uniqueEmail('code'), code: '123' });
    expect((await errorOf(badCode)).fields).toMatchObject({ code: 'auth.ready.code' });
  });

  it('malformed JSON is a clean 400 before any handler runs', async () => {
    const res = await app.request('/auth/signin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'this is not json',
    });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).code).toBe('request.malformed');
  });
});

describe('reference data (PRD 8.1, S5)', () => {
  it('GET /auth/countries is public and lists exactly what the server offers', async () => {
    const res = await app.request('/auth/countries', { method: 'GET' }); // no authorization header
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown };
    const list = countryListResponseSchema.parse(body.data);
    // The fixture country seeded in beforeAll is offered; the response matches the shared schema
    // (shape, uppercase code, bounded name) and is ordered by the Intl.Collator('en', { sensitivity: 'base' })
    // that listCountries() uses in code — same collator here so the assertion is deterministic.
    expect(list).toContainEqual({ code: 'ZZ', name: 'Test country' });
    const names = list.map((item) => item.name);
    const collator = new Intl.Collator('en', { sensitivity: 'base' });
    expect(names).toEqual([...names].sort((a, b) => collator.compare(a, b)));
  });
});

describe('rate limits', () => {
  it('the per-IP budget walks to exactly 30, then 429 with Retry-After and the catalog text', async () => {
    await clearRateKeys(); // deterministic budget regardless of the tests above

    let passed = 0;
    let limited: Response | null = null;
    for (let i = 0; i < 40; i += 1) {
      const res = await post(app, '/auth/signin', {
        email: uniqueEmail('walk'),
        password: 'Walk-Password-1',
      });
      if (res.status === 429) {
        limited = res;
        break;
      }
      expect(res.status).toBe(401); // unknown emails fail normally until the budget is spent
      passed += 1;
    }
    expect(passed).toBe(30); // signin.ip max = 30 per window
    expect(limited).not.toBeNull();
    const error = await errorOf(limited as Response);
    expect(error.code).toBe('rate.limited');
    expect(error.message).toBe(AUTH_MESSAGES['auth.rateLimited']);
    const retryAfter = Number((limited as Response).headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(900);
  });

  it('a second app instance sees the same counter (two processes, one Redis)', async () => {
    const otherInstance = testApp('auth-limits-b');
    const res = await post(otherInstance, '/auth/signin', {
      email: uniqueEmail('two-instances'),
      password: 'Walk-Password-1',
    });
    expect(res.status).toBe(429); // the shared IP budget is already spent by the first instance
  });

  it('X-Forwarded-For cannot mint a fresh bucket when no proxy is trusted', async () => {
    const res = await app.request('/auth/signin', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
      body: JSON.stringify({ email: uniqueEmail('xff'), password: 'Walk-Password-1' }),
    });
    if (env.TRUST_PROXY_HOPS === 0) {
      // The header is ignored: the request counts against the SAME spent bucket.
      expect(res.status).toBe(429);
    } else {
      // With a trusted proxy depth the rightmost trusted hop becomes the key: a fresh bucket.
      expect(res.status).toBe(401);
    }
  });

  it('clientIp: a fake forwarded header matters only when hops are trusted (skill section 5)', () => {
    const fake = (xff: string | undefined): Context =>
      ({
        req: {
          header: (name: string) => (name.toLowerCase() === 'x-forwarded-for' ? xff : undefined),
        },
        env: { incoming: { socket: { remoteAddress: '10.1.2.3' } } },
      }) as unknown as Context;

    if (env.TRUST_PROXY_HOPS === 0) {
      expect(clientIp(fake('198.51.100.77'))).toBe('10.1.2.3'); // header ignored entirely
      expect(clientIp(fake(undefined))).toBe('10.1.2.3');
    } else {
      expect(clientIp(fake('198.51.100.77, 192.0.2.1'))).not.toBe('10.1.2.3');
      expect(clientIp(fake(undefined))).toBe('10.1.2.3');
    }
    // IPv6 is grouped by /64 so one host cannot walk its whole range (S13).
    expect(normaliseAddress('2001:db8:1:2:3::4')).toBe('2001:db8:1:2::/64');
    expect(normaliseAddress('198.51.100.7')).toBe('198.51.100.7');
  });

  it('fail CLOSED: a dead Redis turns a limit into a generic 503, and recovery restores 401', async () => {
    const stub = {
      eval: () => Promise.reject(new Error('redis is down')),
    } as unknown as Redis;
    __setRateLimitRedisForTests(stub);
    try {
      const res = await post(app, '/auth/signin', {
        email: uniqueEmail('redis-down-c'),
        password: 'Whatever-Password-1',
      });
      expect(res.status).toBe(503);
      const error = await errorOf(res);
      expect(error.code).toBe('service.unavailable');
      expect(error.message).toBe(AUTH_MESSAGES['generic.error']);
    } finally {
      __setRateLimitRedisForTests(null);
    }

    await clearRateKeys(); // drop the exhausted walk budget from earlier
    const recovered = await post(app, '/auth/signin', {
      email: uniqueEmail('redis-back'),
      password: 'Whatever-Password-1',
    });
    expect(recovered.status).toBe(401);
  });

  it('fail OPEN: logout keeps working when Redis is down (its limit is low risk)', async () => {
    const email = uniqueEmail('o-mode');
    const userId = await createVerifiedUser(email, 'O-Mode-Password-1');
    const accessToken = await signAccessToken(userId);

    const stub = {
      eval: () => Promise.reject(new Error('redis is down')),
      ttl: () => Promise.reject(new Error('redis is down')),
      set: () => Promise.reject(new Error('redis is down')),
    } as unknown as Redis;
    __setRateLimitRedisForTests(stub);
    try {
      const res = await post(
        app,
        '/auth/logout',
        { refreshToken: 'selector-placeholder.verifier-placeholder' },
        { authorization: `Bearer ${accessToken}` },
      );
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('{"data":{}}');
    } finally {
      __setRateLimitRedisForTests(null);
    }
  });
});
