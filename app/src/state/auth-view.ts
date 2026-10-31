// THE AUTH PAGE MACHINE — one page, conditional rendering (rules U1, U4, U7; PRD 6.1 and 8.1; Phase 1 rework).
//
// Three FORM states share one card with conditional rendering — signIn | createAccount | forgotPassword — and
// seven further states (code entry, reset steps, magic link, invite) render in the same card of the same page.
// There are NO route files per auth view (U1).
//
// Actions (pure — app/scripts/test-auth-machine.ts and test-auth-entry-paths.ts prove them with no device):
//   switch  form -> form: changes the view and CLEARS history (forms are the page's tabs, not a stack).
//   go      step  -> next: pushes the current view so hardware Back can return exactly where it came from.
//   back    createAccount/forgotPassword (and signIn itself) -> signIn (item 7); other views pop one entry;
//           at an empty stack the machine REFUSES and lets the OS exit the app (U1) — signIn behaves as before.
//   enter   deep-link entry: lands on a state with a defined history base (see AUTH_ENTRY below).
//
// A uniform PRD-11 message (auth.signUp.submitted, auth.forgot.submitted, auth.reset.done, ...) travels with the
// view that should show it and is cleared on navigation; AuthPage renders it in a polite LiveRegion.
import { create } from 'zustand';
import type { MessageKey } from '../i18n/en';

export type AuthView =
  | 'signIn'
  | 'createAccount'
  | 'verifyCode'
  | 'forgotPassword'
  | 'resetCode'
  | 'resetPassword'
  | 'magicRequest'
  | 'magicConfirm'
  | 'acceptInvite';

export const FORM_VIEWS = ['signIn', 'createAccount', 'forgotPassword'] as const;
export type FormView = (typeof FORM_VIEWS)[number];

export function isFormView(view: AuthView): view is FormView {
  return (FORM_VIEWS as readonly AuthView[]).includes(view);
}

/** Per-view chrome and focus (PRD 6.1: "title, heading, first-input focus"; U7). One source of truth (U8).
 *  Titles stay in the catalog (the sign-in form's secondary links use them as labels); the page renders the
 *  heading under the logo — the old chrome title text was replaced by the logo. */
export const AUTH_VIEWS = {
  signIn: { title: 'auth.view.signIn.title', heading: 'auth.view.signIn.heading', focus: 'input' },
  createAccount: { title: 'auth.view.signUp.title', heading: 'auth.view.signUp.heading', focus: 'input' },
  verifyCode: { title: 'auth.view.verifyCode.title', heading: 'auth.view.verifyCode.heading', focus: 'input' },
  forgotPassword: { title: 'auth.view.forgot.title', heading: 'auth.view.forgot.heading', focus: 'input' },
  resetCode: { title: 'auth.view.resetCode.title', heading: 'auth.view.resetCode.heading', focus: 'input' },
  resetPassword: {
    title: 'auth.view.resetNewPassword.title',
    heading: 'auth.view.resetNewPassword.heading',
    focus: 'input',
  },
  magicRequest: { title: 'auth.view.magicRequest.title', heading: 'auth.view.magicRequest.heading', focus: 'input' },
  // PRD 8.1: magicConfirm has ONE button and no field; its heading is the fixed "Sign in to Rowta" line.
  magicConfirm: { title: 'auth.view.signIn.title', heading: 'auth.magic.confirm', focus: 'heading' },
  acceptInvite: { title: 'auth.view.acceptInvite.title', heading: 'auth.view.acceptInvite.heading', focus: 'heading' },
} as const satisfies Record<AuthView, { title: MessageKey; heading: MessageKey; focus: 'input' | 'heading' }>;

/** Deep-link entry points (PRD verified links; lib/deep-links.ts parses a URL into one of these and
 *  the App.tsx Linking listener calls store.enter()). Proven by app/scripts/test-auth-entry-paths.ts. */
export const AUTH_ENTRY = {
  /** Password-reset link from email -> reset password state, history starts at signIn. */
  resetLink: { view: 'resetPassword', base: 'signIn' },
  /** Team invite link -> the accept-invite state (its text links lead to create-account / sign-in;
   *  Phase 3 attaches the stored invite token to the create-account request). */
  invite: { view: 'acceptInvite', base: 'signIn' },
  /** Sign-in (magic) link token -> email-link confirm, one button, root-like history (no back chrome). */
  magicToken: { view: 'magicConfirm', base: 'root' },
} as const satisfies Record<string, { view: AuthView; base: 'signIn' | 'root' }>;

export type AuthMachineState = { view: AuthView; stack: readonly AuthView[]; message?: MessageKey };
export type AuthMachineAction =
  | { type: 'switch'; view: FormView; message?: MessageKey }
  | { type: 'go'; view: AuthView; message?: MessageKey }
  | { type: 'back' }
  | { type: 'enter'; view: AuthView; base: 'signIn' | 'root' };

export const initialAuthState: AuthMachineState = { view: 'signIn', stack: [] };

export function authReducer(state: AuthMachineState, action: AuthMachineAction): AuthMachineState {
  switch (action.type) {
    case 'switch':
      // form -> form (or re-switch): the three forms are one page's states, history resets (item 1, item 7).
      // `message` lets a completed flow land on signIn with its PRD-11 line (auth.reset.done).
      return { view: action.view, stack: [], message: action.message };
    case 'go':
      return { view: action.view, stack: [...state.stack, state.view], message: action.message };
    case 'enter':
      return { view: action.view, stack: action.base === 'signIn' ? ['signIn'] : [], message: undefined };
    case 'back': {
      if (isFormView(state.view)) {
        if (state.view === 'signIn') return state; // root: refuse, keep the carried message, the OS exits (U1)
        return { view: 'signIn', stack: [], message: undefined }; // createAccount / forgotPassword (item 7)
      }
      const previous = state.stack[state.stack.length - 1];
      if (previous === undefined) return state; // empty stack: refuse, the OS exits (U1)
      return { view: previous, stack: state.stack.slice(0, -1), message: undefined };
    }
  }
}

export type AuthViewStore = AuthMachineState & {
  switchTo: (view: FormView, message?: MessageKey) => void;
  go: (view: AuthView, message?: MessageKey) => void;
  enter: (entry: { view: AuthView; base: 'signIn' | 'root' }) => void;
  /** Pops/returns as described above. Returns false when nothing moved (caller lets Android exit). */
  back: () => boolean;
};

function moved(before: AuthMachineState, after: AuthMachineState): boolean {
  return after.view !== before.view || after.stack.length !== before.stack.length || after.message !== before.message;
}

export const useAuthViewStore = create<AuthViewStore>((set, get) => ({
  ...initialAuthState,
  switchTo: (view, message) => {
    set((state) => authReducer(state, { type: 'switch', view, message }));
  },
  go: (view, message) => {
    set((state) => authReducer(state, { type: 'go', view, message }));
  },
  enter: (entry) => {
    set((state) => authReducer(state, { type: 'enter', view: entry.view, base: entry.base }));
  },
  back: () => {
    const before = get();
    const after = authReducer(before, { type: 'back' });
    if (!moved(before, after)) return false;
    set(after);
    return true;
  },
}));
