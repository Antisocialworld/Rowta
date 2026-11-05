# Per-screen accessibility checklist — Shifts, Calendar, Activity, Search (Phase 4)

Scope: PRD 6.1, 8.3, 8.4 and 12 (Phase 4 gate): CalendarScreen, ShiftDetailScreen,
ShiftCreateEditScreen (create/edit shift form), ActivityScreen, ActivityRow, SearchModal (top-anchored search modal sheet, Stage M4a) —
the shift management and activity UI for Phase 4.

Standing evidence until a device pass exists (no emulator/device on this machine — same honest
gap as Phase 1, Phase 2, and Phase 3 gates):

| Claim | Standing evidence |
|---|---|
| Every control has an accessible name and role | `npm run lint --workspace @rowta/app` — every `Input` carries `label` (catalog key); every `Button` carries `label` (catalog key); every `Card` / `ShiftCard` has accessible attributes; `focusOn()` called on mount in CalendarScreen, ShiftDetailScreen, ShiftCreateEditScreen, ActivityScreen, SearchModal (U7); `ActivityRow` has an explicit compound `accessibilityLabel` (`actor + kind, label, when`) read as a single swipe (X1, X5); `ShiftCreateEditScreen` member picker uses `accessibilityRole="button"` and `accessibilityLabel={displayName}`; `scripts/check-app-a11y.mjs` (A11Y GATE, wired into `npm run -w @rowta/app lint`) green for all Phase 4 components |
| Live regions for errors, prompts and results | `LiveRegion` used in ShiftDetailScreen (delete feedback), ShiftCreateEditScreen (error/announcement), ActivityScreen (end-of-list reached announcement), SearchModal (search result live region); `announce()` from `lib/a11y` used where needed; 429 Retry-After is visual-only next to the announced `auth.rateLimited` (PRD 11) |
| X14 ready/not-ready semantics | Shift create/edit submit button carries `ready` + `reason` props (`auth.field.required` / format reasons); onNotReady moves focus to the first invalid field (startsAt/endsAt/label/assignee); native `disabled` attribute is NEVER used (X14a); button stays focusable in TalkBack |
| Field errors attached to fields | `Input` renders errors under the field with `errorKey` (server field codes → catalog keys via `fieldErrorKey`); `ShiftCreateEditScreen` attaches errors to `shiftLabel`, `shiftAssignee`, `shiftStartsAt`, `shiftEndsAt` |
| Contrast | `docs/a11y/contrast.md` (token colours from `tokens.ts`; all Phase 4 screens use the token palette, no hard-coded colours); shift cards clear 4.5:1 text and 3:1 control boundary |
| Web render at matrix sizes | Web preview serves all four screens; simulated fast-scroll request log in `docs/gates/evidence-phase-4-app.txt` |
| TalkBack checklist (NOT verified — no Android device/emulator here; procedure below) | |

## TalkBack checklist (NOT verified — no Android device/emulator here; procedure below)

- [ ] Every control has a name, role and state read aloud correctly. *(static gate green; on-device pass pending — `label` on every Input/Button/ShiftCard provides accessible name; member picker Pressables have role="button")*
- [ ] Reading order matches visual order; focus moves sensibly on view change; dialog focus trapped and returns on close. *(machine-level focus moves proven: `focusOn()` on mount in every screen; `ConfirmDialog` in ShiftDetailScreen traps focus and announces title/message; BackHandler pops routes via `shiftNavReducer`)*
- [ ] Errors, success and loading are announced; error text is attached to its field. *(LiveRegion wiring exists in all screens; Skeleton components announce nothing so loading is quiet; field errors linked via accessibilityHint)*
- [ ] Contrast checked (4.5:1 text, 3:1 large text and controls); meaning not colour-only. *(see `contrast.md`; tokens-only palette; status tones use badges with text label)*
- [ ] Touch targets 44x44 or larger; any swipe has a button alternative. *(kit `MIN_TOUCH_TARGET` on Button/Input/Pressables; ActivityScreen infinite scroll has an explicit "Load more" button alternative for non-scroll access)*
- [ ] Text at 200 percent: nothing clipped or overlapping; landscape works. *(tested via ScrollView with responsive layout tokens)*
- [ ] Reduce-motion honoured; nothing flashes. *(`useReducedMotion` in the kit; Skeleton static under reduce-motion; static gate green)*
- [ ] No sound-only or voice-only information or input. *(all feedback is text + haptics; no audio cues)*
- [ ] Plain language; one primary action; destructive actions confirmed accessibly. *(Shift delete uses `ConfirmDialog` with destructive styling, `shift.delete.title` and `shift.delete.message`)*

## How to run the device pass (owner or agent with a device)

1. Connect Android device/emulator via `adb` with TalkBack enabled.
2. Walk through the Phase 4 screens in order:
   - CalendarScreen: verify title announced, swipe through ShiftCards (day, time, role, member read together).
   - ShiftDetailScreen: verify shift details, verify Edit / Delete buttons (Manager/Owner only), trigger Delete to verify ConfirmDialog.
   - ShiftCreateEditScreen: verify form inputs (label, member selection, starts-at, ends-at, notes); test not-ready submit button announcement.
   - ActivityScreen: swipe through ActivityRows (single accessible node per event); test "Load more" button and "end of list" announcement.
   - SearchModal: open from Calendar, Members or team card; type query, verify section headers ("People", "Shifts", "Activity") and card results; close returns focus to opening trigger.
3. Record name, role, state for each control, and replace "[ ]" with "[x]" once verified on physical device.

---

Gate note: This checklist mirrors `docs/a11y/teams.md` and `docs/a11y/auth-page.md`. Standing evidence is provided by static gates, typecheck, and unit/logic tests. On-device TalkBack pass remains an owner step (marked NOT PROVEN in the gate file).

