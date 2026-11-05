// Central team lifecycle handlers (Phase 5; UX pass).
import type { QueryClient } from '@tanstack/react-query';
import type { TeamListResponse } from '@rowta/shared';
import type { MessageKey } from '../i18n/en';
import {
  FORBIDDEN_REFETCH_COOLDOWN_MS,
  setOnTeamNotFound,
  setOnTeamForbidden,
  shouldTriggerRoleRefetch,
  teamsApi,
} from './api';
import { useTeams } from '../state/teams';
import { useShiftNav } from '../state/shift-nav';
import { useTeamsView } from '../state/teams-view';

export { FORBIDDEN_REFETCH_COOLDOWN_MS, shouldTriggerRoleRefetch };

let lastForbiddenRefetchAtMs = 0;

/** Test seam: reset the throttle timestamp. */
export function resetForbiddenRefetchThrottle(): void {
  lastForbiddenRefetchAtMs = 0;
}

/**
 * Handle team deletion, ownership transfer, or removal (404 team.notFound):
 * - Removes the team from the cached team list in TanStack Query
 * - Clears the selected team if it was that one
 * - Resets shift navigation
 * - Invalidates every query keyed on that teamId (shifts, swaps, activity, members)
 * - Navigates to Your teams ('list') at once, with no refresh
 */
export function handleTeamDecommissioned(
  queryClient: QueryClient,
  teamId: string,
  options?: { message?: MessageKey },
): void {
  // 1. Remove the team from the cached team list in TanStack Query
  queryClient.setQueryData<TeamListResponse>(['teams', 'list'], (old) => {
    if (!old) return old;
    return {
      ...old,
      teams: old.teams.filter((t) => t.id !== teamId),
    };
  });
  void queryClient.invalidateQueries({ queryKey: ['teams', 'list'] });

  // 2. Clear selected team if it was that one
  if (useTeams.getState().selectedTeamId === teamId) {
    useTeams.getState().selectTeam(null);
  }
  useShiftNav.getState().reset();

  // 3. Invalidate and remove every query keyed on that teamId (shifts, swaps, activity, members)
  queryClient.removeQueries({ queryKey: ['shifts', teamId] });
  queryClient.removeQueries({ queryKey: ['swaps', teamId] });
  queryClient.removeQueries({ queryKey: ['teams', teamId] });
  queryClient.removeQueries({ queryKey: ['teams', 'detail', teamId] });
  void queryClient.invalidateQueries({ queryKey: ['shifts', teamId] });
  void queryClient.invalidateQueries({ queryKey: ['swaps', teamId] });
  void queryClient.invalidateQueries({ queryKey: ['teams', teamId] });

  // 4. Navigate to Your teams at once, with no refresh
  useTeamsView.getState().resetToList(options?.message);
}

/**
 * Register the 403 team.forbidden handler with the API transport layer:
 * - Throttles forced refetch to at most 1 per 5 seconds
 * - Actively refetches the team list to obtain the user's latest role / membership
 * - If the user was removed completely from the active team, decommissions it at once
 * - If the user is still a member, invalidates the active team's detail & members queries
 *   so on-screen views (Members, Team settings) update their permissions with zero reload
 */
export function setTeamForbiddenHandler(queryClient: QueryClient): void {
  setOnTeamForbidden((teamId) => {
    const now = Date.now();
    if (!shouldTriggerRoleRefetch(lastForbiddenRefetchAtMs, now)) {
      return;
    }
    lastForbiddenRefetchAtMs = now;

    const targetTeamId = teamId ?? useTeams.getState().selectedTeamId;

    void (async () => {
      const updatedList = await queryClient.fetchQuery({
        queryKey: ['teams', 'list'],
        queryFn: () => teamsApi.listTeams(),
      });
      void queryClient.invalidateQueries({ queryKey: ['teams', 'list'] });

      // If user was removed completely from the team, decommission at once
      if (targetTeamId && updatedList && !updatedList.teams.some((t) => t.id === targetTeamId)) {
        handleTeamDecommissioned(queryClient, targetTeamId, {
          message: 'teams.deletedOrRemoved',
        });
        return;
      }

      // If user is still a member, invalidate team detail so role updates immediately
      if (targetTeamId) {
        void queryClient.invalidateQueries({ queryKey: ['teams', 'detail', targetTeamId] });
        void queryClient.invalidateQueries({ queryKey: ['teams', 'members', targetTeamId] });
        void queryClient.invalidateQueries({ queryKey: ['teams', targetTeamId] });
      }
    })().catch(() => {
      // Background refetch failure must not throw or crash
    });
  });
}

/**
 * Register central team lifecycle handlers with the API transport layer (404 and 403).
 */
export function setTeamLifecycleHandlers(queryClient: QueryClient): void {
  setTeamNotFoundHandler(queryClient);
  setTeamForbiddenHandler(queryClient);
}

/**
 * Register the central 404 team.notFound handler (and 403 team.forbidden handler).
 */
export function setTeamNotFoundHandler(queryClient: QueryClient): void {
  setOnTeamNotFound((teamId) => {
    const targetTeamId = teamId ?? useTeams.getState().selectedTeamId;
    if (targetTeamId) {
      handleTeamDecommissioned(queryClient, targetTeamId, {
        message: 'teams.deletedOrRemoved',
      });
    } else {
      useTeams.getState().selectTeam(null);
      useShiftNav.getState().reset();
      useTeamsView.getState().resetToList('teams.deletedOrRemoved');
    }
  });
  setTeamForbiddenHandler(queryClient);
}
