# 0014. Server tests run on throwaway databases and a separate Redis keyspace

Date: 2026-10-28. Status: accepted (agent decision, stage 4 of the owner's 28 Oct overnight list; owner to confirm).
Applies to `server/` tests only.

## Problem

The server suite is a real-database suite (rule T: no mocks for the database). Until now every test run
used the same `DB0_WRITE_URL` / `DB1_WRITE_URL` / `REDIS_URL` values as the running dev API and dev worker,
which means a suite run created and deleted rows in the owner's live local databases and rate-limit /
queue keys in the dev Redis keyspace (port 6390, index 0). Phase 3's close-out proved the damage is real:
the 27 Oct cleanup removed 710 ordinary test rows plus fixtures from the dev databases, and the timing
decoy row had to be given a recognizable email prefix so it could be identified later. A repeated suite
run therefore fights with the owner's dev environment: flaky counts, polluted rate limits, and the
constant risk that a test bug deletes or edits data the owner is using. The same problem is why the
owner's overnight instruction forbade running the server suite until isolation existed.

## Options (with costs)

1. **Second database containers + second Redis (strongest isolation).** Cost: `docker-compose.yml` grows
   two more PostgreSQL services and one more Redis (ports, volumes, passwords, setup script, container
   resources on a laptop); the dev `.env` grows three more names; the owner has to start and maintain
   them. Benefit: physical separation — a test could not reach the dev data even with a wrong URL.
2. **Same containers, separate databases and Redis index (chosen).** Cost: a mistaken hand-run of
   destructive SQL by a human could still reach the dev database; the guard is code, not a firewall.
   Benefit: no new services; `node scripts/db-create-test-databases.mjs` creates `rowta_db0_test` /
   `rowta_db1_test` on the existing containers once, idempotently; Redis index 15 keeps the suite's
   rate-limit and BullMQ keys out of the dev index; derivation means zero configuration for the normal
   local setup.
3. **Mocks / an in-memory database.** Cost: breaks rule T (real-database integration tests) and the
   concurrency/race proofs that depend on real row locks and unique indexes; SQL differences would
   reappear in production. Benefit: no second target at all. Not acceptable for this project.
4. **Keep one target and accept the pollution.** Cost: every suite run deletes dev fixtures, bumps the
   dev rate-limit counters and pollutes the owner's queue keys; a bug can destroy owner data. Benefit:
   zero work. Rejected: this is exactly the problem being solved.

## Choice

Option 2, with a refusal guard:

- `server/tests/setup-isolation.ts` runs as a vitest `setupFiles` entry — before any test file imports
  `env.ts` or `clients.ts` — loads the root `.env` only when needed, resolves the test targets, and
  **refuses to run** when any target is not clearly a test target: non-local host, database names not
  ending in `_test` or equal to the dev names, or a Redis keyspace equal to the dev one. Messages name
  variables only, never values (S1). The verdict is enforced twice: the pure helper
  (`tests/helpers/test-isolation.ts`) and the standalone proof script
  (`server/scripts/test-isolation-check.ts`, 7/7 checks) so the guard logic itself is testable without
  running the database suite.
- Mode A: explicit `TEST_DB0_WRITE_URL`, `TEST_DB1_WRITE_URL`, `TEST_REDIS_URL` (environment or
  `server/.env.test`, example committed as `server/.env.test.example`, fake values only).
- Mode B (default): derive the test targets from the dev URLs — database name + `_test`, Redis index 15
  — so the normal local setup needs no extra file. Derivation is what the owner's machine uses today.
- `scripts/db-create-test-databases.mjs` creates both test databases once (idempotent; refuses a
  `drop` flag; applies the same baseline SQL as the dev databases) and `scripts/redis-key-counts.mjs`
  reports per-prefix key counts for the dev and test keyspaces (read-only, names never printed).

## Why

- Rule T requires real databases; option 2 keeps the real-database guarantee while changing nothing in
  production architecture. The suite keeps proving row locks, unique constraints and SQL exactly as
  before.
- The isolation is cheap to adopt: no compose changes, no new dependencies, one idempotent script for
  the owner, zero configuration in the default mode.
- The guard is the safety property that matters: the failure mode "someone forgets an env var" cannot
  reach the dev databases or the dev Redis keyspace, because the suite refuses before the first import.
- The suite's own keyspace is verifiable: after the full 29-file / 249-test run, Redis index 15 holds
  the suite's BullMQ and rate-limit keys while the dev keyspace's growth is explained by the owner's
  own running dev worker (see the evidence file), and the dev databases' row counts are unchanged apart
  from purge_log rows written by the dev worker's 02:30 / 02:45 UTC cron ticks.

## What would change it

The owner asks for physical container separation (option 1), or a hosted CI database is added (then the
guard's "local host only" rule needs a CI exception scoped to the CI database names). If a future test
must exercise the dev containers themselves, it needs a new ADR and an explicit, separate opt-in name.

## More information

- `docs/gates/evidence-test-isolation.txt` — guard proof, database creation, before/after row counts,
  Redis keyspace counts, and the leak diagnosis that attributes the dev-side changes to the owner's dev
  worker cron.
- `server/.env.test.example` — Mode A names, fake values only.
- `docs/SETUP.md` section 1c — owner steps.
