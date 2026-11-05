# Per-screen accessibility checklist — AuthPage (the one auth page, every view)

Scope: PRD 6.1 and 12 (Phase 2 gate: "TalkBack walkthrough checklist for the auth views"): the
sign-in, create-account, verify-code, forgot-password, reset-code, reset-new-password,
magic-request, magic-confirm, magic-sent and accept-invite views — all states of ONE AuthPage
card. Filled per the skill `rowta-accessibility-checklist` template.

**Standing evidence until a device pass exists (no emulator/device on this machine — same honest
gap as the Phase 1 gate):**

| Claim | Standing evidence |
|---|---|
| Every control has an accessible name and role | `scripts/check-app-a11y.mjs` (A11Y GATE, wired into `npm run -w @rowta/app lint`) — every Pressable/TextInput carries an accessibility label; `test-auth-entry-paths.ts` 11/11 and `test-auth-machine.ts` 20/20 prove focus/entry wiring at machine level |
| Live regions for errors, prompts and resend choreography | `CodeStep.tsx` polite LiveRegions (`auth.code.resendWait` → `auth.code.resendReady`, swap announced once); form errors via `LiveRegion`; 429 line is visual-only next to the announced `auth.rateLimited` (PRD 11) |
| X14 ready/not-ready semantics | every submit button carries `ready` + `reason` (e.g. `auth.ready.signUp`, `auth.ready.code`); asserted by the UI-token/string/a11y static gates and visible in the web captures |
| Field errors attached to fields | `Input` renders the error under the field with `errorKey` (server field codes → catalog keys via `fieldErrorKey`) |
| Contrast | `docs/a11y/contrast.md` (existing report; the one open tertiary-container finding is owner-frozen) |
| Web render at both matrix sizes | 10 captures `docs/ui-matrix/auth-*-web-render-not-android-p2.png` (5 states × 2 sizes) — **web render only, not Android** |

## TalkBack checklist (NOT verified — no Android device/emulator here; procedure below)

- [ ] Every control has a name, role and state read aloud correctly. *(static gate green; on-device pass pending)*
- [ ] Reading order matches visual order; focus moves sensibly on view change; modal focus returns on close. *(machine-level focus moves proven: `focusOn(heading/first input)` on every view switch; the country BottomSheet restores focus to the country field on close — `SignUpView.closeSheet`. TalkBack pass pending)*
- [ ] Errors, success and loading are announced; error text is attached to its field. *(LiveRegion wiring exists; TalkBack pass pending)*
- [ ] Contrast checked (4.5:1 text, 3:1 large text and controls); meaning not colour-only. *(see `contrast.md`; new views reuse the same tokens)*
- [ ] Touch targets 44x44 or larger; any swipe has a button alternative. *(MIN_TOUCH_TARGET in the kit; static gate green; device pass pending)*
- [ ] Text at 200 percent: nothing clipped or overlapping; landscape works. *(size-matrix harness deferred with the Phase 1 gap — `docs/ui-matrix/README.md`)*
- [ ] Reduce-motion honoured; nothing flashes. *(`useReducedMotion` in the kit; no flashing content in these views)*
- [ ] No sound-only or voice-only information or input. *(all feedback is text + haptics)*
- [ ] Plain language; one primary action; destructive actions confirmed accessibly. *(one submit per view; sign-out confirmation is Phase 6 scope)*

## How to run the device pass (owner or agent with a device)

1. `adb` + TalkBack enabled; open the app; walk every view in the order above (sign-in → create
   account → verify code → forgot → reset code → new password → magic request → magic confirm →
   accept invite), including the country BottomSheet (open, choose, close — focus return) and the
   password show/hide toggle.
2. Record per control: name, role, state (disabled/busy), and what is announced on error, on
   countdown-swap and on 429.
3. Paste results into the checkboxes above and change the header to "verified on <device>".
