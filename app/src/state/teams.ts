// TEAMS STATE (Phase 3; rules S5, V1, U2, A11; PRD 8.2, 6.1).
//
// Two layers, deliberately separated:
//   * useTeams — FLOW state (selected team id, the invite-accept result, the create-team idempotency
//     key). Pure zustand, no React, testable in plain Node (scripts/test-invite-token-lifecycle.ts,
//     test-teams-store.ts). The selected team id is NOT a secret (just a UUID) so it may live here in
//     memory; tokens NEVER touch this store (A11).
//   * useTeamsList / useTeam / useTeamMembers / useTeamInvites — SERVER data through TanStack Query,
//     the pattern already proven by SignUpView's country list (the server decides — S5).
//
// consumeInviteToken is the ONE invite-accept entry point (owner decisions 1-3, 26 Oct 2026):
//   * Accept is AUTOMATIC but the outcome is ALWAYS stored for a result view — never silent.
//   * The memory-only inviteToken is cleared IMMEDIATELY after any attempt that got a SERVER answer
//     (success or failure); it survives ONLY a network/timeout failure so the same attempt can be
//     retried (decision 3). A second user on the same device can therefore never inherit it.
//   * Every failure kind (invalid, used, seat cap, wrong email, 5xx) stores the SAME 'failed' result —
//     the result text never reveals which check failed (A5, A6, decision 1).
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import type { TeamRole } from '@rowta/shared';
import { ApiError, teamsApi } from '../lib/api';
import { useAuthFlow } from './auth-context';

export type InviteResult =
  | { kind: 'joined'; teamId: string; teamName: string | null }
  | { kind: 'failed' }
  | { kind: 'retry' };

export type TeamsState = {
  /** The team every scoped screen (members, invites, settings) operates on. Memory only (non-secret). */
  selectedTeamId: string | null;
  /** Outcome of the last automatic invite accept; a result view renders it, then it is dismissed. */
  inviteResult: InviteResult | null;
  /** Idempotency-Key for the in-flight create-team attempt: reused on retry, new per new attempt. */
  createIdempotencyKey: string | null;
  selectTeam: (id: string | null) => void;
  setInviteResult: (result: InviteResult | null) => void;
  /** Called whenever the team-name field changes: a changed body must never reuse a key (422). */
  clearCreateKey: () => void;
  /** Returns the current attempt's key, generating one only when there is none yet. */
  ensureCreateKey: () => string;
  /** The single invite-accept path (see the header). */
  consumeInviteToken: (token: string) => Promise<void>;
};

/** Idempotency keys are client request identifiers, NOT secrets (they ride the authenticated
 *  channel), so a Math.random fallback is acceptable where crypto.randomUUID is unavailable
 *  (Hermes). The server fingerprints the key against the body (ADR 0012). */
function newIdempotencyKey(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c !== undefined && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const useTeams = create<TeamsState>((set, get) => ({
  selectedTeamId: null,
  inviteResult: null,
  createIdempotencyKey: null,
  selectTeam: (id) => set({ selectedTeamId: id }),
  setInviteResult: (result) => set({ inviteResult: result }),
  clearCreateKey: () => set({ createIdempotencyKey: null }),
  ensureCreateKey: () => {
    const existing = get().createIdempotencyKey;
    if (existing !== null) return existing;
    const key = newIdempotencyKey();
    set({ createIdempotencyKey: key });
    return key;
  },
  consumeInviteToken: async (token: string) => {
    // Fire-and-forget from a deep link (App.tsx), so this promise MUST settle and never reject
    // (Fix Round 2, G5). finish() is the only writer and carries its own guard.
    const finish = (result: InviteResult, clearToken: boolean): void => {
      try {
        if (clearToken) useAuthFlow.getState().setFlow({ inviteToken: null });
        set({ inviteResult: result });
      } catch {
        // A store failure while recording the outcome must not escape. Try once more to record the
        // result; if even that fails there is nothing safe left to show.
        try {
          set({ inviteResult: result });
        } catch {
          // deliberately empty: a deep-link callback must never produce an unhandled rejection
        }
      }
    };

    try {
      const accepted = await teamsApi.acceptInvite({ token });
      // Server answered with success — clear the token IMMEDIATELY (decision 3). Best effort: a
      // store hiccup must not turn a real join into a failure (the result below still says joined).
      try {
        useAuthFlow.getState().setFlow({ inviteToken: null });
      } catch {
        // The token is memory-only; the success outcome is what matters.
      }
      // The success text needs the team name (decision 1); a name-fetch failure never changes the
      // outcome (they DID join), so it falls back to the generic joined line.
      let teamName: string | null = null;
      try {
        const team = await teamsApi.getTeam(accepted.teamId);
        teamName = team.name;
      } catch {
        teamName = null;
      }
      finish({ kind: 'joined', teamId: accepted.teamId, teamName }, false);
    } catch (error) {
      let disposition: 'retry' | 'failed';
      try {
        disposition = inviteFailureDisposition(error);
      } catch {
        // Even classifying an exotic thrown value must not reject the caller.
        disposition = 'failed';
      }
      finish(disposition === 'retry' ? { kind: 'retry' } : { kind: 'failed' }, disposition === 'failed');
    }
  },
}));

// ---------------------------------------------------------------------------------------------
// Pure helpers (no React, no device — proven by scripts/test-teams-store.ts and
// scripts/test-invite-token-lifecycle.ts)
// ---------------------------------------------------------------------------------------------

/** How an accept failure affects the memory token (decision 3; Fix Round 2, G4):
 *  * 'retry' KEEPS it — no server answer (network/timeout), 401 (the session layer decides),
 *    408 (server timeout), 429 (rate limit) and 5xx are transient/auth cases.
 *  * 'failed' CLEARS it — 400/403/404/410/422 and every other 4xx are the server REFUSING this
 *    invitation, so retrying the same dead token cannot help. The result text stays uniform (A5/A6).
 *  A non-ApiError (unexpected) is 'failed': clear the token and show the uniform failure. This
 *  function never throws for the values the accept path can hold, and consumeInviteToken guards
 *  even an exotic thrown value (G5). */
export function inviteFailureDisposition(error: unknown): 'retry' | 'failed' {
  if (error instanceof ApiError) {
    if (error.code === 'client.network' || error.code === 'client.timeout') return 'retry';
    if (error.status === 401 || error.status === 408 || error.status === 429) return 'retry';
    if (error.status >= 400 && error.status <= 499) return 'failed';
    if (error.status >= 500 && error.status <= 599) return 'retry';
  }
  return 'failed';
}

/** The switcher's fallback (B1): keep the preferred team while it is still in the list, else the
 *  first team, else null (the list is empty). Never invents a team (S5). */
export function resolveSelectedTeamId(
  list: readonly { id: string }[],
  preferred: string | null,
): string | null {
  if (list.length === 0) return null;
  if (preferred !== null && list.some((team) => team.id === preferred)) return preferred;
  const first = list[0];
  return first === undefined ? null : first.id;
}

/** Role visibility on the invite form (B1, PRD 8.2): the Owner invites Manager + Staff; a Manager
 *  invites Staff ONLY (the server enforces the same rule — this is the UI mirror, never the
 *  authority). The Owner role is never assignable through an invite. */
export function inviteRoleOptions(viewerRole: TeamRole): readonly TeamRole[] {
  return viewerRole === 'owner' ? (['manager', 'staff'] as const) : (['staff'] as const);
}

// ---------------------------------------------------------------------------------------------
// Server-data hooks (TanStack Query; the server decides — S5)
// ---------------------------------------------------------------------------------------------

export function useTeamsList() {
  return useQuery({ queryKey: ['teams', 'list'], queryFn: () => teamsApi.listTeams() });
}

export function useTeam(teamId: string | null) {
  return useQuery({
    queryKey: ['teams', 'detail', teamId],
    queryFn: () => teamsApi.getTeam(teamId as string),
    enabled: teamId !== null,
  });
}

export function useTeamMembers(teamId: string | null) {
  return useQuery({
    queryKey: ['teams', teamId, 'members'],
    queryFn: () => teamsApi.listMembers(teamId as string),
    enabled: teamId !== null,
  });
}

export function useTeamInvites(teamId: string | null) {
  return useQuery({
    queryKey: ['teams', teamId, 'invites'],
    queryFn: () => teamsApi.listInvites(teamId as string),
    enabled: teamId !== null,
  });
}
