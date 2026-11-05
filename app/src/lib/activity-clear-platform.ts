// activity-clear-platform.ts — platform backend for the clear-all-activity store.
// Native: expo-secure-store (Keystore/Keychain). Web preview: in-memory memoryBackend.
// This is the ONLY module that touches expo-secure-store for the clear-all store,
// mirroring token-platform.ts for tokens.
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createActivityClearStore, memoryBackend, type ActivityClearBackend } from './activity-clear-store';

function secureBackend(): ActivityClearBackend {
  return {
    get: (key: string) => SecureStore.getItemAsync(key),
    set: (key: string, value: string) => SecureStore.setItemAsync(key, value),
    remove: (key: string) => SecureStore.deleteItemAsync(key),
  };
}

const backend: ActivityClearBackend =
  Platform.OS === 'web' ? memoryBackend() : secureBackend();

/** The single clear-all store for the app: SecureStore on native, memory on web. */
export const activityClearStore = createActivityClearStore(backend);
