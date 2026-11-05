// FLOW CONTEXT for the auth steps (rules A5, A9, V1): the code/reset/magic screens are conditional
// VIEWS of one page, so data that crosses a view boundary (the email the code was sent to, the
// server's remaining-SECONDS timers, the reset grant, an invite token from a deep link) lives here
// instead of in a form that unmounts. Pure zustand — testable with no device.
//
// A9: timers are the server's remaining seconds (meta), never a clock time computed on the phone.
// A13/A2x: the grant and the invite token are secrets — they live only in this in-memory store,
// never in a URL, never logged, never persisted (S1, S9).
import { create } from 'zustand';
import type { CodeTimerMeta, GrantTimerMeta } from '@rowta/shared';

export type AuthFlowState = {
  /** The account/email the current code flow speaks about (sign-up, forgot, magic). */
  email: string;
  /** Server timers for the current code screen (verify / resend): remaining SECONDS, A9. */
  codeMeta: CodeTimerMeta | null;
  /** Remaining seconds on the reset grant once a reset code is verified, A10. */
  grantMeta: GrantTimerMeta | null;
  /** The 10-minute reset grant (A10) — memory only. */
  grant: string | null;
  /** Token from the magic sign-in link's URL FRAGMENT (server: /magic#token, A13) — memory only. */
  magicToken: string | null;
  /** Token from an invite deep link; Phase 3 consumes it (presence checked only). */
  inviteToken: string | null;
  setFlow: (
    patch: Partial<Pick<AuthFlowState, 'email' | 'codeMeta' | 'grantMeta' | 'grant' | 'magicToken' | 'inviteToken'>>,
  ) => void;
  clearCodeFlow: () => void;
};

export const useAuthFlow = create<AuthFlowState>((set) => ({
  email: '',
  codeMeta: null,
  grantMeta: null,
  grant: null,
  magicToken: null,
  inviteToken: null,
  setFlow: (patch) => set(patch),
  clearCodeFlow: () => set({ email: '', codeMeta: null, grantMeta: null, grant: null, magicToken: null }),
}));
