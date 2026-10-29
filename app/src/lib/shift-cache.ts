// shift-cache.ts — query-key conventions and cache eviction rules for shifts (PRD 8.3, 8.4, 8.5; rules C7, S5).
// Optimistically removes deleted shifts from in-memory cached lists (calendar, search) so they disappear immediately,
// removes per-shift detail cache, and invalidates shift and swap queries for server reconciliation.

export const shiftQueryKeys = {
  shiftsRoot: () => ['shifts'] as const,
  teamShifts: (teamId: string) => ['shifts', teamId] as const,
  calendar: (teamId: string, from: string, to: string) => ['shifts', teamId, from, to] as const,
  detail: (teamId: string, shiftId: string) => ['shifts', teamId, 'detail', shiftId] as const,
  search: (teamId: string, query: string) => ['shifts', teamId, 'search', query] as const,
  activity: (teamId: string) => ['shifts', teamId, 'activity'] as const,
  swapsRoot: () => ['swaps'] as const,
  teamsRoot: () => ['teams'] as const,
};

/**
 * Pure cache updater: filters out a deleted shift from any cache payload containing a `shifts` array.
 * Works uniformly on Calendar responses (`{ shifts: Shift[] }`) and Search responses (`{ members, shifts, activity }`).
 */
export function removeShiftFromCacheData<T>(data: T | undefined | null, deletedShiftId: string): T | undefined | null {
  if (!data || typeof data !== 'object') return data;
  if ('shifts' in data && Array.isArray((data as { shifts: unknown[] }).shifts)) {
    return {
      ...data,
      shifts: (data as { shifts: Array<{ id: string }> }).shifts.filter((s) => s.id !== deletedShiftId),
    };
  }
  return data;
}

export interface ShiftQueryClient {
  setQueriesData<T>(filters: { queryKey: readonly unknown[] }, updater: (oldData: T | undefined) => T | undefined): void;
  removeQueries(filters: { queryKey: readonly unknown[] }): void;
  invalidateQueries(filters: { queryKey: readonly unknown[] }): Promise<void>;
}

/**
 * Evict a deleted shift from all in-memory caches and trigger background refetch.
 * 1. Synchronously filters out the shift from any cached list under ['shifts', teamId] (calendar, search).
 * 2. Removes the per-shift detail cache ['shifts', teamId, 'detail', shiftId].
 * 3. Invalidates ['shifts'] so active queries refetch from the server.
 * 4. Invalidates ['swaps'] so any swap on the deleted shift receives shiftDeleted: true notice.
 * 5. Invalidates ['teams'].
 */
export async function evictDeletedShiftFromQueryClient(
  queryClient: ShiftQueryClient,
  teamId: string,
  shiftId: string,
): Promise<void> {
  // 1. Remove deleted shift immediately from in-memory query cache (calendar, search)
  queryClient.setQueriesData<{ shifts?: Array<{ id: string }> }>(
    { queryKey: shiftQueryKeys.teamShifts(teamId) },
    (old) => removeShiftFromCacheData(old, shiftId) ?? undefined,
  );

  // 2. Remove per-shift detail cache
  queryClient.removeQueries({ queryKey: shiftQueryKeys.detail(teamId, shiftId) });

  // 3. Invalidate shift queries
  await queryClient.invalidateQueries({ queryKey: shiftQueryKeys.shiftsRoot() });

  // 4. Invalidate swap queries so Swaps list marks the shift as deleted
  await queryClient.invalidateQueries({ queryKey: shiftQueryKeys.swapsRoot() });

  // 5. Invalidate teams queries
  await queryClient.invalidateQueries({ queryKey: shiftQueryKeys.teamsRoot() });
}

