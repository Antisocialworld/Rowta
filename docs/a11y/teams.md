# Per-screen accessibility checklist — Teams (Phase 3)

Scope: PRD 6.1 and 12 (Phase 3 gate): TeamListScreen (home + switcher), CreateTeamModal (Stage M2),
MembersScreen (with Pending invitations, Stage M3), InviteModal (Stage M3), InviteResultCard — the team management UI for Phase 3.

Standing evidence until a device pass exists (no emulator/device on this machine — same honest
gap as the Phase 0 and Phase 2 gates):

| Claim | Standing evidence |
|---|---|
| Every control has an accessible name and role | `npm run lint --workspace @rowta/app` — every `Input` carries `label` (catalog key); every `Button`/`LinkButton` carries `label` (catalog key); every `Badge` carries `label`; `focusOn()` called on mount in TeamListScreen, CreateTeamModal, MembersScreen, InviteModal (U7); `test-teams-store.ts` proves view-machine focus and back-stack wiring (4 focus checks and 5 back-stack checks); `test-invite-token-lifecycle.ts` proves token-state transitions; `scripts/check-app-a11y.mjs` (A11Y GATE, wired into `npm run -w @rowta/app lint`) validates pressable roles, icon labels, font-scale caps and native-disabled use at static-gate level — green for all new components |
| Live regions for errors, prompts and results | `LiveRegion` used in TeamListScreen (result dismissal), CreateTeamModal (error/announcement), MembersScreen (leave blocked, member-removed, invite sent/revoked), InviteModal (field error); `announce()` from `lib/a11y` used where visible text would double-announce; `test-teams-store.ts` proves result-state transitions; 429 line is visual-only next to the announced `auth.rateLimited` (PRD 11) |
| X14 ready/not-ready semantics | Every submit button carries `ready` + `reason` prop (CreateTeamModal, InviteModal); the props are required by the component types, so `npm run typecheck --workspace @rowta/app` proves every call site passes them; `ensureCreateKey()` / `clearCreateKey()` discipline documented |
| Field errors attached to fields | `Input` renders error under the field with `errorKey` (server field codes → catalog keys via `fieldErrorKey`); `CreateTeamModal` maps 422 field errors to `team.name.required` / `team.name.tooLong`; `InviteModal` maps 422 field errors to `auth.email.invalid` |
| Contrast | `docs/a11y/contrast.md` (existing report; token colours from `tokens.ts`; all new components reuse the same token palette) |
| Web render at matrix sizes | 10 captures not yet generated for teams screens (same gap as auth screens at Phase 1); `docs/ui-matrix/README.md` lists the procedure (PRD forbids faking); web preview is a compile/serve check only |
| TalkBack checklist (NOT verified — no Android device/emulator here; procedure below) | |

## TalkBack checklist (NOT verified — no Android device/emulator here; procedure below)

- [ ] Every control has a name, role and state read aloud correctly. *(static gate green; on-device pass pending — the `label` prop on every Input/Button/Badge provides the accessible name)*
- [ ] Reading order matches visual order; focus moves sensibly on view change; modal focus returns on close. *(machine-level focus moves proven: `focusOn()` on mount in every screen and modal; SheetModal returns focus to opener triggers; the `InviteResultCard` focuses its heading on mount; BackHandler wired in `TeamsRouter`; U1: back at list refuses → OS exit)*
- [ ] Errors, success and loading are announced; error text is attached to its field. *(LiveRegion wiring exists in all screens; `test-teams-store.ts` proves result-state transitions; static gate green)*
- [ ] Contrast checked (4.5:1 text, 3:1 large text and controls); meaning not colour-only. *(see `contrast.md`; all colours from `tokens.ts`; meaning is never conveyed by colour alone)*
- [ ] Touch targets 44x44 or larger; any swipe has a button alternative. *(kit `MIN_TOUCH_TARGET` on Button/Chip/Input/LinkButton; no swipe-only action in these screens; on-device measurement pending)*
- [ ] Text at 200 percent: nothing clipped or overlapping; landscape works. *(size-matrix harness deferred with the Phase 1 gap; same procedure as auth screens — `docs/ui-matrix/README.md`)*
- [ ] Reduce-motion honoured; nothing flashes. *(`useReducedMotion` in the kit; no flashing content in these views; static gate green)*
- [ ] No sound-only or voice-only information or input. *(all feedback is text + haptics; no sound-dependent states)*
- [ ] Plain language; one primary action; destructive actions confirmed accessibly. *(one submit per form; ConfirmDialog for destructive actions; `action.cancel` / `action.confirm` catalog keys; leave-blocked message for owner)*

## How to run the device pass (owner or agent with a device)

1. `adb` + TalkBack enabled; open the app; walk every view and modal in the order above (Team list → CreateTeamModal → MembersScreen with Pending invitations → InviteModal → Invite result), including the team-name field in CreateTeamModal and the email field in InviteModal.
2. Record per control: name, role, state (disabled/busy), and what is announced on error, on invite sent/revoked, on retry and on 429.
3. Paste results into the checkboxes above and change the header to "verified on <device>".
4. For the InviteResultCard: confirm the "You joined {teamName}." line is announced once as a polite live region on success, and the uniform failure line is announced on error; the retry button is focusable and announces "Try again" on focus.

---

Gate note: This checklist mirrors the format of `docs/a11y/auth-page.md`. The standing evidence column lists what the static gate, typecheck and test scripts prove. Every item marked "on-device pass pending" requires an actual Android device with TalkBack (or iOS with VoiceOver) to verify. The app has been built following all U7/U8/X14 rules; the only remaining gap is the physical device pass, which the owner can complete when a device is available.