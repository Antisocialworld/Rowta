// DEEP-LINK ENTRY PROOF (Phase 1 rework item 6, Phase 2: real entries): the password-reset link, the
// invite link and the sign-in (magic) link token must each open the ONE AuthPage in the right state,
// and hardware Back must behave. lib/deep-links.ts parses the four URL shapes into the {kind, token}
// the App.tsx Linking listener stores; this exercises the machine's `enter` with AUTH_ENTRY that the
// listener calls. Run from the repo root:
//   npm exec --workspace @rowta/app -- tsx scripts/test-auth-entry-paths.ts
import { AUTH_ENTRY, authReducer, initialAuthState, type AuthMachineState } from '../src/state/auth-view';

let failures = 0;
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

function enter(entryKey: keyof typeof AUTH_ENTRY): AuthMachineState {
  const entry = AUTH_ENTRY[entryKey];
  return authReducer(initialAuthState, { type: 'enter', view: entry.view, base: entry.base });
}

// 1. password-reset link -> reset password state, history starts at signIn
let state = enter('resetLink');
check(state.view === 'resetPassword', 'password-reset link opens the reset password state');
check(state.stack.length === 1 && state.stack[0] === 'signIn', 'reset link history starts at signIn');
state = authReducer(state, { type: 'back' });
check(state.view === 'signIn', 'hardware Back after the reset link returns to signIn');

// 2. invite link -> accept-invite state (its links lead to create-account / sign-in), Back -> signIn
state = enter('invite');
check(state.view === 'acceptInvite', 'invite link opens the accept-invite state (Phase 2 entry)');
check(state.stack.length === 1 && state.stack[0] === 'signIn', 'accept-invite history starts at signIn');
state = authReducer(state, { type: 'back' });
check(state.view === 'signIn' && state.stack.length === 0, 'hardware Back after the invite link returns to signIn (item 7)');
// from accept-invite, the create-account text link is a plain switch (form-to-form, no stack entry)
state = authReducer(state, { type: 'switch', view: 'createAccount' });
check(state.view === 'createAccount' && state.stack.length === 0, "accept-invite's create-account link lands on the form");

// 3. sign-in (magic) link token -> email-link confirm: ONE button, root-like history
state = enter('magicToken');
check(state.view === 'magicConfirm', 'email-link token opens the email-link confirm state');
check(state.stack.length === 0, 'email-link confirm has root-like history (no chrome back; PRD 8.1 one button)');
const refused = authReducer(state, { type: 'back' });
check(refused === state, 'hardware Back on email-link confirm refuses (the OS exits, as before)');

// entry is independent of any prior form state (a link can arrive from anywhere)
state = authReducer(authReducer(initialAuthState, { type: 'switch', view: 'createAccount' }), {
  type: 'enter',
  view: AUTH_ENTRY.resetLink.view,
  base: AUTH_ENTRY.resetLink.base,
});
check(state.view === 'resetPassword' && state.stack.length === 1, 'an entry replaces whatever form was showing');

process.exit(failures === 0 ? 0 : 1);
