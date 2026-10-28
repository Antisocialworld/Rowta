# 0016. Swaps state machine, approval atomicity, and concurrency guarantees

Date: 2026-10-28. Status: accepted (agent decision, Phase 5 built; tests written, nothing run yet per owner test freeze; owner to confirm).
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
- **Target resolution:**
  - If the swap request specified a `target_user_id`, that user becomes the new assignee.
  - If the swap was an open request (`target_user_id IS NULL`), the deciding manager MUST supply `targetUserId` in the
    decision payload (`decideSwapSchema`).
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
- **Idempotency-Key required on swap requests:** `POST /teams/:teamId/swaps` requires an `Idempotency-Key` header.
  The server fingerprints the payload using `blake2b512` (SHA-256 is strictly banned per rule A4). Replays return
  the original response; payload mismatches return HTTP 422.

### 5. Notification boundary with Phase 6 and best-effort post-commit enqueue

- **Post-commit enqueue:** Swap events trigger background notification enqueuing:
  - On request: `notify-swap-requested` enqueued to the `push` BullMQ queue.
  - On decision: `notify-swap-decided` enqueued to the `push` BullMQ queue.
  - Enqueue happens **after** the database transaction commits and is **best-effort**. If the queue connection fails,
    a warning is logged and the notification is lost; the database transaction remains committed.
- **Transactional outbox evaluation:**
  - The repo database schema (`server/prisma/sql/`) was checked: no `outbox` table exists.
  - `notification_log` exists on global `db0` solely for deduplication and cannot participate in atomic transactions on
    sharded `db1`.
  - Adding a new outbox table is deferred to avoid uncoordinated schema modifications during Phase 5.
  - **OWNER DECISION NEEDED: add a transactional outbox in Phase 6 (options and trade-offs).**
- Delivery via Expo Push API, device token resolution, notification payload formatting, and quiet hours filtering are
  explicit non-goals of Phase 5 and are scheduled for Phase 6.

## Consequences

- Zero database schema migrations required: schema of record from Phase 0 already contained `swap_requests` and all
  indexes.
- Guarantees shift assignment integrity even under high mobile concurrency and intermittent network retries.
- Client applications can optimistically display swap requests and rollback safely if rejected.

