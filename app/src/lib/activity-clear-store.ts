// activity-clear-store.ts — pure "clear all activity" horizon store builder.
// Remembers, per (userId, teamId), the createdAt (ms) of the newest event at clear time.
// Events strictly newer than this still appear. Never stores tokens or secrets.
// This module is PURE: no React Native, no expo-secure-store, no platform imports.
// The platform backend (SecureStore on native, memory on web) lives in
// activity-clear-platform.ts and wires itself in via createActivityClearStore.
// Reads and writes never throw: on any storage error the store behaves as "not cleared".
export type ActivityClearBackend = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

/** A backend that never persists: used for the web preview and by the test scripts. */
export function memoryBackend(): ActivityClearBackend {
  const values = new Map<string, string>();
  return {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => {
      values.set(key, value);
    },
    remove: async (key: string) => {
      values.delete(key);
    },
  };
}

const PREFIX = 'rowta.activityClear.';

/** Builds the storage key from userId + teamId so different users/teams never collide. */
export function activityClearKey(userId: string, teamId: string): string {
  return `${PREFIX}${userId}.${teamId}`;
}

/** Creates a clear-all store over the given backend. Reads/writes never throw. */
export function createActivityClearStore(backend: ActivityClearBackend) {
  return {
    /** Reads the cleared-until ISO timestamp (ms) for a (userId, teamId). */
    async readClearedUntil(userId: string, teamId: string): Promise<string | null> {
      try {
        return await backend.get(activityClearKey(userId, teamId));
      } catch {
        return null;
      }
    },
    /** Writes the cleared-until ISO timestamp (ms) for a (userId, teamId). */
    async writeClearedUntil(
      userId: string,
      teamId: string,
      clearedUntil: string,
    ): Promise<void> {
      try {
        await backend.set(activityClearKey(userId, teamId), clearedUntil);
      } catch {
        // Storage failure must not crash Clear all; the feed just won't persist the horizon.
      }
    },
    /** Removes the cleared-until value for a (userId, teamId). */
    async clearClearedUntil(userId: string, teamId: string): Promise<void> {
      try {
        await backend.remove(activityClearKey(userId, teamId));
      } catch {
        // Storage failure must not crash.
      }
    },
  };
}
