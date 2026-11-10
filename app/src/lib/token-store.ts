// TOKEN STORAGE (rule A11): the access and refresh tokens live in `expo-secure-store` on native,
// NEVER in AsyncStorage or any other unencrypted store. This module is PURE — the platform backend
// (SecureStore vs the web preview's memory) is injected from token-platform.ts — so the test script
// scripts/test-token-store.ts can run it in plain Node with no device (skill testing recipes).
//
// The web preview backend is in-memory ONLY: the deployed web surface (Phase 11) has no
// authenticated app, and writing tokens to web storage would violate the spirit of A11. A reload on
// web therefore returns to the signed-out state — acceptable for local screenshots and E2E runs
// that never reload mid-session.
//
// Nothing here logs, prints or returns a token anywhere except through get/set on the caller's own
// store (S1, S9).

export type TokenBackend = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

export type TokenPair = { accessToken: string; refreshToken: string };

export const ACCESS_KEY = 'rowta.accessToken';
export const REFRESH_KEY = 'rowta.refreshToken';

/** A backend that never persists: used for the web preview and by the test scripts. */
export function memoryBackend(): TokenBackend {
  const values = new Map<string, string>();
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value);
    },
    remove: async (key) => {
      values.delete(key);
    },
  };
}

export type TokenStore = {
  read(): Promise<TokenPair | null>;
  write(tokens: TokenPair): Promise<void>;
  clear(): Promise<void>;
  readRefreshToken?(): Promise<string | null>;
  readonly isWeb?: boolean;
};

export function createTokenStore(backend: TokenBackend, options?: { isWeb?: boolean }): TokenStore {
  return {
    async read() {
      const [accessToken, refreshToken] = await Promise.all([backend.get(ACCESS_KEY), backend.get(REFRESH_KEY)]);
      if (accessToken === null || refreshToken === null) return null;
      return { accessToken, refreshToken };
    },
    async write(tokens) {
      // Both writes must land before either is considered stored; a half-store reads as signed out.
      await Promise.all([
        backend.set(ACCESS_KEY, tokens.accessToken),
        backend.set(REFRESH_KEY, tokens.refreshToken),
      ]);
    },
    async clear() {
      await Promise.all([backend.remove(ACCESS_KEY), backend.remove(REFRESH_KEY)]);
    },
    async readRefreshToken() {
      return backend.get(REFRESH_KEY);
    },
    isWeb: options?.isWeb,
  };
}
