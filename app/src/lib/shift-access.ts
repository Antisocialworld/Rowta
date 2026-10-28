// SHIFT CONTROLS BY ROLE (Phase 4; PRD 4, 8.3; rule S5).
//
// This is the UI MIRROR only: the server re-checks every write through its central policy matrix.
// Owners and Managers manage shifts; Staff may read the calendar, feed, search and details. An
// unknown or missing role (list still loading) offers nothing.
export function canManageShifts(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'manager';
}
