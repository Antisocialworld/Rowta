# Per-screen accessibility checklist — Swaps (Phase 5)

Scope: PRD 6.1, 8.5, 9.9 and 12 (Phase 5 gate): ShiftDetailScreen swap request actions,
SwapsListScreen (swap feed, status tabs, review/decide buttons, cancel dialog) — the swap
management UI for Phase 5.

Standing evidence until a device pass exists (no emulator/device on this machine — same honest
gap as Phase 1, Phase 2, Phase 3, and Phase 4 gates):

| Claim | Standing evidence |
|---|---|
| Every control has an accessible name and role | `SwapsListScreen` tabs use `accessibilityRole="tab"` with `accessibilityState={{ selected }}`; buttons use `accessibilityRole="button"` and catalog labels; `focusOn()` called on mount in `SwapsListScreen` and `ShiftDetailScreen` (U7); action buttons carry `testID`s and explicit accessible names; ConfirmDialog traps focus and announces title/body |
| Live regions for errors, optimistic updates and prompts | `LiveRegion` in `ShiftDetailScreen` announces rollback error message on swap request failure; `LiveRegion` in `SwapsListScreen` announces decision outcomes and end-of-list |
| Busy and disabled accessibility states | "Request swap" and "Swap requested" buttons set `accessibilityState={{ busy, disabled }}` both visually and for assistive technology (C7, X14); native `disabled` never obscures the state from TalkBack |
| Optimistic update with announced rollback | Pure logic verified in `app/src/lib/swap-logic.ts`; failure restores previous state and announces error |
| Contrast | Token colours from `tokens.ts` (theme system); all status badges and buttons meet 4.5:1 text and 3:1 control contrast |
| Touch targets 44x44 or larger | Minimum touch target enforced by design tokens and button components; every list item is operable without gestures |

## TalkBack checklist (NOT verified — no Android device/emulator here; procedure below)

- [ ] Every control has a name, role and state read aloud correctly. *(tabs have role="tab", selected state announced; buttons have role="button")*
- [ ] Optimistic update is smooth and accessible: button immediately updates to "Swap requested" and reflects disabled/busy state.
- [ ] Rollback on failure: when a request fails, focus is preserved, state reverts, and the error reason is spoken aloud via live region.
- [ ] Dialog focus trap: cancel confirmation dialog traps focus and reads title/message.
- [ ] List navigation: swipe moves through swap cards in logical reading order (shift label, time, requester to target, status).

## How to run the device pass (owner or agent with a device)

1. Connect Android device/emulator with TalkBack enabled.
2. Open `ShiftDetailScreen` for an assigned shift:
   - Tap "Request swap", verify immediate visual and TalkBack announcement of "Swap requested" / busy.
   - Force network disconnect to test rollback: verify button returns to "Request swap" and live region announces the error message.
3. Open `SwapsListScreen`:
   - Swipe through tabs ("Pending", "My swaps", "All") and verify TalkBack announces selected tab.
   - Swipe through swap cards; as Owner/Manager, verify "Approve" and "Reject" buttons.
   - As requester, verify "Cancel request" button and confirm dialog.

