// welcome-store.ts — pure storage wrapper for the first-launch welcome flag.
// Follows the same backend-injected pattern as token-store.ts and activity-clear-store.ts.
// Pure: no React Native, no expo-secure-store. Reads/writes never throw.

export type WelcomeBackend = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove?(key: string): Promise<void>;
};

export const WELCOME_KEY = 'rowta.first_launch.welcome_seen';

/** In-memory backend for web preview, testing, and fallbacks. */
export function memoryBackend(): WelcomeBackend {
  const map = new Map<string, string>();
  return {
    get: async (key: string) => map.get(key) ?? null,
    set: async (key: string, value: string) => {
      map.set(key, value);
    },
    remove: async (key: string) => {
      map.delete(key);
    },
  };
}

export type WelcomeStore = {
  hasSeenWelcome(): Promise<boolean>;
  markSeen(): Promise<void>;
  reset(): Promise<void>;
};

export function createWelcomeStore(backend: WelcomeBackend): WelcomeStore {
  return {
    async hasSeenWelcome(): Promise<boolean> {
      try {
        const val = await backend.get(WELCOME_KEY);
        return val === 'true';
      } catch {
        return false;
      }
    },
    async markSeen(): Promise<void> {
      try {
        await backend.set(WELCOME_KEY, 'true');
      } catch {
        // Non-fatal; storage failure degrades gracefully.
      }
    },
    async reset(): Promise<void> {
      try {
        if (backend.remove) {
          await backend.remove(WELCOME_KEY);
        } else {
          await backend.set(WELCOME_KEY, 'false');
        }
      } catch {
        // Ignored.
      }
    },
  };
}

