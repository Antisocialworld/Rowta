---
trigger: glob
globs: "server/**,shared/**,app/**"
---

# Rowta rules: Async correctness, data, jobs

Part of the binding Rowta rule set in `.agents/rules/`. Every rule has an ID; audits and reports cite the ID.
MUST and NEVER are absolute. [DECISION] = a choice made here that the owner can change. [VERIFY] = check against current official
documentation and cite the page. [OPEN] = waiting for the owner. Full legend: `00-core-process.md`.

---------------------------------------------------------------------------------------------------

## C. Synchronous and asynchronous correctness

C1. **No floating promises.** Every promise is awaited or deliberately handled. Lint with the
    `no-floating-promises` and `no-misused-promises` rules from typescript-eslint and show the lint run.
C2. **No fire-and-forget inside a request.** Slow or unreliable work (email, push, webhook processing, renewals,
    calls to slow third parties) runs as a background job. A request only enqueues.
C3. **Races are stopped by the database.** Multi-step writes run in one transaction. Use row locks
    (`SELECT ... FOR UPDATE`) or unique constraints, never "check then write" in application code. Each race
    that matters has a concurrency test (two simultaneous requests, exactly one succeeds).
C4. **Idempotency.** Handlers that move money or create records accept an `Idempotency-Key`. Jobs are safe to run
    twice (unique constraints guard ledger rows and notifications).
C5. **Timeouts and cancellation.** Every outbound call has a timeout (`AbortController`). Client requests are
    cancelled when the screen unmounts, using the query library's abort signal.
C6. **Never block the event loop.** No `*Sync` file or crypto calls in request paths. Argon2 runs through its async
    API. No `array.forEach(async ...)`; use `for...of` with `await` when order matters, or `Promise.all` with a
    concurrency limit when it does not.
C7. **Optimistic updates** follow: cancel in-flight queries for the key, snapshot, update the cache, send, roll
    back from the snapshot on error, always re-sync on settle. Same-resource mutations are serialised.
C8. **Process safety**: handlers for unhandled rejections and uncaught exceptions log and exit non-zero; the web
    server and the worker shut down gracefully on SIGTERM (stop taking work, finish in-flight, close pools).
C9. **Time**: store `timestamptz` in UTC, convert at the edges. Business logic receives the current time as an
    argument or from an injectable clock so tests control it.
C10. **Retries**: exponential backoff with jitter for outbound calls; never retry a non-idempotent call without
     an idempotency key.
C11. **UI effects** clean up after themselves; no state updates after unmount; stale responses are ignored.

## D. Data

D1. **Money is an integer in minor units** (cents, kobo, ...; the number of decimals is per currency, `currencies.minor_unit`)
    with a currency code beside it. A payment is in the currency of the paying owner's country, from the owner's fixed
    price table, never from a run-time exchange rate; one tested function converts to the provider's unit (PRD 5). No
    floats or decimals anywhere: database, API, JavaScript, tests.
D2. **Uniqueness that matters is enforced by the database** (UNIQUE constraint or partial unique index), not by
    application code. This covers: email, idempotency keys, webhook event IDs, one membership per (team, user),
    exactly one owner per team, invite and token selectors, one pending swap per shift, one active device row per
    device. Application code may check first for a friendly error; the constraint is the guarantee.
D3. **The ledger is append-only.** `ledger_entries` has a database trigger that raises on UPDATE and DELETE, and
    the application role has those privileges revoked. Corrections are new rows. Subscription state can be rebuilt
    from the ledger; a test proves it.
D4. **Soft delete** means a `deleted_at` timestamp (and who did it). The data-access layer excludes soft-deleted
    rows by default; reading them requires an explicit flag. Uniqueness that must ignore deleted rows uses
    partial unique indexes `WHERE deleted_at IS NULL`. Soft delete is the DEFAULT for anything a user can delete.
D5. **Hard delete** happens only inside a purge job, only after the grace period, only for rows already
    soft-deleted, in small batches, with a dry-run mode, and each run writes a `purge_log` row (counts and table
    names, no personal data). NEVER hard-delete from a request handler. NEVER hard-delete ledger rows. Dry run is the default; a real run needs an explicit flag, and each run has a row cap so a bug cannot erase everything at once.
D6. **Grace periods** [DECISION; all in one config file]: account deletion 30 days; team deletion 30 days;
    payment grace 7 days; soft-deleted shifts kept 90 days; used or expired tokens purged 7 days after expiry;
    idempotency keys purged after 48 hours. During a deletion grace period the owner can restore.
D7. **No cross-database foreign keys.** Team data lives on a shard; users live in the global database. Integrity
    across them is checked in code and by the repair job. Record this cost in `SHARDING.md`.
D8. **Migrations** are additive and reversible where possible. Both databases receive them.
D9. **Minimise personal data**: store only what a feature needs. Hard delete removes personal data and keeps the
    financial ledger (see PRD 8.10).

## J. Jobs and scheduled work

J1. **BullMQ** (on Redis) runs background jobs in a separate worker process. Retries use exponential backoff,
    5 attempts [DECISION], then the failed list. Every attempt is logged.
J2. **node-cron schedules; BullMQ works.** `node-cron` lives only in the worker process and only ENQUEUES jobs.
    Before enqueueing, take a Redis lock (`SET key value NX EX ttl`) so two worker instances never run the same
    schedule twice. Schedules are in UTC [VERIFY the node-cron timezone option if a local time is ever needed].
    Every scheduled job is idempotent. Every cron is listed in PRD 8.11 with schedule, purpose and its lock key.
    A `CRON_ENABLED` flag turns scheduling off in tests.
J3. **Graceful shutdown** (C8) applies to the worker. Job payloads never contain secrets.
J4. **Delayed delivery** (quiet hours) uses BullMQ delayed jobs, not cron polling.
