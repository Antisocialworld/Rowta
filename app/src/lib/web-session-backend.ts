// Pure web session storage backend (Task W1, Task F4, ADR 0025; rules A11, S1, S5).
// Zero expo, expo-secure-store or react-native imports so it can be tested in plain Node.
import { ACCESS_KEY, REFRESH_KEY, type TokenBackend } from './token-store';

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/**
 * Web backend (Task W1, ADR 0025):
 * 1. Access token stays in memory only.
 * 2. Refresh token is mirrored in sessionStorage (per-tab; survives reload, dies with tab).
 * 3. Every sessionStorage call is wrapped in try/catch (falls back to memory on failure).
 */
export function webSessionBackend(
  storageAccessor?: () => StorageLike | null | undefined,
): TokenBackend {
  const memory = new Map<string, string>();

  const getStorage = (): StorageLike | null => {
    try {
      if (storageAccessor !== undefined) {
        return storageAccessor() ?? null;
      }
      if (typeof window !== 'undefined' && window.sessionStorage) {
        return window.sessionStorage;
      }
    } catch {
      // Accessing sessionStorage may throw in restricted browsing contexts
    }
    return null;
  };

  return {
    get: async (key: string): Promise<string | null> => {
      // Access token is memory only (Requirement 1)
      if (key === ACCESS_KEY) {
        return memory.get(key) ?? null;
      }
      if (key === REFRESH_KEY) {
        try {
          const storage = getStorage();
          if (storage) {
            const val = storage.getItem(key);
            if (val !== null && val !== undefined) {
              return val;
            }
          }
        } catch {
          // On storage throw, fall back to memory
        }
        return memory.get(key) ?? null;
      }
      return memory.get(key) ?? null;
    },

    set: async (key: string, value: string): Promise<void> => {
      memory.set(key, value);
      // Only refresh token is stored in sessionStorage (Requirement 1 & 2)
      if (key === REFRESH_KEY) {
        try {
          const storage = getStorage();
          if (storage) {
            storage.setItem(key, value);
          }
        } catch {
          // On storage throw, memory already holds value
        }
      }
    },

    remove: async (key: string): Promise<void> => {
      memory.delete(key);
      if (key === REFRESH_KEY) {
        try {
          const storage = getStorage();
          if (storage) {
            storage.removeItem(key);
          }
        } catch {
          // On storage throw, memory is already cleared
        }
      }
    },
  };
}

