# Scheduled Jobs Registry

This document catalogs all periodic and background scheduled jobs in Rowta (PRD 8.11, rules J2, D5).
Each schedule is idempotent, concurrency-safe across multiple worker instances, and bound to a dedicated queue or processor.

## Schedules

| Name | Schedule | Purpose | Queue / Mechanism | Lock / Concurrency strategy | Retention / notes |
|---|---|---|---|---|---|
| `foundation-heartbeat` | `0 0 * * * *` (Hourly at :00) | Worker and scheduler liveness verification tick | `foundation` / node-cron | Redis lock `cron:lock:foundation-heartbeat` (TTL 300s) | Verification tick; short-lived |
| `purge-tokens` | `0 30 2 * * *` (Daily at 02:30 UTC) | Hard-delete used or expired auth tokens and verification codes (7 days after expiry) | `purge` / node-cron | Redis lock `cron:lock:purge-tokens` (TTL 600s) | Dry-run logged first; batched |
| `purge-idempotency` | `0 45 2 * * *` (Daily at 02:45 UTC) | Hard-delete expired idempotency keys older than 48 hours | `purge` / node-cron | Redis lock `cron:lock:purge-idempotency` (TTL 600s) | Dry-run logged first; batched |
| `repair-user-team-index` | `0 30 3 * * *` (Daily at 03:30 UTC) | Reconcile DB0 global `user_team_index` and `team_directory` with authoritative shard `memberships` | `purge` / node-cron | Redis lock `cron:lock:repair-user-team-index` (TTL 600s) | Idempotent reconciliation across all shards |
| `sweep-outbox` | `*/20 * * * * *` (Every 20 seconds) | Poll notification_outbox on all shards and deliver due push notifications | BullMQ repeatable job (`push` queue, `sweep-outbox-scheduler`) | Redis lock not needed (BullMQ single scheduler + Postgres `SKIP LOCKED` + row lease heartbeat) | Retries with exponential backoff; dead-letter state after max attempts |
| `expire-invites` | `5 * * * *` (Hourly at minute 5) | Mark open team invitations past `expires_at` by setting `revoked_at = now()` across all shards | BullMQ repeatable job (`purge` queue, `expire-invites-scheduler`) | BullMQ single scheduler + Postgres `FOR UPDATE SKIP LOCKED` + optional Redis lock `cron:lock:expire-invites` | Batched (100/tick); does not touch accepted or manually revoked rows; never logs tokens/emails/names |
| `check-push-receipts` | `*/15 * * * *` (Every 15 minutes) | Poll Expo push receipts, delete `DeviceNotRegistered` devices, and mark resolved tickets `checked_at` | BullMQ repeatable job (`push` queue, `check-push-receipts-scheduler`) | BullMQ single scheduler + Postgres `FOR UPDATE OF t SKIP LOCKED` + optional Redis lock `cron:lock:check-push-receipts` | Batched (<=1000/tick); wait window 15m; abandon tickets older than 24h retention window; never logs raw tokens |

## Concurrency and Two-Worker Safety

1. **Scheduler registration**:
   - BullMQ repeatable schedulers (`sweep-outbox-scheduler`, `expire-invites-scheduler`, `check-push-receipts-scheduler`) are registered with stable IDs using `upsertJobScheduler`. When multiple worker processes start simultaneously, BullMQ's Redis storage guarantees that exactly one scheduler definition exists.
2. **Execution isolation**:
   - Node-cron jobs use atomic Redis locks (`SET key token NX EX ttl`) via `withLock`. If two processes tick at the same time, exactly one acquires the lock and enqueues the job; the other returns immediately.
   - Database operations in job handlers use PostgreSQL `FOR UPDATE SKIP LOCKED` (or `FOR UPDATE OF t SKIP LOCKED` for joins). If two workers process jobs in parallel, they select distinct rows and never double-process or block each other.

