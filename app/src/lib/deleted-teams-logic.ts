// Pure helper functions for Deleted teams modal and trigger state (PRD 4, 8.10; rules U1, U7, X14).
// Zero react-native or component imports so plain Node/tsx tests run without Flow parser errors.

/**
 * Decides whether the Deleted teams modal should automatically close
 * (e.g. after the last team has been restored or list is empty).
 */
export function shouldCloseDeletedTeamsModal(remainingCount: number): boolean {
  return remainingCount <= 0;
}

/**
 * Decides whether the "Deleted teams (N)" trigger button should be visible on Your teams.
 * Shown only when there is at least one deleted team eligible for restore.
 */
export function shouldShowDeletedTeamsTrigger(teams: readonly unknown[] | undefined | null): boolean {
  return Boolean(teams && teams.length > 0);
}

/**
 * Derives the view state for DeletedTeamsModal.
 * If items are already loaded (count > 0), remains in 'list' state so a background
 * polling error or refetch does not blow away visible data (poll-error fix).
 */
export function deletedTeamsViewState({
  isLoading,
  isError,
  count,
}: {
  isLoading: boolean;
  isError: boolean;
  count: number;
}): 'loading' | 'error' | 'empty' | 'list' {
  if (count > 0) return 'list';
  if (isError) return 'error';
  if (isLoading) return 'loading';
  return 'empty';
}


