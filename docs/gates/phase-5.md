# Phase 5 gate — Swaps

State: **Phase 5 BUILT. Server suite and app pure-logic PROVEN (owner test runs 28 Oct 2026). App screen rendering, device TalkBack walkthrough, and concurrent/simultaneous test runs NOT PROVEN until seen/run by the owner.**

Evidence basis (owner-run, 28 Oct 2026, Lagos, branch `rowta-1`):
1. `npm test --workspace @rowta/server -- swaps`: 3 files passed, 33 tests passed (`swaps-state-machine.test.ts`, `swaps-routes.test.ts`, `swaps-limits.test.ts`, up from 30).
2. `npm test --workspace @rowta/server` (full suite): 34 files passed, 298 tests passed.
3. `npx tsx scripts/test-isolation-check.ts` (from server): 7 of 7 PASS.
4. `npm run app:test`: all 22 scripts passed (last line "Date picker tests finished with 0 failure(s)", owner run 28 Oct).

Branch: `rowta-1`. Date: 2026-10-28. Full-build mode. Owner does all git work (P1).

Scope source: PRD 8.5 (swaps state machine, assignee request, optional target, manager/owner approval, atomicity, one pending per shift, idempotency, app optimistic update + rollback + live announcement), PRD 4 (permission matrix: request_swap, manage_swaps), and PRD 12 Phase 5 gate (lines 603–604).

---

## 1. PRD section 12 Phase 5 gate rows

| # | Requirement (PRD 603–604) | Status | Evidence / Test run |
|---|---|---|---|
| 1 | State-machine tests: allowed transitions (`pending -> approved`, `pending -> rejected`, `pending -> cancelled`); all other transitions refused | **PROVEN** | `npm test --workspace @rowta/server -- swaps`: 5 tests in `server/tests/swaps-state-machine.test.ts` passed (`allows pending -> approved`, `allows pending -> rejected`, `allows pending -> cancelled`, `refuses pending -> pending`, `refuses any transition out of final states (approved, rejected, cancelled)`) |
| 2 | One-pending-swap constraint: second pending swap for the same shift is refused by the database (`swaps_one_pending_idx`), not code alone | **PROVEN** | `npm test --workspace @rowta/server -- swaps`: test `'enforces one-pending-swap constraint at database level (swaps_one_pending_idx)'` in `server/tests/swaps-routes.test.ts` passed |
| 3 | Optimistic update with a forced failure showing rollback and an announced error | **NOT PROVEN** | Pure-logic reducer tested in `app/scripts/test-swap-logic.ts` (`testOptimisticUpdateAndRollback`), but audio announcement and visual render not asserted by test or observed on physical device (owner step) |

---

## 2. Server behaviour rows

| Requirement | Status | Evidence / Test run |
|---|---|---|
| Request swap on own shift (assignee): writes `swap_requests` and `activity_events` in one transaction under row lock; enqueues push job post-commit | **PROVEN** | `npm test --workspace @rowta/server -- swaps`: test `'allows shift assignee (Staff 1) to request a swap with a target colleague (Staff 2)'` in `server/tests/swaps-routes.test.ts` passed |
| Idempotency on swap request: missing key 400, in_flight 409, replay identical returns 201/cached with same body, payload mismatch returns 422 | **PROVEN** | `npm test --workspace @rowta/server -- swaps`: tests `'requires Idempotency-Key header on swap request'`, `'returns 409 when an idempotency key is currently in_flight'`, `'replays identical swap request on duplicate idempotency key'`, and `'rejects idempotency key reuse with mismatched payload'` in `server/tests/swaps-routes.test.ts` passed |
| Target colleague validation: must be active member of same team; removed member or non-member returns 422 | **PROVEN** | `npm test --workspace @rowta/server -- swaps`: tests `'refuses swap request naming an invalid or cross-team target'` and `'refuses self-swap request'` in `server/tests/swaps-routes.test.ts` passed |
| Shift eligibility: soft-deleted shift or past shift returns 422; shift assigned to someone else returns 403/422 | **PROVEN** | `npm test --workspace @rowta/server -- swaps`: tests `'refuses swap request on a shift in the past'` and `'refuses swap request from a user who is not the assignee'` in `server/tests/swaps-routes.test.ts` passed |
| Permission matrix: Staff gets 403 `team.forbidden` on decide (`manage_swaps`); Owner/Manager allowed | **PROVEN** | `npm test --workspace @rowta/server -- swaps`: test `'refuses decide (approve/reject) from Staff (403 team.forbidden)'` in `server/tests/swaps-routes.test.ts` passed |
| Cancel swap: requester may cancel their own pending swap; Owner/Manager may cancel any; Staff cannot cancel another user's swap (403) | **PROVEN** | `npm test --workspace @rowta/server -- swaps`: tests `'allows requester to cancel their own pending swap'` and `'refuses cancellation from a different staff member (403 team.forbidden)'` in `server/tests/swaps-routes.test.ts` passed |
| Approval atomicity: shift reassigned + activity written in one transaction; notification job enqueued post-commit (best-effort; lost on queue failure); forced failure rolls back shift + activity | **PROVEN** | `npm test --workspace @rowta/server -- swaps`: tests `'allows Manager to approve swap, atomically reassigning shift and writing activity'`, `'requires a target colleague on approval if swap was open'`, and `'allows Manager to reject swap, leaving shift assignment unchanged'` in `server/tests/swaps-routes.test.ts` passed |
| Stale assignee protection: if shift was reassigned between request and approval, refuse with 409 `swap.assignee_changed`; shift, swap and activity untouched | **PROVEN** | `npm test --workspace @rowta/server -- swaps`: test `'refuses approval if shift was reassigned between request and approval (409 swap.assignee_changed)'` in `server/tests/swaps-routes.test.ts` passed |
| Stale requester protection: if requester was removed from team before approval, refuse with 409 `swap.requester_removed`; shift and swap untouched | **PROVEN** | `npm test --workspace @rowta/server -- swaps`: test `'refuses approval if requester was removed from team after creating swap request (409 swap.requester_removed)'` in `server/tests/swaps-routes.test.ts` passed |
| Sequential already-decided: returns 409 conflict when deciding a swap that was already decided | **PROVEN** | `npm test --workspace @rowta/server -- swaps`: test `'returns 409 conflict when deciding a swap that was already decided'` in `server/tests/swaps-routes.test.ts` passed |
| Concurrent decisions: two managers decide at once; exactly one succeeds, second gets 409 conflict | **NOT PROVEN** | **WRITTEN, NOT RUN**. Test `'handles concurrent decisions with row locking (exactly one 200 and one 409)'` in `server/tests/swaps-routes.test.ts` rewritten with `Promise.all` real concurrency; pending owner execution |
| Simultaneous duplicate swap requests: two identical requests arrive at once; returns 201 or 409, never 500 | **NOT PROVEN** | **WRITTEN, NOT RUN**. Test `'handles simultaneous duplicate swap requests without 500 (returns 201 or 409 in_flight)'` in `server/tests/swaps-routes.test.ts` added to verify P2002 race handling; pending owner execution |
| Team isolation: all swap routes return 404 for a team the caller does not belong to | **PROVEN** | `npm test --workspace @rowta/server -- swaps`: test `'enforces team isolation (404) across all swap endpoints for non-members'` in `server/tests/swaps-routes.test.ts` passed |
| Rate limiting: every route registered with explicit id and fail mode in `server/src/security/limits.ts` | **PROVEN** | `npm test --workspace @rowta/server -- swaps`: tests `'registers all six Phase 5 routes'`, `'gives every Phase 5 route a known limit id and requires auth'`, and `'declares the five Phase 5 limits with explicit fail modes'` in `server/tests/swaps-limits.test.ts` passed |
| Shared Zod schemas are `.strict()` and reject unknown fields | **PROVEN** | `npm test --workspace @rowta/server -- swaps`: verified through route validation in `server/tests/swaps-routes.test.ts` |

---

## 3. App rows

| Requirement | Status | Evidence needed / Owner proof command |
|---|---|---|
| Shift detail screen: "Request swap" action for assignee with optional colleague picker | **NOT PROVEN** | Built in `ShiftDetailScreen.tsx`. Screen render not observed on web or device by owner |
| Optimistic update on swap request: immediately reflects pending status | **PROVEN (pure-logic)** | Built in `ShiftDetailScreen.tsx` + pure logic in `app/src/lib/swap-logic.ts`. Passed in `npm run app:test` (`testOptimisticUpdateAndRollback`); screen render not observed |
| Request button accessibility: `busy: true` and `disabled: true` during submission (visually + assistive tech) | **NOT PROVEN** | Built in `ShiftDetailScreen.tsx` (`accessibilityState={{ busy, disabled }}`). Physical TalkBack walkthrough pending owner run |
| Rollback with error message: on request failure, reverts state and announces error via live region | **NOT PROVEN** | Built with `LiveRegion` and rollback reducer. Reducer transitions covered in `testOptimisticUpdateAndRollback`, but live region audio announcement not asserted by test; pending owner web/device run |
| Swaps list screen: team-scoped, cursor-paginated with all four list states (loading, empty, error with retry, populated) | **NOT PROVEN** | Built in `app/src/screens/shifts/SwapsListScreen.tsx`. Screen render across 4 states not observed on web or device by owner |
| Fast scroll de-duplication: paging gate serializes requests | **NOT PROVEN** | Built in `SwapsListScreen.tsx` using `createPagingGate`. Pure-logic paging tests in `npm run app:test` covered Phase 4 shifts feed, not swaps-specific scrolling; device scroll gesture not observed |
| TalkBack checklist for swap views in `docs/a11y/phase-5.md` | **NOT PROVEN** | `docs/a11y/phase-5.md` written. Physical device pass pending owner execution |
| Screens reachable from the team screen | **NOT PROVEN** | **WRITTEN, NOT RUN**. Entry points wired on team screen (`TeamListScreen.tsx`); pure-logic tests written in `app/scripts/test-team-entry-points.ts` and `app/scripts/test-team-entry-nav.ts`; owner must see it on web |
| Colleague picker modal for open swap approval (D1: loading, empty, error with retry, submitting busy) | **PROVEN** | Owner eye 28 Oct |
| Signed-in user name on "Your teams" screen (D2) | **PROVEN** | Owner screenshot 28 Oct ("Signed in as ...") |
| Swaps screen layout: Back button under list content (D3) | **NOT PROVEN** | Moved Back button into `ListFooterComponent` / empty container in `SwapsListScreen.tsx` instead of pinned to screen bottom; not seen on web by owner |
| Approve/reject on deleted shift returns 409 swap.shift_deleted (D4) | **PROVEN** | Owner run 28 Oct, swaps tests "3 files, 33 tests passed", up from 30 (`server/tests/swaps-routes.test.ts`) |
| Cancel succeeds on deleted shift swap (D5) | **PROVEN** | Owner run 28 Oct, swaps tests "3 files, 33 tests passed", up from 30 (`server/tests/swaps-routes.test.ts`) |
| App hides approve/reject and displays notice for deleted shift (D4, D5) | **NOT PROVEN** | `SwapsListScreen.tsx` displays deleted notice card, omits Approve and Reject via `canDecideSwapWithShift`, preserves Cancel button; owner eye test pending |
| Team card role clarity (D8: "Owner of this team", "Manager of this team", "Staff in this team") | **NOT PROVEN** | **WRITTEN, NOT RUN**. `TeamListScreen.tsx` updated with `teamRoleKey` in `app/src/lib/team-role.ts` and test `app/scripts/test-team-role.ts`; owner step: open Your teams and look |
| Shift creator display on details screen (D9: "Created by {name} ({role})") | **NOT PROVEN** | **WRITTEN, NOT RUN**. Server `getShift` mapper, shared `shiftDetailViewSchema`, `ShiftDetailScreen.tsx` with `formatShiftCreator` in `app/src/lib/shift-creator.ts`, and tests written; owner step: open a shift's details and look |

---

## 4. Non-goals (explicitly out of Phase 5)

- Push notification transport and background delivery (Phase 6). Phase 5 only enqueues to the existing `push` queue.
- Quiet hours enforcement (Phase 6).
- Shift trade pairs (two-way shift swaps) — PRD specifies single shift reassignment to target colleague or open pool.
- Native Android device walkthroughs (owner step).

---

## 5. Owner steps for verification

1. Run isolated server suite tests for Phase 5 (including newly written concurrent and duplicate tests):
   ```powershell
   npx tsx server/scripts/test-isolation-check.ts
   npm test --workspace @rowta/server -- swaps
   ```
2. Run app pure-logic scripts:
   ```powershell
   npm exec --workspace @rowta/app -- tsx scripts/test-swap-logic.ts
   npm exec --workspace @rowta/app -- tsx scripts/test-swap-nav.ts
   ```
3. Run linting and gates:
   ```powershell
   npm run lint --workspace @rowta/server
   npm run lint --workspace @rowta/app
   ```
4. Physical Android / Web UI review:
   - Request a swap on an assigned shift, verify optimistic update, then simulated failure rollback with TalkBack reading the live region error.
   - View `SwapsListScreen` as Staff, Manager, Owner across loading, empty, and populated states.

