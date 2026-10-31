// TEAM ENTRY POINTS (rules U1, U2; Phase 4 & 5).
// Central pure helper defining which shift and team capabilities are exposed
// per role.
//
// Rules:
// - Owner, Manager and Staff each get Shifts, Activity and Swaps (Search is a top modal).
// - Only Owner and Manager can create shifts (mirrored on server by central policy matrix).
// - Null, undefined, or unknown roles get no entry points and cannot create shifts.
import type { MessageKey } from '../i18n/en';
import type { ShiftRoute } from '../state/shift-nav';

export type TeamEntryPointId = 'shifts' | 'activity' | 'swaps';

export interface TeamEntryPoint {
  id: TeamEntryPointId;
  label: MessageKey;
  route: ShiftRoute;
  testID: string;
}

export interface TeamEntryPointsList extends Array<TeamEntryPoint> {
  canCreateShift: boolean;
}

export const ENTRY_POINT_SHIFTS: TeamEntryPoint = {
  id: 'shifts',
  label: 'action.openShifts',
  route: { name: 'calendar' },
  testID: 'team-open-shifts',
};

export const ENTRY_POINT_ACTIVITY: TeamEntryPoint = {
  id: 'activity',
  label: 'action.openActivity',
  route: { name: 'activity' },
  testID: 'team-open-activity',
};

export const ENTRY_POINT_SWAPS: TeamEntryPoint = {
  id: 'swaps',
  label: 'swap.list.title',
  route: { name: 'swaps' },
  testID: 'team-open-swaps',
};

export const ALL_TEAM_ENTRY_POINTS: readonly TeamEntryPoint[] = [
  ENTRY_POINT_SHIFTS,
  ENTRY_POINT_ACTIVITY,
  ENTRY_POINT_SWAPS,
];

export function canCreateShift(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'manager';
}

export function teamEntryPoints(role: string | null | undefined): TeamEntryPointsList {
  const isOwnerOrManager = role === 'owner' || role === 'manager';
  const isStaff = role === 'staff';
  const isKnown = isOwnerOrManager || isStaff;

  const list = (isKnown ? [...ALL_TEAM_ENTRY_POINTS] : []) as TeamEntryPointsList;
  list.canCreateShift = isOwnerOrManager;
  return list;
}

