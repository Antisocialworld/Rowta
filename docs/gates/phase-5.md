# Phase 5 gate — Swaps

State: **Phase 5 BUILT. NOT PROVEN (owner test freeze in effect — tests written, none executed).**
Every row below states NOT PROVEN. Rows with test files written are marked "WRITTEN, NOT RUN" with the exact owner command that proves them.

Branch: `rowta-1`. Date: 2026-10-28. Full-build mode. Owner does all git work (P1).

Scope source: PRD 8.5 (swaps state machine, assignee request, optional target, manager/owner approval, atomicity, one pending per shift, idempotency, app optimistic update + rollback + live announcement), PRD 4 (permission matrix: request_swap, manage_swaps), and PRD 12 Phase 5 gate (lines 603–604).

---

## 1. PRD section 12 Phase 5 gate rows

| # | Requirement (PRD 603–604) | Status | Evidence needed / Owner proof command |
|---|---|---|---|
| 1 | State-machine tests: allowed transitions (`pending -> approved`, `pending -> rejected`, `pending -> cancelled`); all other transitions refused | **NOT PROVEN** | WRITTEN, NOT RUN in `server/tests/swaps-state-machine.test.ts`. Owner command: `npm test --workspace @rowta/server -- swaps-state-machine` |
| 2 | One-pending-swap constraint: second pending swap for the same shift is refused by the database (`swaps_one_pending_idx`), not code alone | **NOT PROVEN** | WRITTEN, NOT RUN in `server/tests/swaps-routes.test.ts` (attempts concurrent/sequential second pending swap insert). Owner command: `npm test --workspace @rowta/server -- swaps-routes` |
| 3 | Optimistic update with a forced failure showing rollback and an announced error | **NOT PROVEN** | WRITTEN, NOT RUN in `app/scripts/test-swap-logic.ts`. Owner command: `npm exec --workspace @rowta/app -- tsx scripts/test-swap-logic.ts` |

---

## 2. Server behaviour rows

| Requirement | Status | Evidence needed / Owner proof command |
|---|---|---|
| Request swap on own shift (assignee): writes `swap_requests` and `activity_events` in one transaction under row lock; enqueues push job post-commit | **NOT PROVEN** | WRITTEN, NOT RUN in `server/tests/swaps-routes.test.ts`. Owner command: `npm test --workspace @rowta/server -- swaps-routes` |
| Idempotency on swap request: missing key 400, replay identical returns 200/cached, payload mismatch returns 422 | **NOT PROVEN** | WRITTEN, NOT RUN in `server/tests/swaps-routes.test.ts`. Owner command: `npm test --workspace @rowta/server -- swaps-routes` |
| Target colleague validation: must be active member of same team; removed member or non-member returns 422 | **NOT PROVEN** | WRITTEN, NOT RUN in `server/tests/swaps-routes.test.ts`. Owner command: `npm test --workspace @rowta/server -- swaps-routes` |
| Shift eligibility: soft-deleted shift or past shift returns 422; shift assigned to someone else returns 403/422 | **NOT PROVEN** | WRITTEN, NOT RUN in `server/tests/swaps-routes.test.ts`. Owner command: `npm test --workspace @rowta/server -- swaps-routes` |
| Permission matrix: Staff gets 403 `team.forbidden` on decide (`manage_swaps`); Owner/Manager allowed | **NOT PROVEN** | WRITTEN, NOT RUN in `server/tests/swaps-routes.test.ts`. Owner command: `npm test --workspace @rowta/server -- swaps-routes` |
| Cancel swap: requester may cancel their own pending swap; Owner/Manager may cancel any; Staff cannot cancel another user's swap (403) | **NOT PROVEN** | WRITTEN, NOT RUN in `server/tests/swaps-routes.test.ts`. Owner command: `npm test --workspace @rowta/server -- swaps-routes` |
| Approval atomicity: shift reassigned + activity written in one transaction; notification job enqueued post-commit (best-effort; lost on queue failure); forced failure rolls back shift + activity | **NOT PROVEN** | WRITTEN, NOT RUN in `server/tests/swaps-routes.test.ts`. Owner command: `npm test --workspace @rowta/server -- swaps-routes` |
| Stale assignee protection: if shift was reassigned between request and approval, refuse with 409 `swap.assignee_changed`; shift, swap and activity untouched | **NOT PROVEN** | WRITTEN, NOT RUN in `server/tests/swaps-routes.test.ts`. Owner command: `npm test --workspace @rowta/server -- swaps-routes` |
| Stale requester protection: if requester was removed from team before approval, refuse with 409 `swap.requester_removed`; shift and swap untouched | **NOT PROVEN** | WRITTEN, NOT RUN in `server/tests/swaps-routes.test.ts`. Owner command: `npm test --workspace @rowta/server -- swaps-routes` |
| Concurrent decisions: two managers decide at once; exactly one succeeds, second gets 409 conflict | **NOT PROVEN** | WRITTEN, NOT RUN in `server/tests/swaps-routes.test.ts`. Owner command: `npm test --workspace @rowta/server -- swaps-routes` |
| Team isolation: all swap routes return 404 for a team the caller does not belong to | **NOT PROVEN** | WRITTEN, NOT RUN in `server/tests/swaps-routes.test.ts`. Owner command: `npm test --workspace @rowta/server -- swaps-routes` |
| Rate limiting: every route registered with explicit id and fail mode in `server/src/security/limits.ts` | **NOT PROVEN** | WRITTEN, NOT RUN in `server/tests/swaps-limits.test.ts`. Owner command: `npm test --workspace @rowta/server -- swaps-limits` |
| Shared Zod schemas are `.strict()` and reject unknown fields | **NOT PROVEN** | WRITTEN, NOT RUN in `server/tests/swaps-routes.test.ts`. Owner command: `npm test --workspace @rowta/server -- swaps-routes` |

---

## 3. App rows

| Requirement | Status | Evidence needed / Owner proof command |
|---|---|---|
| Shift detail screen: "Request swap" action for assignee with optional colleague picker | **NOT PROVEN** | Built in `ShiftDetailScreen.tsx`. Owner step: run app and open a shift assigned to current user |
| Optimistic update on swap request: immediately reflects pending status | **NOT PROVEN** | Built in `ShiftDetailScreen.tsx` + pure logic in `app/src/lib/swap-logic.ts`. WRITTEN, NOT RUN in `app/scripts/test-swap-logic.ts` |
| Request button accessibility: `busy: true` and `disabled: true` during submission (visually + assistive tech) | **NOT PROVEN** | Built in `ShiftDetailScreen.tsx` (`accessibilityState={{ busy, disabled }}`). Owner step: TalkBack check |
| Rollback with error message: on request failure, reverts state and announces error via live region | **NOT PROVEN** | Built with `LiveRegion` and rollback reducer. WRITTEN, NOT RUN in `app/scripts/test-swap-logic.ts` |
| Swaps list screen: team-scoped, cursor-paginated with all four list states (loading, empty, error with retry, populated) | **NOT PROVEN** | Built in `app/src/screens/shifts/SwapsListScreen.tsx`. Owner step: view each state in emulator/web |
| Fast scroll de-duplication: paging gate serializes requests | **NOT PROVEN** | Reuses `createPagingGate` and `canRequestNextPage`. Owner step: fast-scroll test on device |
| TalkBack checklist for swap views in `docs/a11y/phase-5.md` | **NOT PROVEN** | `docs/a11y/phase-5.md` written. Physical device pass pending owner execution |

---

## 4. Non-goals (explicitly out of Phase 5)

- Push notification transport and background delivery (Phase 6). Phase 5 only enqueues to the existing `push` queue.
- Quiet hours enforcement (Phase 6).
- Shift trade pairs (two-way shift swaps) — PRD specifies single shift reassignment to target colleague or open pool.
- Native Android device walkthroughs (owner step).

---

## 5. Owner steps for verification

1. Run isolated server suite tests for Phase 5:
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

