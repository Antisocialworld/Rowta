// THE REAL SESSION (rules A11, S5; replaces the Phase 1 stub for the root branch):
//
// - Tokens live in the platform token store (expo-secure-store on native, memory on the web preview);
//   the store is REGISTERED from App.tsx via setTokenStore() so this module never imports React Native
//   (it stays testable in plain Node — scripts/test-auth-session.ts drives every flow with a fake
//   fetch). This module keeps only an in-memory copy of the ACCESS token so requests do not hit the
//   keystore on every call. NOTHING here ever logs or prints a token (S1).
// - status starts at 'restoring': the app boots to the splash until restore() has READ the store
//   (no network at boot — a 401 later triggers refresh-and-retry through the API runtime).
// - Refresh is SINGLE-FLIGHT (A11): many concurrent 401s share one refresh run via singleFlight();
//   a revoked family (auth.refresh_invalid / 401 from refresh) ends the session locally; a network
//   failure during refresh does NOT sign anyone out — the request surfaces its own transport error.
// - The server decides (S5): this store never derives "signed in" from anything but the presence of
//   a stored pair; every real check (me, permissions, roles) happens server-side.
// - The dev gallery flag (home | gallery) moved here from the Phase 1 stub; that stub was REMOVED
//   once this store replaced it (docs/SECURITY.md section 3, session-removal note).
import { create } from 'zustand';
import { ApiError, authApi, setApiRuntime } from '../lib/api';
import { singleFlight } from '../lib/single-flight';
import type { TokenStore } from '../lib/token-store';
import { useAuthFlow } from './auth-context';
import { initialAuthState, useAuthViewStore } from './auth-view';
import { useTeams } from './teams';

export type AuthStatus = 'restoring' | 'signedOut' | 'signedIn';
export type SessionScreen = 'home' | 'gallery';

export type AuthSessionState = {
  status: AuthStatus;
  screen: SessionScreen;
  /** Reads the token store once per boot attempt; safe to call again (idempotent read). */
  restore: () => Promise<void>;
  /** A flow just returned tokens (sign-in, verify code, magic consume): persist and enter. */
  signInWithTokens: (tokens: { accessToken: string; refreshToken: string }) => Promise<void>;
  /** Revoke this device's refresh token (server call is best effort) and clear locally. */
  signOut: () => Promise<void>;
  /** Revoke every refresh token of the user (server call is best effort) and clear locally. */
  signOutAll: () => Promise<void>;
  openGallery: () => void;
  closeGallery: () => void;
};

/** Registered at boot (App.tsx imports lib/token-platform, which registers itself). */
let store: TokenStore | null = null;

/** In-memory access token; null means "read the store when needed". Never logged (S1). */
let accessToken: string | null = null;

export function setTokenStore(next: TokenStore): void {
  store = next;
  accessToken = null;
}

function requireStore(): TokenStore {
  if (store === null) {
    // Fail loud and early rather than silently "signed out" — this is a boot-order bug (P7 spirit).
    throw new Error('Rowta: the token store was not registered before use (import lib/token-platform first).');
  }
  return store;
}

function signedOut(): Pick<AuthSessionState, 'status' | 'screen'> {
  return { status: 'signedOut', screen: 'home' };
}

/** End the local session WITHOUT a server call (keystore clear cannot be skipped). */
async function clearLocal(): Promise<void> {
  accessToken = null;
  try {
    await requireStore().clear();
  } catch {
    // A keystore failure must not crash the sign-out path; the in-memory token is already gone.
  }
  // Signed out = a CLEAN auth page: no stale code/reset view left over (6.1) and no spent
  // codes/grants/magic token in memory (A10 hygiene). The invite token is cleared too (decision 3,
  // 26 Oct 2026): Phase 3's consumeInviteToken clears it after ANY server answer, so the only
  // tokens that can still be here are network-error retries of an attempt the LEAVING user started
  // — a second user on the same device must never inherit them (test-invite-token-lifecycle).
  useAuthViewStore.setState(initialAuthState);
  useAuthFlow.getState().clearCodeFlow();
  useAuthFlow.getState().setFlow({ inviteToken: null });
}

/** The one refresh run (A11 single-flight). Returns true only when a FRESH token is in place. */
const runRefresh = async (): Promise<boolean> => {
  const currentStore = requireStore();
  let refreshToken: string | null = null;
  try {
    if (currentStore.readRefreshToken) {
      refreshToken = await currentStore.readRefreshToken();
    }
    if (!refreshToken) {
      const pair = await currentStore.read();
      refreshToken = pair?.refreshToken ?? null;
    }
  } catch {
    return false;
  }
  if (!refreshToken) return false;

  try {
    const next = await authApi.refresh({ refreshToken });
    await currentStore.write({ accessToken: next.accessToken, refreshToken: next.refreshToken });
    accessToken = next.accessToken;
    return true;
  } catch (error) {
    if (currentStore.isWeb) {
      // Requirement 4 (web): Reuse-detection safety (server revokes the whole family if a token is presented twice):
      // never retry a refresh with the same token. If the refresh is rejected (401/403) -> clear storage, show sign-in.
      // If the failure is ambiguous (network error, timeout, 5xx, 429 after the request was sent) ->
      // also clear storage and show sign-in; do NOT retry with the old token. No loops, no splash that never ends.
      await clearLocal();
      useAuthSession.setState(signedOut());
      return false;
    }

    if (error instanceof ApiError && (error.code === 'auth.refresh_invalid' || error.status === 401 || error.status === 403)) {
      // Revoked/reused family (A11): end the session locally.
      await clearLocal();
      useAuthSession.setState(signedOut());
    }
    // Network / timeout / 5xx: keep the session; the waiting request surfaces its own error.
    return false;
  }
};
const refreshOnce = singleFlight(runRefresh);

// The API runtime: requests read the cached token (falling back to the store once after a cold
// start) and a 401 runs the single-flight refresh, after which send() retries the call ONCE.
setApiRuntime({
  getAccessToken: async () => {
    if (accessToken !== null) return accessToken;
    try {
      const pair = await requireStore().read();
      accessToken = pair?.accessToken ?? null;
    } catch {
      accessToken = null;
    }
    return accessToken;
  },
  onUnauthorized: () => refreshOnce(),
});

export const useAuthSession = create<AuthSessionState>((set) => ({
  status: 'restoring',
  screen: 'home',

  restore: async () => {
    try {
      const currentStore = requireStore();

      if (currentStore.isWeb) {
        // Web start-up (Task W1): idempotent if already signed in
        if (accessToken !== null) {
          set({ status: 'signedIn', screen: 'home' });
          return;
        }

        // If a refresh token is in sessionStorage, call refresh endpoint ONCE via single-flight guard
        const storedRefresh = await currentStore.readRefreshToken?.();
        if (storedRefresh) {
          const ok = await refreshOnce();
          if (ok) {
            set({ status: 'signedIn', screen: 'home' });
            return;
          }
        }
        // No stored token or refresh failed (runRefresh already cleared local storage on failure)
        set(signedOut());
        return;
      }

      // Native start-up (unchanged): read keystore directly (no network call at boot)
      const pair = await currentStore.read();
      accessToken = pair?.accessToken ?? null;
      set(pair === null ? signedOut() : { status: 'signedIn', screen: 'home' });
    } catch {
      // A keystore or storage read failure signs out rather than crashing the boot (fail closed, A11).
      accessToken = null;
      set(signedOut());
    }
  },

  signInWithTokens: async (tokens) => {
    await requireStore().write(tokens);
    accessToken = tokens.accessToken;
    // Invite accept goes through the ONE path (consumeInviteToken — decisions 1-3): automatic, the
    // outcome is ALWAYS stored for a result view, and the memory token is cleared after any server
    // answer (kept only on a network/timeout failure for a retry). This call never throws (the
    // result lives in the teams store), so signing in is never blocked by an invite outcome.
    const inviteToken = useAuthFlow.getState().inviteToken;
    if (inviteToken !== null) {
      await useTeams.getState().consumeInviteToken(inviteToken);
    }
    // Whatever code/reset flow led here is finished — drop its email, timers and grant (A10).
    useAuthFlow.getState().clearCodeFlow();
    set({ status: 'signedIn', screen: 'home' });
  },

  signOut: async () => {
    const currentStore = requireStore();
    let refreshToken: string | null = null;
    try {
      if (currentStore.readRefreshToken) {
        refreshToken = await currentStore.readRefreshToken();
      }
      if (!refreshToken) {
        const pair = await currentStore.read();
        refreshToken = pair?.refreshToken ?? null;
      }
    } catch {
      refreshToken = null;
    }
    try {
      if (refreshToken !== null) await authApi.logout({ refreshToken });
    } catch {
      // Best effort: a failed revoke must not trap the user signed in; the local clear follows.
    }
    await clearLocal();
    set(signedOut());
  },

  signOutAll: async () => {
    try {
      await authApi.logoutAll();
    } catch {
      // Best effort, as above: local clearing is unconditional.
    }
    await clearLocal();
    set(signedOut());
  },

  openGallery: () => set({ screen: 'gallery' }),
  closeGallery: () => set({ screen: 'home' }),
}));
