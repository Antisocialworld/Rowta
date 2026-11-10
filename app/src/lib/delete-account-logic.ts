// Pure helper functions for account deletion flow logic (Task D2/E6; rules U1, U7, X14; ADR 0018).
// Zero react-native or component imports so plain Node/tsx tests run without Flow parser errors.

/**
 * Pure rule: can only proceed to confirmation step when user does not admin teams with other active members.
 * (PRD 8.10; ADR 0018: 409 conflict avoidance on client).
 */
export function canProceedToStep2(adminTeamsWithOthersCount: number): boolean {
  return adminTeamsWithOthersCount === 0;
}

/**
 * Pure rule: confirmation is ready only when password is provided and confirmText is exactly 'DELETE'.
 * (Rule X14: submit button ready state).
 */
export function isDeleteConfirmationReady(password: string, confirmText: string): boolean {
  return password.length > 0 && confirmText === 'DELETE';
}

