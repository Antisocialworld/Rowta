// Session store proof (rules A11, S5; no device, no server): a fake fetch plays the auth backend
// and drives every flow the app depends on — boot restore makes NO network calls, tokens persist,
// two concurrent 401s share ONE refresh run (single-flight), a revoked family signs out locally,
// a network failure during refresh does NOT sign anyone out, sign-out is best-effort at the server
// but unconditional locally, and a cold start restores from the store alone. Run from the repo root:
//   npm exec --workspace @rowta/app -- tsx scripts/test-auth-session.ts
import { ApiError, authApi, setFetchForTests } from '../src/lib/api';
import { createTokenStore, memoryBackend } from '../src/lib/token-store';
import { setTokenStore, useAuthSession } from '../src/state/auth-session';

process.env.EXPO_PUBLIC_API_URL = 'http://api.test'; // test-only base URL, never a secret (S4)

let failures = 0;
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// ---- the fake backend ---------------------------------------------------------------------------
const calls: string[] = [];
let validAccess = 'access-1';
let refreshTokenInUse = 'refresh-1';
let refreshCount = 0;
let refreshMode: 'ok' | 'invalid' | 'network' = 'ok';
let logoutMode: 'ok' | 'network' = 'ok';
let releaseRefresh: () => void = () => undefined;
const refreshGate = new Promise<void>((resolve) => {
  releaseRefresh = resolve;
});
let gateArmed = false;

const err401 = (code: string) =>
  json(401, { error: { code, message: 'server text that must never surface.', requestId: 'req-test' } });

setFetchForTests(async (url, init) => {
  const path = url.replace('http://api.test', '');
  const method = init.method ?? 'GET';
  calls.push(`${method} ${path}`);
  const headers = (init.headers ?? {}) as Record<string, string>;

  if (path === '/auth/me') {
    if (headers.authorization === `Bearer ${validAccess}`) {
      return json(200, { data: { userId: 'u-1', displayName: 'Ada' } });
    }
    return err401('auth.not_authenticated');
  }

  if (path === '/auth/refresh') {
    if (refreshMode === 'network') throw new TypeError('network down');
    if (gateArmed) await refreshGate;
    if (refreshMode === 'invalid') return err401('auth.refresh_invalid');
    const body = JSON.parse(String(init.body)) as { refreshToken: string };
    if (body.refreshToken !== refreshTokenInUse) return err401('auth.refresh_invalid');
    refreshCount += 1;
    validAccess = `access-r${refreshCount}`;
    refreshTokenInUse = `refresh-r${refreshCount}`;
    return json(200, { data: { accessToken: validAccess, refreshToken: refreshTokenInUse, userId: 'u-1' } });
  }

  if (path === '/auth/logout') {
    if (logoutMode === 'network') throw new TypeError('network down');
    return json(200, { data: {} });
  }
  if (path === '/auth/logout-all') return json(200, { data: {} });

  throw new Error(`unexpected request in the session test: ${method} ${path}`);
});

async function main(): Promise<void> {
  const store = createTokenStore(memoryBackend());
  setTokenStore(store);
  const session = () => useAuthSession.getState();

  check(session().status === 'restoring', "the session starts at 'restoring' (splash covers the boot)");

  // ---- boot restore: empty store, zero network -------------------------------------------------
  await session().restore();
  check(session().status === 'signedOut', 'an empty token store restores to signedOut');
  check(calls.length === 0, 'restore makes NO network call at boot (S5: the store is the only input)');

  // ---- sign-in persists tokens ------------------------------------------------------------------
  await session().signInWithTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' });
  check(session().status === 'signedIn', 'signInWithTokens enters the signed-in branch');
  const stored = await store.read();
  check(stored?.accessToken === 'access-1' && stored?.refreshToken === 'refresh-1', 'the pair is persisted to the store');

  // ---- authenticated call with the cached token --------------------------------------------------
  const me = await authApi.me();
  check(me.displayName === 'Ada', 'me() succeeds with the cached access token');
  check(refreshCount === 0, 'no refresh ran while the token was valid');

  // ---- concurrent 401s share ONE refresh (A11 single-flight) ------------------------------------
  gateArmed = true;
  validAccess = 'stale-1';
  const meCallsBefore = calls.filter((entry) => entry === 'GET /auth/me').length;
  const p1 = authApi.me();
  const p2 = authApi.me();
  await new Promise((resolve) => setTimeout(resolve, 20));
  releaseRefresh();
  const [r1, r2] = await Promise.all([p1, p2]);
  gateArmed = false;
  check(r1.userId === 'u-1' && r2.userId === 'u-1', 'both concurrent calls succeed after the refresh');
  check(refreshCount === 1, 'TWO concurrent 401s produced exactly ONE refresh run (single-flight, A11)');
  check(
    calls.filter((entry) => entry === 'GET /auth/me').length === meCallsBefore + 4,
    'each call retried exactly once (two attempts each)',
  );

  // ---- a revoked family ends the session locally -------------------------------------------------
  refreshMode = 'invalid';
  validAccess = 'stale-2';
  let revoked: unknown;
  try {
    await authApi.me();
  } catch (error) {
    revoked = error;
  }
  check(revoked instanceof ApiError && revoked.status === 401, 'me() rejects when the refresh family is revoked');
  check(revoked instanceof ApiError && revoked.message === 'auth.not_authenticated', 'the surfaced error is a CATALOG code, never server text (V5)');
  check(session().status === 'signedOut', 'auth.refresh_invalid signs the session out locally (A11)');
  check((await store.read()) === null, 'the revoked pair is cleared from the store');
  refreshMode = 'ok';

  // ---- sign-out: server revoke is best effort, local clear is unconditional ----------------------
  validAccess = 'access-A';
  await session().signInWithTokens({ accessToken: 'access-A', refreshToken: 'refresh-A' });
  const logoutCallIndex = calls.length;
  await session().signOut();
  const logoutCall = calls.slice(logoutCallIndex).find((entry) => entry === 'POST /auth/logout');
  check(logoutCall !== undefined, 'signOut calls the server to revoke the refresh token');
  check(session().status === 'signedOut' && (await store.read()) === null, 'signOut always clears locally');

  // ---- sign-out still clears when the server is unreachable -------------------------------------
  logoutMode = 'network';
  await session().signInWithTokens({ accessToken: 'access-B', refreshToken: 'refresh-B' });
  await session().signOut();
  check(
    session().status === 'signedOut' && (await store.read()) === null,
    'a network failure at logout still signs out locally (best effort)',
  );
  logoutMode = 'ok';

  // ---- sign-out everywhere -----------------------------------------------------------------------
  await session().signInWithTokens({ accessToken: 'access-C', refreshToken: 'refresh-C' });
  const allIndex = calls.length;
  await session().signOutAll();
  check(calls.slice(allIndex).includes('POST /auth/logout-all'), 'signOutAll revokes every device server-side');
  check(session().status === 'signedOut' && (await store.read()) === null, 'signOutAll clears locally too');

  // ---- network failure during refresh does NOT sign anyone out -----------------------------------
  await session().signInWithTokens({ accessToken: 'access-D', refreshToken: 'refresh-D' });
  refreshMode = 'network';
  validAccess = 'stale-D';
  let transportError = false;
  try {
    await authApi.me();
  } catch {
    transportError = true;
  }
  check(transportError, 'a dead network surfaces as a request failure');
  check(session().status === 'signedIn', 'a network failure during refresh does NOT sign the user out');
  check((await store.read())?.accessToken === 'access-D', 'the pair survives a failed refresh (no local clear)');
  refreshMode = 'ok';

  // ---- cold start: restore again from the store, still no network ---------------------------------
  useAuthSession.setState({ status: 'restoring' });
  const callsBeforeRestore = calls.length;
  await session().restore();
  check(session().status === 'signedIn', 'a cold start with stored tokens restores to signedIn');
  check(calls.length === callsBeforeRestore, 'the cold-start restore still makes NO network call');

  process.exit(failures === 0 ? 0 : 1);
}

void main();
