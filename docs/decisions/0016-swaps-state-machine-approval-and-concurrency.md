# 0016. Swaps state machine, approval atomicity, and concurrency guarantees

Date: 2026-10-28. Status: proposed (agent decision, Phase 5 built; server & pure logic proven by owner test runs 28 Oct 2026; owner to confirm).
Applies to Phase 5 server routes (`server/src/swaps/`), shared contracts (`shared/src/swaps.ts`), and app UI (`app/src/screens/shifts/`).

## Problem

PRD 8.5, PRD 4 (permission matrix: `request_swap`, `manage_swaps`), and PRD 12 Phase 5 require shift swap requests with
an auditable lifecycle, atomic shift reassignment upon approval, strict concurrency guarantees (one pending swap per
shift, race-free decisions), role-based cancellation rules, and asynchronous notification enqueuing.

Key engineering problems:
1. **State machine transitions:** Defining valid transitions, immutable terminal states, and pure transition evaluation.
2. **Shift reassignment and target colleague resolution:** Handling targeted swaps vs open swaps when approved by a manager.
3. **Cancellation permissions:** Distinguishing between requester self-cancellation and manager administrative cancellation.
4. **Concurrency & idempotency:** Preventing double pending swaps, conflicting concurrent decisions, or double reassignments.
5. **Notification boundary with Phase 6:** Integrating notification triggers without premature delivery implementation.

## Decisions

### 1. State machine and terminal immutability

- **States:** `pending`, `approved`, `rejected`, `cancelled`.
- **Transitions:**
  - `pending -> approved` (decision)
  - `pending -> rejected` (decision)
  - `pending -> cancelled` (cancellation)
- **Terminal states:** `approved`, `rejected`, and `cancelled` are strictly terminal. Attempting to transition a finalized
  swap returns a domain refusal (`already_final`) yielding HTTP 409 (`swap.already_decided`).
- Implemented as a pure function in `server/src/swaps/state-machine.ts` accompanied by exhaustive unit tests.

### 2. Approval atomicity and target user resolution

- **Shift Reassignment:** When a swap is approved, the shift's `assigned_to_user_id` is updated in the same database
  transaction. If any step fails, the entire transaction rolls back.
- **Assignee staleness protection (DECISION-5):**
  - Inside the decision transaction after locking both the swap and shift rows (`FOR UPDATE`), the server verifies that
    `shifts.assigned_user_id` still equals the swap's `requested_by` user.
  - If the shift was reassigned after the swap request was created, approval is refused with HTTP 409 (`swap.assignee_changed`).
  - The transaction rolls back cleanly: neither the shift nor the swap row is changed, and no activity event is written.
  - The swap remains in `pending` status so a Manager can explicitly reject or cancel it.
- **Requester membership staleness check:**
  - Inside the approval transaction, the server re-verifies that the requester is still an active member of the team
    (`memberships.removed_at IS NULL`). If the requester was removed, approval is refused with HTTP 409 (`swap.requester_removed`).
- **Target resolution and OWNER DECISION D1 (28 Oct 2026):**
  - If the swap request specified a `target_user_id`, that user becomes the new assignee and the swap approves directly without a colleague picker.
  - If the swap was an open request (`target_user_id IS NULL`), OWNER DECISION D1 dictates that the deciding Owner or Manager picks the colleague at approval time using an in-app colleague picker modal (`SwapTargetModal`). Selecting a colleague and confirming sends `targetUserId` in `decideSwapSchema`.
  - The alternative workflow where "target colleague accepts first" before manager review is deferred.
  - If no target user is provided for an open swap approval, the server rejects the request with HTTP 422 (`swap.target_required`).
  - The target user MUST be an active member of the team (`membership.status = 'active'`). Soft-deleted or removed members
    are rejected with HTTP 422 (`swap.target_invalid`).
- **Activity log:** An `activity_events` row with action `swap_decided` (and details including decision and new assignee)
  is written atomically in the same transaction.

### 3. Cancellation policy and role-based permissions

- **Requester cancel:** The staff member who created the swap request (`requested_by_user_id === user.id`) may cancel it
  at any time while it remains `pending`.
- **Manager cancel:** Team Owners and Managers (`can(role, 'manage_swaps')`) may cancel any pending swap request on the team.
- **Staff protection:** A Staff member attempting to cancel a swap created by someone else is refused with HTTP 403
  (`team.forbidden`).
- **Activity log:** An activity event with action `swap_cancelled` is recorded.

### 4. Database-enforced concurrency and idempotency

- **One pending swap constraint:** The database schema (`server/prisma/sql/020-team.sql`) enforces uniqueness via
  the partial unique index:
  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS swaps_one_pending_idx
    ON swap_requests (shift_id)
    WHERE status = 'pending';
  ```
  Any concurrent attempt to request a second pending swap on the same shift violates this constraint at the database level,
  returning HTTP 409 (`swap.conflict.already_pending`).
- **Row locking on decisions:** Both `swap_requests` and `shifts` rows are selected using `SELECT ... FOR UPDATE`
  inside the decision transaction. If two managers attempt to decide the same swap simultaneously, the first commits
  and the second encounters a non-pending status, safely failing with HTTP 409.
- **Idempotency-Key required on swap requests (DECISION-6):** `POST /teams/:teamId/swaps` requires an `Idempotency-Key` header.
  Follows the exact two-phase pattern established in shifts (`server/src/shifts/service.ts`):
  1. Checks for existing key: fingerprint mismatch yields 422 `idempotency.fingerprint_mismatch`; existing `in_flight` state
     yields 409 `idempotency.in_flight`; `done` state replays the cached 201 response with identical body.
  2. Writes an `in_flight` row in `idempotency_keys` outside the swap transaction (satisfying database constraint
     `CHECK (state IN ('in_flight', 'done'))`).
  3. Executes `teamTransaction` with row-locked validations, swap creation, and activity logging.
  4. On commit, updates the key to `done` with `status_code: 201` and cached response.
  5. On failure or rollback, catches and deletes the `in_flight` key row so the client is not permanently locked out.
  - **Known limits:**
    (a) **Fixed (pending owner test run):** Two identical requests arriving at the exact same instant previously could race on `idempotency_keys.create` and throw a unique constraint violation (P2002), resulting in a 500 error. This was resolved in `server/src/swaps/service.ts` by catching Prisma P2002 on `idempotency_keys.create`, re-reading the row, and returning 422 (fingerprint mismatch), 409 `idempotency.in_flight`, or a replayed 201 response. Test `'handles simultaneous duplicate swap requests without 500 (returns 201 or 409 in_flight)'` in `server/tests/swaps-routes.test.ts` covers this, pending owner execution.
    (b) An `in_flight` key that is never completed due to a sudden process crash remains in `in_flight` state until cleanup sweeps stale rows.
    (c) If the `done` update fails after the swap transaction commits, the catch block deletes the in-flight key row, and a subsequent retry will receive 409 `swap.already_pending` because the swap was already committed.

### 5. Notification boundary with Phase 6 and best-effort post-commit enqueue

- **Post-commit enqueue:** Swap events trigger background notification enqueuing:
  - On request: `notify-swap-requested` enqueued to the `push` BullMQ queue.
  - On decision: `notify-swap-decided` enqueued to the `push` BullMQ queue.
  - Enqueue happens **after** the database transaction commits and is **best-effort**. If the queue connection fails,
    a warning is logged and the notification is lost; the database transaction remains committed.
- **Transactional outbox evaluation and OWNER DECISION (28 Oct 2026):**
  - The repo database schema (`server/prisma/sql/`) was checked: no `outbox` table exists.
  - `notification_log` exists on global `db0` solely for deduplication and cannot participate in atomic transactions on
    sharded `db1`.
  - Adding a new outbox table is deferred to avoid uncoordinated schema modifications during Phase 5.
  - **OWNER DECISION (28 Oct 2026):** Best-effort enqueue post-commit remains for now; a shard-local outbox table is planned for Phase 6 (jobs, cron registry). Note the trade-off and accepted risk: if the Node.js process crashes or the queue connection is dropped in the instant between transaction commit and enqueue, the notification will be lost while the shift assignment change remains committed.
- Delivery via Expo Push API, device token resolution, notification payload formatting, and quiet hours filtering are
  explicit non-goals of Phase 5 and are scheduled for Phase 6.

## Consequences

- Zero database schema migrations required: schema of record from Phase 0 already contained `swap_requests` and all
  indexes.
- Guarantees shift assignment integrity even under high mobile concurrency and intermittent network retries.
- Client applications can optimistically display swap requests and rollback safely if rejected.

### 6. Deleted shift handling and lifecycle rules (Owner Decisions D4, D5, D6, D7 — 28 Oct 2026)

- **Approve and Reject blocked on deleted shifts (Owner Decision D4):**
  - If a shift has been soft-deleted (`shifts.deleted_at IS NOT NULL`), attempting to approve or reject the swap is blocked inside the row-locked transaction and returns HTTP 409 (`swap.shift_deleted`, catalog text: *"This shift was deleted, so this swap can no longer be approved or rejected."*).
  - The swap remains in `pending` status.
- **Cancellation preserved on dead swaps (Owner Decision D5):**
  - Requester and Manager cancellation on a swap whose shift was soft-deleted continues to succeed normally (transitions to `cancelled`), enabling cleanup of dead swaps.
  - Automatic cascade cancellation on shift deletion is explicitly NOT implemented (deferred to owner decision per D5).
- **Shift detail retention:**
  - Shifts use soft deletion (`deleted_at` timestamp). Because `swap_requests` foreign key uses default `NO ACTION` without cascade, swap rows and referenced shift titles/times are retained intact. `SwapRequestView` returns `shiftDeleted: boolean` alongside `shiftLabel`, `shiftStartsAt`, and `shiftEndsAt`.
- **App presentation and action guards:**
  - On the swaps list (`SwapsListScreen`), items with `shiftDeleted: true` display a prominent notice (*"This shift was deleted"* / `swap.notice.shiftDeleted`) and omit Approve and Reject buttons, while preserving the Cancel button.
  - If a race occurs where a shift was deleted concurrently while a manager attempts approval, the server returns 409 `swap.shift_deleted`, and the client announces and displays the message cleanly.
- **Staff notification deferred (Owner Decision D6):**
  - Notifying staff about deleted shifts and impacted swaps is deferred to Phase 6 (outbox + worker + quiet hours) and is not built in Phase 5.
- **Database schema discipline (Owner Decision D7):**
  - Zero schema changes required for this handling; soft delete and foreign key references were already established in `020-team.sql`. Future schema changes require forward-only migrations and owner execution.

