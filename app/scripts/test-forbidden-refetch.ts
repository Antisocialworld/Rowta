// Test: 403 team.forbidden refetch & lifecycle handling (Phase 5 role sync / zero-reload).
// Exercises:
// 1. Throttled helper: first call allowed, call at +1s rejected, call at +5.1s allowed.
// 2. A mock fetch returning 403 team.forbidden calls onTeamForbidden AND still throws ApiError to caller.
// 3. A mock fetch returning 403 with a different code does NOT call onTeamForbidden.
// 4. A mock fetch returning 404 team.notFound still takes the 404 path.
// 5. Lifecycle handler throttled refetch and decommission path when removed.

import {
  ApiError,
  setApiRuntime,
  setFetchForTests,
  setOnTeamForbidden,
  setOnTeamNotFound,
  shouldTriggerRoleRefetch,
  FORBIDDEN_REFETCH_COOLDOWN_MS,
  teamsApi,
} from '../src/lib/api';
import {
  setTeamForbiddenHandler,
  resetForbiddenRefetchThrottle,
} from '../src/lib/team-lifecycle';
import { useTeams } from '../src/state/teams';
import { useTeamsView } from '../src/state/teams-view';
import type { QueryClient } from '@tanstack/react-query';
import type { TeamListResponse } from '@rowta/shared';

process.env.EXPO_PUBLIC_API_URL = 'http://api.test';

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}

function mockResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function run(): Promise<void> {
  // Test runtime setup (Rule S5, A11): authenticate calls so send() reaches fetchImpl
  setApiRuntime({ getAccessToken: async () => 'test-bearer-token' });

  console.log('--- 1. Pure throttle helper tests ---');
  {
    // First call (last = 0, now = 1000): allowed
    const first = shouldTriggerRoleRefetch(0, 1000);
    check(first === true, 'first call (last=0, now=1000) allowed');

    // Call at +1s (last = 1000, now = 2000): rejected
    const plus1s = shouldTriggerRoleRefetch(1000, 2000);
    check(plus1s === false, 'call at +1s (last=1000, now=2000) rejected');

    // Call at +5.1s (last = 1000, now = 6100): allowed
    const plus51s = shouldTriggerRoleRefetch(1000, 6100);
    check(plus51s === true, 'call at +5.1s (last=1000, now=6100) allowed');

    // Boundary check at exactly cooldown (5000ms): allowed
    const exact = shouldTriggerRoleRefetch(1000, 6000, FORBIDDEN_REFETCH_COOLDOWN_MS);
    check(exact === true, 'call at exactly +5000ms boundary allowed');

    // Call at +4999ms: rejected
    const beforeBoundary = shouldTriggerRoleRefetch(1000, 5999, FORBIDDEN_REFETCH_COOLDOWN_MS);
    check(beforeBoundary === false, 'call at +4999ms rejected');
  }

  console.log('--- 2. Mock fetch 403 team.forbidden hook & ApiError propagation ---');
  {
    const forbiddenCalls: (string | null)[] = [];
    setOnTeamForbidden((teamId) => {
      forbiddenCalls.push(teamId);
    });

    setFetchForTests(async () => {
      return mockResponse(403, {
        error: {
          code: 'team.forbidden',
          message: 'You do not have permission to perform this action.',
          requestId: 'req-forbidden-1',
        },
      });
    });

    let caughtError: ApiError | null = null;
    try {
      await teamsApi.updateTeamSettings('11111111-1111-1111-1111-111111111111', {
        managers_can_revoke_invites: true,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        caughtError = err;
      }
    }

    check(caughtError !== null, '403 team.forbidden throws ApiError to caller (error NOT swallowed)');
    console.log(`  [section 2 caught error] status: ${caughtError?.status}, code: ${caughtError?.code}`);
    check(caughtError?.status === 403, 'thrown error status is 403');
    check(caughtError?.code === 'team.forbidden', "thrown error code is 'team.forbidden'");
    check(forbiddenCalls.length === 1, 'onTeamForbidden hook was called once');
    check(
      forbiddenCalls[0] === '11111111-1111-1111-1111-111111111111',
      'onTeamForbidden received the extracted teamId',
    );
  }

  console.log('--- 3. Mock fetch 403 with different code does NOT call onTeamForbidden ---');
  {
    const forbiddenCalls: (string | null)[] = [];
    setOnTeamForbidden((teamId) => {
      forbiddenCalls.push(teamId);
    });

    setFetchForTests(async () => {
      return mockResponse(403, {
        error: {
          code: 'generic.error',
          message: 'Not allowed',
          requestId: 'req-forbidden-2',
        },
      });
    });

    let caughtError: ApiError | null = null;
    try {
      await teamsApi.getTeam('11111111-1111-1111-1111-111111111111');
    } catch (err) {
      if (err instanceof ApiError) {
        caughtError = err;
      }
    }

    check(caughtError !== null, 'non-team.forbidden 403 throws ApiError to caller');
    console.log(`  [section 3 caught error] status: ${caughtError?.status}, code: ${caughtError?.code}`);
    check(caughtError?.status === 403, 'thrown error status is 403');
    check(caughtError?.code === 'generic.error', "thrown error code is 'generic.error'");
    check(forbiddenCalls.length === 0, 'onTeamForbidden was NOT called for non-team.forbidden code');
  }

  console.log('--- 4. Mock fetch 404 team.notFound still takes 404 path ---');
  {
    const notFoundCalls: (string | null)[] = [];
    const forbiddenCalls: (string | null)[] = [];
    setOnTeamNotFound((teamId) => {
      notFoundCalls.push(teamId);
    });
    setOnTeamForbidden((teamId) => {
      forbiddenCalls.push(teamId);
    });

    setFetchForTests(async () => {
      return mockResponse(404, {
        error: {
          code: 'team.notFound',
          message: 'Team not found',
          requestId: 'req-notfound-1',
        },
      });
    });

    let caughtError: ApiError | null = null;
    try {
      await teamsApi.getTeam('22222222-2222-2222-2222-222222222222');
    } catch (err) {
      if (err instanceof ApiError) {
        caughtError = err;
      }
    }

    check(caughtError !== null, '404 team.notFound throws ApiError to caller');
    console.log(`  [section 4 caught error] status: ${caughtError?.status}, code: ${caughtError?.code}`);
    check(caughtError?.status === 404, 'thrown error status is 404');
    check(caughtError?.code === 'team.notFound', "thrown error code is 'team.notFound'");
    check(notFoundCalls.length === 1, 'onTeamNotFound was called');
    check(notFoundCalls[0] === '22222222-2222-2222-2222-222222222222', 'onTeamNotFound received teamId');
    check(forbiddenCalls.length === 0, 'onTeamForbidden was NOT called for 404');
  }

  console.log('--- 5. Lifecycle handler integration & throttling ---');
  {
    resetForbiddenRefetchThrottle();

    const cache = new Map<string, unknown>();
    const fetchQueries: unknown[] = [];
    const invalidatedQueries: unknown[] = [];
    const setQueryDataCalls: { key: unknown; data: unknown }[] = [];
    const removedQueries: unknown[] = [];

    const mockQueryClient = {
      async fetchQuery(options: { queryKey: unknown; queryFn: () => Promise<unknown> }) {
        fetchQueries.push(options.queryKey);
        const data = {
          teams: [
            {
              id: 'team-active-1',
              name: 'Alpha',
              role: 'manager', // demoted from owner
              managersCanRevokeInvites: false,
            },
          ],
        } as TeamListResponse;
        cache.set(JSON.stringify(options.queryKey), data);
        return data;
      },
      async invalidateQueries(options: { queryKey: unknown }) {
        invalidatedQueries.push(options.queryKey);
      },
      setQueryData(queryKey: unknown, updater: unknown) {
        const keyStr = JSON.stringify(queryKey);
        const old = cache.get(keyStr);
        const updated = typeof updater === 'function' ? (updater as (old: unknown) => unknown)(old) : updater;
        cache.set(keyStr, updated);
        setQueryDataCalls.push({ key: queryKey, data: updated });
      },
      removeQueries(options: { queryKey: unknown }) {
        removedQueries.push(options.queryKey);
        cache.delete(JSON.stringify(options.queryKey));
      },
    } as unknown as QueryClient;

    setTeamForbiddenHandler(mockQueryClient);

    // Initial selected team in state
    useTeams.getState().selectTeam('team-active-1');

    // Trigger 1: 403 on team-active-1
    setFetchForTests(async () => {
      return mockResponse(403, {
        error: { code: 'team.forbidden', message: 'Forbidden', requestId: 'req-throttled-1' },
      });
    });

    try {
      await teamsApi.updateTeamSettings('team-active-1', { managers_can_revoke_invites: true });
    } catch {}

    // Wait microtask tick for async onTeamForbidden
    await new Promise((r) => setTimeout(r, 20));

    check(fetchQueries.length === 1, 'first 403 triggered fetchQuery for teams list');
    check(
      invalidatedQueries.some((k) => Array.isArray(k) && k[0] === 'teams' && k[1] === 'detail'),
      'invalidated detail query for active team',
    );

    // Trigger 2 immediately (within 5s cooldown)
    try {
      await teamsApi.updateTeamSettings('team-active-1', { managers_can_revoke_invites: true });
    } catch {}

    await new Promise((r) => setTimeout(r, 20));
    check(fetchQueries.length === 1, 'second 403 within 5s was throttled (no new fetchQuery)');

    // Reset throttle and simulate user removal
    resetForbiddenRefetchThrottle();

    const mockQueryClientRemoved = {
      async fetchQuery(options: { queryKey: unknown }) {
        fetchQueries.push(options.queryKey);
        return {
          teams: [], // user removed from team-active-1
        } as TeamListResponse;
      },
      async invalidateQueries(options: { queryKey: unknown }) {
        invalidatedQueries.push(options.queryKey);
      },
      setQueryData(queryKey: unknown, updater: unknown) {
        const keyStr = JSON.stringify(queryKey);
        const old = cache.get(keyStr);
        const updated = typeof updater === 'function' ? (updater as (old: unknown) => unknown)(old) : updater;
        cache.set(keyStr, updated);
        setQueryDataCalls.push({ key: queryKey, data: updated });
      },
      removeQueries(options: { queryKey: unknown }) {
        removedQueries.push(options.queryKey);
        cache.delete(JSON.stringify(options.queryKey));
      },
    } as unknown as QueryClient;

    setTeamForbiddenHandler(mockQueryClientRemoved);

    try {
      await teamsApi.updateTeamSettings('team-active-1', { managers_can_revoke_invites: true });
    } catch {}

    await new Promise((r) => setTimeout(r, 20));

    check(useTeams.getState().selectedTeamId === null, 'removed user has selectedTeam cleared');
    check(useTeamsView.getState().view === 'list', 'removed user is navigated to team list');
    check(
      setQueryDataCalls.some((c) => Array.isArray(c.key) && c.key[0] === 'teams' && c.key[1] === 'list'),
      'setQueryData called to filter decommissioned team from cache',
    );
    check(
      removedQueries.some((k) => Array.isArray(k) && k[0] === 'teams' && k[1] === 'detail'),
      'removeQueries called on detail query for decommissioned team',
    );
  }

  // Restore fetch and runtime seams
  setFetchForTests(null);
  setApiRuntime({ getAccessToken: async () => null });

  if (failures > 0) {
    console.error(`Total failures: ${failures}`);
    process.exit(1);
  }
  console.log('All forbidden refetch tests passed cleanly.');
}

void run();
