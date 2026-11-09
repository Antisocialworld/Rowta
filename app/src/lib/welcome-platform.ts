// welcome-platform.ts — platform backend for the first-launch welcome store.
// Native: expo-secure-store (Keystore/Keychain). Web: in-memory memoryBackend.
// Mirrors token-platform.ts and activity-clear-platform.ts.
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createWelcomeStore, memoryBackend, type WelcomeBackend, type WelcomeStore } from './welcome-store';

function secureBackend(): WelcomeBackend {
  return {
    get: (key: string) => SecureStore.getItemAsync(key),
    set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
    remove: (key: string) => SecureStore.deleteItemAsync(key),
  };
}

const backend: WelcomeBackend = Platform.OS === 'web' ? memoryBackend() : secureBackend();

/** The single welcome store for the app: SecureStore on native, memory on web. */
export const welcomeStore: WelcomeStore = createWelcomeStore(backend);

