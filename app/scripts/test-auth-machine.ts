// Transition proof for the auth PAGE machine (PRD 6.1 and 8.1; Phase 1 rework: one page, three forms as
// conditional states, hardware-Back rules; gate evidence docs/gates/phase-1.md).
// Runs the PURE reducer with no device, no React and no emulator. Run from the repo root:
//   npm exec --workspace @rowta/app -- tsx scripts/test-auth-machine.ts
import {
  AUTH_VIEWS,
  FORM_VIEWS,
  authReducer,
  initialAuthState,
  isFormView,
  type AuthMachineState,
  type AuthView,
} from '../src/state/auth-view';

let failures = 0;
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

const views = Object.keys(AUTH_VIEWS) as AuthView[];
check(views.length === 10, 'the machine knows all ten PRD 6.1 states');
check(FORM_VIEWS.length === 3, 'exactly three FORM states share the one card (item 1)');
check(
  views.every((view) => AUTH_VIEWS[view].title.length > 0 && AUTH_VIEWS[view].heading.length > 0),
  'every state has a title key and a heading key (PRD 6.1)',
);
check(
  views.every((view) => AUTH_VIEWS[view].focus === 'input' || AUTH_VIEWS[view].focus === 'heading'),
  'every state declares a U7 focus target (item 8)',
);
check(isFormView('signIn') && isFormView('createAccount') && isFormView('forgotPassword'), 'isFormView marks the three forms');
check(!isFormView('verifyCode') && !isFormView('magicConfirm'), 'isFormView leaves the step states out');

// item 1 + 8: switch keeps everything on one page and resets history
let state: AuthMachineState = authReducer(initialAuthState, { type: 'switch', view: 'createAccount' });
check(state.view === 'createAccount' && state.stack.length === 0, 'switch(signIn -> createAccount) lands on the form with empty history');
state = authReducer(state, { type: 'switch', view: 'forgotPassword' });
check(state.view === 'forgotPassword' && state.stack.length === 0, 'switch(createAccount -> forgotPassword) is a form-to-form switch');
state = authReducer(state, { type: 'switch', view: 'signIn' });
check(state.view === 'signIn' && state.stack.length === 0, 'switch back to signIn clears history');

// item 7: hardware Back on the forms
state = authReducer(initialAuthState, { type: 'switch', view: 'createAccount' });
state = authReducer(state, { type: 'back' });
check(state.view === 'signIn' && state.stack.length === 0, 'back() on createAccount returns to signIn (item 7)');
state = authReducer(initialAuthState, { type: 'switch', view: 'forgotPassword' });
state = authReducer(state, { type: 'back' });
check(state.view === 'signIn' && state.stack.length === 0, 'back() on forgotPassword returns to signIn (item 7)');

// signIn at the root refuses (behaves as before: the OS exits, U1) and keeps a carried message
state = authReducer(initialAuthState, { type: 'switch', view: 'signIn', message: 'auth.reset.done' });
const refused = authReducer(state, { type: 'back' });
check(refused === state, 'back() on signIn at the root refuses (Android exits the app, U1)');
check(refused.message === 'auth.reset.done', 'the refused back keeps the carried PRD-11 message');

// step flow round trips: createAccount -> verifyCode -> back -> createAccount -> back -> signIn
state = authReducer(initialAuthState, { type: 'switch', view: 'createAccount' });
state = authReducer(state, { type: 'go', view: 'verifyCode', message: 'auth.signUp.submitted' });
check(state.view === 'verifyCode' && state.stack.length === 1 && state.stack[0] === 'createAccount', 'go(verifyCode) keeps createAccount in history');
check(state.message === 'auth.signUp.submitted', 'the uniform PRD-11 message travels with the view');
state = authReducer(state, { type: 'back' });
check(state.view === 'createAccount' && state.message === undefined, 'back() from verifyCode returns to createAccount and clears the message');
state = authReducer(state, { type: 'back' });
check(state.view === 'signIn' && state.stack.length === 0, 'back() from createAccount returns to signIn');

// forgotPassword -> resetCode -> resetPassword -> back -> resetCode
state = authReducer(initialAuthState, { type: 'switch', view: 'forgotPassword' });
state = authReducer(state, { type: 'go', view: 'resetCode', message: 'auth.forgot.submitted' });
state = authReducer(state, { type: 'back' });
check(state.view === 'forgotPassword', 'back() from resetCode returns to forgotPassword');

// magic link chain: signIn link -> magicRequest -> magicSent -> back -> magicRequest
state = authReducer(initialAuthState, { type: 'go', view: 'magicRequest' });
state = authReducer(state, { type: 'go', view: 'magicSent', message: 'auth.magic.submitted' });
state = authReducer(state, { type: 'back' });
check(state.view === 'magicRequest', 'back() from magicSent returns to magicRequest (email-link flow intact, item 4)');

// reset completion lands on signIn with its message (switch carries it)
state = authReducer(initialAuthState, { type: 'switch', view: 'signIn', message: 'auth.reset.done' });
check(state.view === 'signIn' && state.message === 'auth.reset.done' && state.stack.length === 0, 'reset completion lands on signIn with auth.reset.done and empty history');

process.exit(failures === 0 ? 0 : 1);
