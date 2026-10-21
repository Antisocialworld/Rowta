// API client proof (rules V1, V5, S5, S14i, A11; no device, no server): a fake fetch drives every
// contract the app depends on — envelope parsing, the 429 Retry-After SECONDS, the signIn union,
// the one-shot 401 refresh retry, transport failures and the code-to-catalog mapping that keeps
// raw server text off every screen. Run from the repo root:
//   npm exec --workspace @rowta/app -- tsx scripts/test-api-client.ts
import { authApi, ApiError, errorMessageKey, fieldErrorKey, setApiRuntime, setFetchForTests } from '../src/lib/api';

process.env.EXPO_PUBLIC_API_URL = 'http://api.test'; // test-only base URL, never a secret (S4)

let failures = 0;
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

type Call = { url: string; init: RequestInit };

function responder(handler: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  setFetchForTests(async (url, init) => {
    const call: Call = { url, init };
    calls.push(call);
    return handler(call, calls.length - 1);
  });
  return calls;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

async function expectApiError(run: () => Promise<unknown>, label: string): Promise<ApiError> {
  try {
    await run();
    check(false, `${label} (expected a rejection)`);
    return new ApiError(0, 'test.unexpected', '');
  } catch (error) {
    const ok = error instanceof ApiError;
    check(ok, label);
    return ok ? error : new ApiError(0, 'test.non-api', '');
  }
}

function signedOutRuntime(): void {
  setApiRuntime({ getAccessToken: async () => null });
}

async function main(): Promise<void> {
  signedOutRuntime();

  // -------------------------------------------------------------------------------------------
  // Success envelopes + client-side input validation (V1: the shared schema runs in the app too)
  // -------------------------------------------------------------------------------------------
  {
    const calls = responder(() =>
      json(200, {
        data: { message: 'Check your email for a code to finish creating your account.' },
        meta: { expiresInSeconds: 300, resendInSeconds: 60 },
      }),
    );
    const out = await authApi.signUp({
      displayName: 'Test Person',
      email: 'client-test@example.test',
      country: 'ZZ',
      password: 'Client-Password-1',
      confirm: 'Client-Password-1',
    });
    check(out.meta.expiresInSeconds === 300 && out.meta.resendInSeconds === 60, 'signUp returns typed meta timers (remaining seconds)');
    check(calls.length === 1 && calls[0]?.url === 'http://api.test/auth/signup', 'signUp POSTs to the configured base URL');
    check((calls[0]?.init.headers as Record<string, string>)['content-type'] === 'application/json', 'a JSON body sets content-type');

    let threw = false;
    try {
      await authApi.signUp({
        displayName: 'Short',
        email: 'client-test@example.test',
        country: 'ZZ',
        password: 'short',
        confirm: 'short',
      });
    } catch {
      threw = true;
    }
    check(threw, 'signUp validates the input with the SHARED schema before any network (V1)');
  }

  // -------------------------------------------------------------------------------------------
  // Error envelope: code + fields surfaced, message text NEVER carried (V5)
  // -------------------------------------------------------------------------------------------
  {
    responder(() => json(401, { error: { code: 'auth.failed', message: 'Invalid email or password.', requestId: 'req-1' } }));
    const error = await expectApiError(
      () => authApi.signIn({ email: 'someone@example.test', password: 'Whatever-Password-1' }),
      'a 401 error envelope throws ApiError',
    );
    check(error.status === 401 && error.code === 'auth.failed' && error.requestId === 'req-1', 'ApiError carries status, code and requestId');
    check(error.message === 'auth.failed', "ApiError.message is the CODE — never the server's text (V5)");
    check(errorMessageKey(error.code) === 'auth.signIn.failed', 'code auth.failed maps to the PRD-11 catalog key');
  }

  // 422 field codes come as catalog keys
  {
    responder(() =>
      json(422, {
        error: {
          code: 'validation.failed',
          message: 'Validation failed.',
          requestId: 'req-2',
          fields: { email: 'auth.email.invalid' },
        },
      }),
    );
    const error = await expectApiError(
      () => authApi.forgot({ email: 'client-test@example.test' }),
      'a 422 throws ApiError',
    );
    check(error.fields?.email === 'auth.email.invalid', 'field-level catalog codes are surfaced for the form (V3)');
  }

  // -------------------------------------------------------------------------------------------
  // 429: Retry-After is DELTA SECONDS (S14i), and the catalog key drives the countdown
  // -------------------------------------------------------------------------------------------
  {
    responder(() =>
      json(
        429,
        { error: { code: 'rate.limited', message: 'Too many attempts. Try again in a few minutes.', requestId: 'req-3' } },
        { 'Retry-After': '47' },
      ),
    );
    const error = await expectApiError(
      () => authApi.signIn({ email: 'limited@example.test', password: 'Whatever-Password-1' }),
      'a 429 throws ApiError',
    );
    check(error.retryAfterSeconds === 47, 'Retry-After arrives as retryAfterSeconds (delta seconds, never a clock time)');
    check(errorMessageKey(error.code) === 'auth.rateLimited', 'rate.limited maps to the catalog key for the countdown');
  }

  // -------------------------------------------------------------------------------------------
  // Malformed / gateway bodies: rejected as transport errors, raw text never surfaced
  // -------------------------------------------------------------------------------------------
  setApiRuntime({ getAccessToken: async () => 'token-for-transport' });
  {
    responder(() => json(200, { nothing: 'here' }));
    const malformed = await expectApiError(() => authApi.me(), 'a 200 body without the envelope is rejected');
    check(malformed.code === 'client.malformed', 'an off-contract 200 becomes client.malformed');
  }
  {
    responder(() => new Response('<html>proxy exploded</html>', { status: 502 }));
    const gateway = await expectApiError(() => authApi.countries(), 'a non-JSON gateway page is rejected');
    check(gateway.code === 'generic.error' && !gateway.message.includes('proxy'), 'gateway text is never carried (V5)');
  }
  {
    responder(() => {
      throw new TypeError('network down');
    });
    const network = await expectApiError(() => authApi.countries(), 'a network failure rejects');
    check(network.code === 'client.network' && errorMessageKey(network.code) === 'generic.error', 'network failure maps to generic.error');
  }
  {
    responder(() => {
      const abort = new Error('aborted');
      abort.name = 'AbortError';
      throw abort;
    });
    const timeout = await expectApiError(() => authApi.countries(), 'an abort rejects as a timeout');
    check(timeout.code === 'client.timeout', 'an aborted request becomes client.timeout');
  }
  signedOutRuntime();

  // -------------------------------------------------------------------------------------------
  // signIn union: tokens vs the uniform unverified prompt (PRD 8.1)
  // -------------------------------------------------------------------------------------------
  {
    responder(() =>
      json(200, {
        data: { accessToken: 'header.payload.sig', refreshToken: 'sel.ver', userId: 'user-1' },
      }),
    );
    const out = await authApi.signIn({ email: 'ok@example.test', password: 'Whatever-Password-1' });
    check(out.kind === 'tokens' && out.tokens.userId === 'user-1', 'signIn tokens branch parses');
  }
  {
    responder(() =>
      json(200, {
        data: { message: 'Check your email for a code to finish creating your account.' },
        meta: { expiresInSeconds: 300, resendInSeconds: 60 },
      }),
    );
    const out = await authApi.signIn({ email: 'pending@example.test', password: 'Whatever-Password-1' });
    check(out.kind === 'prompt' && out.meta.expiresInSeconds === 300, 'signIn prompt branch carries the code timers');
  }

  // -------------------------------------------------------------------------------------------
  // Authenticated calls: no token = local 401 without a request; 401 = ONE refresh retry (A11)
  // -------------------------------------------------------------------------------------------
  {
    const calls = responder(() => json(200, { data: { userId: 'u', displayName: 'N' } }));
    signedOutRuntime();
    const noToken = await expectApiError(() => authApi.me(), 'me() with no token fails locally');
    check(noToken.code === 'auth.not_authenticated' && calls.length === 0, 'no token means NO request is sent');
  }
  {
    let token = 'token-1';
    let refreshes = 0;
    setApiRuntime({
      getAccessToken: async () => token,
      onUnauthorized: async () => {
        refreshes += 1;
        token = 'token-2';
        return true;
      },
    });
    const calls = responder((_call, index) =>
      index === 0
        ? json(401, { error: { code: 'auth.not_authenticated', message: 'Not authenticated.', requestId: 'r1' } })
        : json(200, { data: { userId: 'u', displayName: 'Ada' } }),
    );
    const out = await authApi.me();
    check(out.userId === 'u', 'me() succeeds after the refresh-and-retry');
    check(calls.length === 2 && refreshes === 1, 'exactly ONE refresh runs for a 401 (single-flight consumer side)');
    check((calls[1]?.init.headers as Record<string, string>).authorization === 'Bearer token-2', 'the retry carries the fresh token');

    // Persistent 401: the retry flag stops a loop — onUnauthorized runs once, two calls total.
    let stillRefreshes = 0;
    setApiRuntime({
      getAccessToken: async () => 'token-3',
      onUnauthorized: async () => {
        stillRefreshes += 1;
        return true;
      },
    });
    const looping = responder(() =>
      json(401, { error: { code: 'auth.not_authenticated', message: 'Not authenticated.', requestId: 'r2' } }),
    );
    const error = await expectApiError(() => authApi.me(), 'a persistent 401 surfaces after the one retry');
    check(error.status === 401 && looping.length === 2 && stillRefreshes === 1, 'no retry loop: one retry, one onUnauthorized');
  }
  signedOutRuntime();

  // -------------------------------------------------------------------------------------------
  // Catalog mapping: unknown codes and field codes fall back, never raw text (V5, U8)
  // -------------------------------------------------------------------------------------------
  check(errorMessageKey('some.future.code') === 'generic.error', 'an unknown error code maps to generic.error');
  check(fieldErrorKey('validation.weird_code') === 'generic.error', 'an unknown field code maps to generic.error');
  check(fieldErrorKey('auth.email.invalid') === 'auth.email.invalid', 'a known field code maps to itself');
  check(errorMessageKey('client.config') === 'generic.error', 'a missing base URL maps to generic.error');

  // Base URL must come from the one EXPO_PUBLIC_ name (S4); unset = client.config, no request.
  {
    const saved = process.env.EXPO_PUBLIC_API_URL;
    delete process.env.EXPO_PUBLIC_API_URL;
    const calls = responder(() => json(200, { data: [] }));
    const error = await expectApiError(() => authApi.countries(), 'a missing base URL rejects before fetching');
    check(error.code === 'client.config' && calls.length === 0, 'EXPO_PUBLIC_API_URL unset = client.config and no request');
    process.env.EXPO_PUBLIC_API_URL = saved;
  }

  process.exit(failures === 0 ? 0 : 1);
}

void main();
