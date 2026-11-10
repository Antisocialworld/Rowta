// Unit tests for Web Session Persistence (Task W1; ADR 0025; rules A11, S1, S5).
// Tests pure Node execution (no browser, no jsdom):
// 1. Single-flight: 3 concurrent callers produce exactly 1 refresh call.
// 2. Rejected refresh (401/403) clears storage and transitions to signedOut.
// 3. Ambiguous failure (network error, timeout, 5xx) clears storage and never retries.
// 4. Successful refresh writes the new rotated refresh token to storage before resolving.
// 5. Storage throwing (SecurityError / quota) gracefully falls back to in-memory store.
// 6. Native path unchanged: boot makes 0 network calls, network error during refresh keeps session.
//
// Run from repo root:
//   npm exec --workspace @rowta/app -- tsx scripts/test-web-session.ts

import { ApiError, authApi, setFetchForTests } from '../src/lib/api';
import { ACCESS_KEY, REFRESH_KEY, createTokenStore, memoryBackend } from '../src/lib/token-store';
import { webSessionBackend, type StorageLike } from '../src/lib/web-session-backend';
import { setTokenStore, useAuthSession } from '../src/state/auth-session';

process.env.EXPO_PUBLIC_API_URL = 'http://api.test';

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createMockStorage(): StorageLike & { values: Map<string, string>; ops: string[] } {
  const values = new Map<string, string>();
  const ops: string[] = [];
  return {
    values,
    ops,
    getItem: (key: string) => {
      ops.push(`get:${key}`);
      return values.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      ops.push(`set:${key}`);
      values.set(key, value);
    },
    removeItem: (key: string) => {
      ops.push(`remove:${key}`);
      values.delete(key);
    },
  };
}

async function main(): Promise<void> {
  // ===============================================================================================
  // Test 1: Single-flight (3 concurrent callers -> 1 refresh call)
  // ===============================================================================================
  {
    const storage = createMockStorage();
    storage.values.set(REFRESH_KEY, 'refresh-tab-1');

    const webStore = createTokenStore(webSessionBackend(() => storage), { isWeb: true });
    setTokenStore(webStore);
    useAuthSession.setState({ status: 'restoring', screen: 'home' });

    let refreshCalls = 0;
    setFetchForTests(async (url, _init) => {
      const urlStr = String(url);
      if (urlStr.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        await new Promise((r) => setTimeout(r, 25));
        return json(200, {
          data: {
            accessToken: 'access-rotated-1',
            refreshToken: 'refresh-rotated-1',
            userId: 'user-tab-1',
          },
        });
      }
      return json(404, { error: { code: 'not_found' } });
    });

    try {
      await Promise.all([
        useAuthSession.getState().restore(),
        useAuthSession.getState().restore(),
        useAuthSession.getState().restore(),
      ]);
    } catch (err) {
      if (err instanceof ApiError) {
        console.log(`Test 1 caught ApiError: code=${err.code} status=${err.status}`);
      } else {
        console.log(`Test 1 caught error: ${String(err)}`);
      }
    }

    const test1Status = useAuthSession.getState().status;
    if (test1Status !== 'signedIn') {
      console.log(`Test 1 unexpected final status: ${test1Status}`);
    }

    check(refreshCalls === 1, 'Test 1: 3 concurrent restore calls produce exactly 1 refresh call (single-flight)');
    check(useAuthSession.getState().status === 'signedIn', 'Test 1: session hydrates to signedIn after refresh');
    check(storage.values.get(REFRESH_KEY) === 'refresh-rotated-1', 'Test 1: new rotated token saved in sessionStorage');
    check(storage.values.get(ACCESS_KEY) === undefined, 'Test 1: access token is NEVER written to sessionStorage');
  }

  // ===============================================================================================
  // Test 2: Rejected refresh (401/403) clears storage and shows sign-in
  // ===============================================================================================
  {
    const storage = createMockStorage();
    storage.values.set(REFRESH_KEY, 'refresh-revoked');

    const webStore = createTokenStore(webSessionBackend(() => storage), { isWeb: true });
    setTokenStore(webStore);
    useAuthSession.setState({ status: 'restoring', screen: 'home' });

    let refreshCalls = 0;
    setFetchForTests(async (url) => {
      const urlStr = String(url);
      if (urlStr.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return json(401, {
          error: { code: 'auth.refresh_invalid', message: 'invalid refresh token', requestId: 'req-test-2' },
        });
      }
      return json(404, {});
    });

    await useAuthSession.getState().restore();

    check(refreshCalls === 1, 'Test 2: refresh was called once');
    check(useAuthSession.getState().status === 'signedOut', 'Test 2: rejected refresh transitions to signedOut');
    check(storage.values.get(REFRESH_KEY) === undefined, 'Test 2: rejected refresh clears sessionStorage');
  }

  // ===============================================================================================
  // Test 3: Ambiguous failure (network error, timeout, 5xx) clears storage and never retries
  // ===============================================================================================
  {
    const storage = createMockStorage();
    storage.values.set(REFRESH_KEY, 'refresh-ambiguous');

    const webStore = createTokenStore(webSessionBackend(() => storage), { isWeb: true });
    setTokenStore(webStore);
    useAuthSession.setState({ status: 'restoring', screen: 'home' });

    let refreshCalls = 0;
    setFetchForTests(async (url) => {
      const urlStr = String(url);
      if (urlStr.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        throw new TypeError('Network request failed');
      }
      return json(404, {});
    });

    await useAuthSession.getState().restore();

    check(refreshCalls === 1, 'Test 3: network failure on refresh called once');
    check(useAuthSession.getState().status === 'signedOut', 'Test 3: ambiguous failure on web transitions to signedOut');
    check(storage.values.get(REFRESH_KEY) === undefined, 'Test 3: ambiguous failure clears sessionStorage to prevent reuse revocation');

    // Attempt second restore: must NOT attempt refresh because token was cleared
    await useAuthSession.getState().restore();
    check(refreshCalls === 1, 'Test 3: subsequent restore never retries with old token');
  }

  // ===============================================================================================
  // Test 4: Successful refresh stores new token before resolving
  // ===============================================================================================
  {
    const storage = createMockStorage();
    storage.values.set(REFRESH_KEY, 'refresh-old-4');

    const webStore = createTokenStore(webSessionBackend(() => storage), { isWeb: true });
    setTokenStore(webStore);
    useAuthSession.setState({ status: 'restoring', screen: 'home' });

    let writeTimestamp = 0;

    const originalSetItem = storage.setItem;
    storage.setItem = (key: string, val: string) => {
      if (key === REFRESH_KEY && val === 'refresh-rotated-4') {
        writeTimestamp = Date.now();
      }
      originalSetItem(key, val);
    };

    setFetchForTests(async (url) => {
      const urlStr = String(url);
      if (urlStr.endsWith('/auth/refresh')) {
        return json(200, {
          data: {
            accessToken: 'access-new-4',
            refreshToken: 'refresh-rotated-4',
            userId: 'user-4',
          },
        });
      }
      return json(404, {});
    });

    try {
      await useAuthSession.getState().restore();
    } catch (err) {
      if (err instanceof ApiError) {
        console.log(`Test 4 caught ApiError: code=${err.code} status=${err.status}`);
      } else {
        console.log(`Test 4 caught error: ${String(err)}`);
      }
    }
    const resolveTimestamp = Date.now();

    const test4Status = useAuthSession.getState().status;
    if (test4Status !== 'signedIn') {
      console.log(`Test 4 unexpected final status: ${test4Status}`);
    }

    check(writeTimestamp > 0, 'Test 4: rotated refresh token was written');
    check(writeTimestamp > 0 && writeTimestamp <= resolveTimestamp, 'Test 4: rotated refresh token stored BEFORE restore resolved');
    check(storage.values.get(REFRESH_KEY) === 'refresh-rotated-4', 'Test 4: rotated token persisted');
  }

  // ===============================================================================================
  // Test 5: Storage throwing falls back to memory
  // ===============================================================================================
  {
    const throwingStorage: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError: sessionStorage is disabled');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };

    const backend = webSessionBackend(() => throwingStorage);
    const store = createTokenStore(backend, { isWeb: true });

    let threw = false;
    try {
      await store.write({ accessToken: 'a-fallback', refreshToken: 'r-fallback' });
      const readRef = await store.readRefreshToken?.();
      check(readRef === 'r-fallback', 'Test 5: readRefreshToken reads from memory fallback when storage throws');
      await store.clear();
      const readAfterClear = await store.readRefreshToken?.();
      check(readAfterClear === null, 'Test 5: clear clears memory fallback when storage throws');
    } catch {
      threw = true;
    }
    check(!threw, 'Test 5: storage throwing does not crash token store (falls back to memory)');
  }

  // ===============================================================================================
  // Test 6: Native path unchanged (zero boot network calls, network error keeps session)
  // ===============================================================================================
  {
    const nativeStore = createTokenStore(memoryBackend(), { isWeb: false });
    await nativeStore.write({ accessToken: 'access-native', refreshToken: 'refresh-native' });
    setTokenStore(nativeStore);
    useAuthSession.setState({ status: 'restoring', screen: 'home' });

    let networkCalls = 0;
    setFetchForTests(async (_url) => {
      networkCalls += 1;
      return json(404, {});
    });

    // Native boot restore makes ZERO network calls
    await useAuthSession.getState().restore();
    check(networkCalls === 0, 'Test 6: native restore makes ZERO network calls at boot');
    check(useAuthSession.getState().status === 'signedIn', 'Test 6: native restores directly to signedIn');

    // On native, network failure during refresh does NOT sign out
    setFetchForTests(async (url) => {
      const urlStr = String(url);
      if (urlStr.endsWith('/auth/refresh')) {
        throw new TypeError('Network failed');
      }
      return json(404, {});
    });

    // Authenticated API request gets 401, triggering single-flight refresh on native
    setFetchForTests(async (url) => {
      const urlStr = String(url);
      if (urlStr.endsWith('/auth/me')) {
        return json(401, { error: { code: 'auth.unauthorized' } });
      }
      if (urlStr.endsWith('/auth/refresh')) {
        throw new TypeError('Network failed');
      }
      return json(404, {});
    });

    try {
      await authApi.me();
    } catch {
      // Expected to throw transport error
    }

    check(useAuthSession.getState().status === 'signedIn', 'Test 6: native keeps session on network error during refresh');
    check((await nativeStore.read())?.refreshToken === 'refresh-native', 'Test 6: native tokens retained in store on network error');
  }

  console.log(`\ntest-web-session summary: ${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();

