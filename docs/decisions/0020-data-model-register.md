# 0020. Data model register by feature and phase

Date: 2026-10-30. Status: proposed.
Applies to DB0 (global + shard 0), DB1 (shard 1), server data layer, and shared schema contracts.

## Context and Purpose

This register defines every planned database schema change across Rowta by feature and phase. It formalises database-level guarantees (unique partial indexes, CHECK constraints, foreign keys) so integrity is enforced by PostgreSQL directly rather than depending exclusively on application-level checks.

### Contradiction corrections against the draft register

1. **`purge_log` already exists:** The draft register mentioned adding a purge job writing `purge_log` under Activity. The table `purge_log` is already defined in `server/prisma/sql/000-common.sql:17-25` and applied to both DB0 and DB1. It is an **existing** table; no new table creation is needed.
2. **`teams.deleted_at` was already existing:** Migration `040-teams-created-by-deleted-by.sql` added `created_by` and `deleted_by`. `teams.deleted_at` already existed in baseline `020-team.sql:12`.
3. **Notification delivery log already exists:** `notification_log` (`010-global.sql:191-200`), `push_tickets` (`010-global.sql:181-189`), `devices` (`010-global.sql:97-107`), and `sent_emails` (`010-global.sql:88-95`) already exist on DB0 for outbound delivery deduplication and push receipts. The Phase 6 notification additions are `outbox_events` (transactional outbox per shard) and `user_notifications` (persistent in-app inbox on global DB0).
4. **`activity_events` indexing:** `activity_events` already has compound index `(team_id, created_at DESC, id DESC)` (`020-team.sql:116`). The new index on `(created_at)` specifically optimizes cross-team 90-day time-window retention queries and purges.

---

## Data Model Register

| Feature | Table | Change | New or Existing | Phase | DB-Level Guarantee |
|---|---|---|---|---|---|
| **Teams attribution** | `teams` (shards) | Add `created_by uuid`, `deleted_by uuid` (backfilled from earliest owner) | Existing | Phase 3 / Phase 5 (Done) | Forward-only migration `040`. Historical attribution preserved across ownership transfers. |
| **Swap v2 statuses** | `swap_requests` (shards) | Expand `status` CHECK to include `awaiting_colleague`, `colleague_declined`, `expired` alongside `pending`, `approved`, `rejected`, `cancelled` | Existing | Phase 5 | `CONSTRAINT swaps_status CHECK (status IN ('pending', 'awaiting_colleague', 'approved', 'rejected', 'colleague_declined', 'cancelled', 'expired'))`. |
| **Swap v2 concurrency** | `swap_requests` (shards) | Replace `swaps_one_pending_idx` to cover `status IN ('pending', 'awaiting_colleague')` | Existing | Phase 5 | `CREATE UNIQUE INDEX swaps_one_pending_idx ON swap_requests (shift_id) WHERE status IN ('pending', 'awaiting_colleague')`. Guarantees at most one active swap attempt per shift at DB engine level. |
| **Swap v2 notes & reasons** | `swap_requests` (shards) | Add `note text`, `decline_reason text` (`050`); rejection reason CHECK (`051` pending) | Existing | Phase 5 | `CHECK (note IS NULL OR char_length(note) <= 140)` in `050`. Rejection reason constraint `CHECK (status != 'rejected' OR (decline_reason IS NOT NULL AND char_length(trim(decline_reason)) > 0 AND char_length(decline_reason) <= 140)) NOT VALID` is isolated in pending migration `051-swap-rejected-reason.sql` (to be run together with Swap v2 code that sends `decline_reason`, avoiding breaking current swap decline flow). |
| **Swap v2 audit fields** | `swap_requests` (shards) | Add `colleague_responded_at timestamptz`, `cancelled_by uuid`, `cancelled_at timestamptz` | Existing | Phase 5 | Precise audit trail on colleague response and cancellation. |
| **Activity audience** | `activity_events` (shards) | Add `audience text NOT NULL DEFAULT 'managers'` | Existing | Phase 5 | `CONSTRAINT activity_audience CHECK (audience IN ('team', 'managers', 'involved'))`. Existing `shift.*` rows backfilled to `'team'`; others to `'managers'`. |
| **Activity purge index** | `activity_events` (shards) | Add `activity_created_at_idx` on `(created_at)` | Existing | Phase 5 | `CREATE INDEX activity_created_at_idx ON activity_events (created_at)`. Enables index-scan deletion for 90-day retention purge without table scans. |
| **Activity retention job** | `purge_log` (shards & global) | Periodic cron/worker purge job records purged row counts | Existing (`000-common.sql`) | Phase 6 | `purge_log (job, table_name, row_count >= 0, dry_run, ran_at)`. Audit of all automated data cleanups. |
| **Transactional outbox** | `outbox_events` (shards) | Create per-shard transactional outbox (`id uuid`, `team_id uuid`, `dedupe_key text UNIQUE`, `event_type text`, `payload jsonb`, `status text`, `created_at timestamptz`) | New | Phase 6 | Guaranteed atomicity between business state mutations (swaps, shifts) and outbound notifications within shard transaction. |
| **In-app notifications** | `user_notifications` (global DB0) | Create global inbox (`id uuid`, `user_id uuid REFERENCES users(id)`, `team_id uuid`, `kind text`, `data jsonb`, `read_at timestamptz`, `created_at timestamptz`) | New | Phase 6 | Single source of truth for user's notification center; indexed by `(user_id, read_at, created_at DESC)`. |
| **Swap messaging (held back)** | `swap_messages` (shards) | Pre-negotiation dialogue on swaps: `swap_id uuid`, `seq smallint CHECK (seq BETWEEN 1 AND 5)`, `sender_id uuid`, `message text CHECK (char_length(message) <= 140)` | New | Deferred | `CONSTRAINT swap_messages_swap_seq_key UNIQUE (swap_id, seq)` limits conversation to 5 messages max per swap. |
| **Team announcements (held back)** | `team_announcements` (shards) | Broadcast messages to team: `team_id uuid`, `author_id uuid`, `title text`, `body text`, `expires_at timestamptz` | New | Deferred | Scoped by team ID; filtered by expiry. |
| **Payment audit ledger** | `payment_log` (global DB0) | Audit log of every billing interaction: `id uuid`, `type text`, `status text`, `idempotency_key text UNIQUE`, `provider_ref text`, `amount_minor bigint`, `currency text`, `data jsonb`, `created_at timestamptz` | New | Phase 7 | `UNIQUE (idempotency_key)`. Immutable step-by-step audit log of payment provider interactions. |

---

## Verification Status

### Verified
- `000-common.sql:17-25`: `purge_log` is already defined on both DB0 and DB1.
- `010-global.sql:88-107, 163-200`: `sent_emails`, `devices`, `user_settings`, `push_tickets`, `notification_log` are verified existing on DB0.
- `020-team.sql:19-52, 82-118`: `memberships`, `invites`, `shifts`, `swap_requests`, `activity_events` definitions and constraints are verified on shard DDL.
- `040-teams-created-by-deleted-by.sql`: `teams.created_by` and `teams.deleted_by` migration is verified written and forward-only.
- `server/src/swaps/service.ts:602-635`: Swap approval verifies that shift assignment is updated to `finalTarget` and `swap_requests.target_user_id` is updated when a manager picks the colleague for an open swap.

### Not Verified
- Execution of `040-teams-created-by-deleted-by.sql` on live dev databases `db0` and `db1` (owner backs up and applies migrations).
- Execution of `050-swap-v2-and-activity.sql` on live dev databases (migration written; owner backs up and runs now).
- Execution of `051-swap-rejected-reason.sql` on live dev databases (pending; owner runs together with Swap v2 code that sends `decline_reason`).

