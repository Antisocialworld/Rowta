/**
 * Helper for QuoteScreen AppState change detection (Task H10 / H11 / H14).
 * Pure TypeScript module with NO React Native imports so standalone Node/tsx test scripts can run.
 */

export type AppStateStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

/**
 * Normalises an AppState value (which React Native types as string | null | undefined)
 * to a validated AppStateStatus. Explicitly maps null/undefined/unrecognised values to 'unknown'.
 */
export function toAppStateStatus(state: string | null | undefined): AppStateStatus {
  if (
    state === 'active' ||
    state === 'background' ||
    state === 'inactive' ||
    state === 'extension' ||
    state === 'unknown'
  ) {
    return state;
  }
  return 'unknown';
}

export function shouldPollOnAppStateChange(
  previousState: AppStateStatus | string | null | undefined,
  nextState: AppStateStatus | string | null | undefined,
  pendingPayment: boolean,
  isPolling: boolean,
): boolean {
  if (!pendingPayment) return false;
  if (isPolling) return false;
  return (previousState === 'background' || previousState === 'inactive') && nextState === 'active';
}
