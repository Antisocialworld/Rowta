// useActivityClearedUntil.ts — shared cleared-until horizon for the activity feed.
// Loads the per-(userId, teamId) cleared-until timestamp once and keeps it in shared Zustand state
// so ActivityScreen and DashboardScreen always agree. When ActivityScreen clears all, the Dashboard
// sees the new value immediately on the next render (no stale rows, no manual refresh).
import { useEffect } from 'react';
import { create } from 'zustand';
import { activityClearStore } from './activity-clear-platform';
import { activityClearKey } from './activity-clear-store';

interface ActivityClearedUntilState {
  values: Record<string, string | null>;
  loaded: Record<string, boolean>;
  setValue: (key: string, value: string | null) => void;
  markLoaded: (key: string) => void;
}

export const useActivityClearedUntilStore = create<ActivityClearedUntilState>((set) => ({
  values: {},
  loaded: {},
  setValue: (key, value) =>
    set((state) => ({ values: { ...state.values, [key]: value } })),
  markLoaded: (key) =>
    set((state) => ({ loaded: { ...state.loaded, [key]: true } })),
}));

// Module-level in-flight guard so two screens mounting at the same moment never start
// two storage reads for the same key. The read still happens exactly once per key per app run.
const loadingKeys = new Set<string>();

/** Shared hook: loads cleared-until once per (userId, teamId) and keeps it in shared Zustand state.
 *  Returns `clearedUntil` (null when never cleared), `isLoaded` (false until storage read completes),
 *  and `setClearedUntil` which persists via activity-clear-store and updates shared state at once.
 *  Callers must gate their activity query on `isLoaded` so cleared rows never flash on screen. */
export function useActivityClearedUntil(userId: string | null, teamId: string | null) {
  const setValue = useActivityClearedUntilStore((state) => state.setValue);
  const markLoaded = useActivityClearedUntilStore((state) => state.markLoaded);
  const key = userId && teamId ? activityClearKey(userId, teamId) : null;
  const clearedUntil = useActivityClearedUntilStore((state) => state.values[key ?? ''] ?? null);
  const isLoaded = useActivityClearedUntilStore((state) => state.loaded[key ?? ''] ?? false);

  useEffect(() => {
    if (!userId || !teamId || !key || isLoaded || loadingKeys.has(key)) return;
    loadingKeys.add(key);
    void (async (): Promise<void> => {
      try {
        const value = await activityClearStore.readClearedUntil(userId, teamId);
        setValue(key, value);
      } finally {
        loadingKeys.delete(key);
        markLoaded(key);
      }
    })();
  }, [userId, teamId, key, isLoaded, setValue, markLoaded]);

  const setClearedUntil = async (value: string): Promise<void> => {
    if (!userId || !teamId || !key) return;
    await activityClearStore.writeClearedUntil(userId, teamId, value);
    setValue(key, value);
  };

  return { clearedUntil, setClearedUntil, isLoaded };
}
