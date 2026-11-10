// PLATFORM WIRING for token storage (rule A11): the only module that touches expo-secure-store.
// Kept apart from token-store.ts so the pure store stays testable in plain Node.
//
// Native: `expo-secure-store` (Keystore/Keychain) — the A11-mandated home for both tokens.
// Web (Task W1, ADR 0025): access token in memory only; refresh token in sessionStorage (per-tab,
// survives reload, dies with tab). All sessionStorage calls wrapped in try/catch (falls back to memory).
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { setTokenStore } from '../state/auth-session';
import { createTokenStore, type TokenBackend, type TokenStore } from './token-store';
import { webSessionBackend, type StorageLike } from './web-session-backend';

export { webSessionBackend, type StorageLike };

function secureBackend(): TokenBackend {
  return {
    get: (key: string) => SecureStore.getItemAsync(key),
    set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
    remove: (key: string) => SecureStore.deleteItemAsync(key),
  };
}

export const tokenStore: TokenStore = createTokenStore(
  Platform.OS === 'web' ? webSessionBackend() : secureBackend(),
  { isWeb: Platform.OS === 'web' },
);

// Register with the session layer on import: App.tsx imports this module FIRST (side effect), so
// restore() always finds the store. Keeps every RN/SecureStore import out of auth-session.ts.
setTokenStore(tokenStore);
