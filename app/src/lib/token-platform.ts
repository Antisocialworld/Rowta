// PLATFORM WIRING for token storage (rule A11): the only module that touches expo-secure-store.
// Kept apart from token-store.ts so the pure store stays testable in plain Node.
//
// Native: `expo-secure-store` (Keystore/Keychain) — the A11-mandated home for both tokens.
// Web preview: the in-memory backend from token-store.ts (never localStorage — see the store's
// header; the deployed web surface has no authenticated app).
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { setTokenStore } from '../state/auth-session';
import { createTokenStore, memoryBackend, type TokenStore } from './token-store';

function secureBackend() {
  return {
    get: (key: string) => SecureStore.getItemAsync(key),
    set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
    remove: (key: string) => SecureStore.deleteItemAsync(key),
  };
}

export const tokenStore: TokenStore = createTokenStore(Platform.OS === 'web' ? memoryBackend() : secureBackend());

// Register with the session layer on import: App.tsx imports this module FIRST (side effect), so
// restore() always finds the store. Keeps every RN/SecureStore import out of auth-session.ts.
setTokenStore(tokenStore);
