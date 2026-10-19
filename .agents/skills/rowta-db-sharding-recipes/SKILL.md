---
name: rowta-db-sharding-recipes
description: "Use when working on Rowta databases: the SQL baseline applied to both PostgreSQL databases, the Prisma two-client pattern, shard routing, read/write routing with read-your-own-writes, connection pool sizing, Redis cache-aside with CACHE_ENABLED, user_team_index repair, and EXPLAIN evidence."
---

# rowta-db-sharding-recipes

Part of the Rowta method. Scope: PRD 7, 9.2 to 9.6, 8.3; rules D2, D4, D7, D8, S7, S8, T1. Library behaviour is [VERIFY].
Code here is a PATTERN: check every library call against current documentation [VERIFY] before using it, and never paste real secrets (rule S1).

## 1. Layout
DB0 is the global database AND shard 0; DB1 is shard 1 (PRD 7.1). Connection strings come from env NAMES (`DB0_WRITE_URL`, `DB0_READ_URL`, `DB1_WRITE_URL`, `DB1_READ_URL`); READ equals WRITE until a replica exists, and `docs/ARCHITECTURE.md` says so.

## 2. Prisma with two databases [VERIFY before building on it]
Prisma is the query client only. DB0 and DB1 have different tables, so there is one Prisma config and one generated client per database (for example `prisma.db0.config.ts` and `prisma.db1.config.ts`, selected with `--config`), each model produced by `prisma db pull` from a database built from the SQL files. URLs come from the env NAMES `DB0_WRITE_URL` and `DB1_WRITE_URL`; `.env` is not loaded by Prisma automatically, so load it explicitly. NEVER run `prisma migrate dev`, `migrate reset` or `db push` (they can change or wipe triggers, constraints and indexes Prisma does not model). Check the installed version's docs: two clients can coexist, and fields Prisma cannot represent are listed (verified in the docs: an `Unsupported` field stays in the schema but is MISSING from the generated client, so the generated `tsvector` search columns are queried only with parameterised `$queryRaw`; domains and `db pull` behaviour are not documented there, so currency is a plain text CHECK instead of a domain). Money fields must come out as `BigInt`. If the pattern does not hold, stop and report (P4) with options; do not hack around it.

## 3. Migrations (D8, P8)
Migrations are plain SQL files in `server/prisma/sql/`, applied in order with `psql -v ON_ERROR_STOP=1`: `000` and `020` on both databases, `010` on DB0 only (global tables never exist on DB1). A later change is a new numbered file, additive and reversible where possible, applied to BOTH databases (or DB0 only for a global table), with the output of both shown and `selftest.sql` re-run. The ledger trigger and privilege revokes are in `020-team.sql` and are tested as the application role.

## 4. Shard function (one place, PRD 9.5)
`shardFor(teamId)`: compute `blake2b512` of the team ID, take a fixed byte of the digest, reduce mod 2, with `team_directory.override_shard` winning when set. Deterministic across runs and machines. Tests: same ID always gives the same shard; 1,000 fake IDs land on both shards (report the split); override works. A new team is created on its shard and registered in `team_directory` and `user_team_index` in a way that survives a crash between the two (repair job: `repair-user-team-index`).

## 5. Data-access layer (S7, D4)
Everything team-scoped goes through `forTeam(teamId)`, which picks the shard, requires the ID, and filters by it and by `deleted_at IS NULL` unless asked otherwise. No query or transaction spans two databases (D7); "my teams" reads `user_team_index` on DB0 then fans out. Roles are read from `memberships` on every request (S8).

## 6. Read/write routing and read-your-own-writes (9.4)
After a user's write, set Redis `ryw:<userId>` with a 5-second TTL; while it exists that user's reads use the primary. A unit test proves the routing decision; the doc says what changes with a real replica.

## 7. Pool sizing (9.2)
Write the arithmetic in `docs/ARCHITECTURE.md`: instances times pool size stays below the database connection limit minus a reserve. Never leave the default unexamined.

## 8. Cache-aside (9.6)
Cache rosters and calendar ranges (60 s, explicit invalidation on shift or membership change) and the first feed page (15 s, invalidated on new activity). `CACHE_ENABLED=false` bypasses every cache so the "before" load test is honest. Never cache: subscription and payment state, credit balances, webhook idempotency, seat counts for limit checks. Invalidation tests are required.

## 9. Evidence
Capture `EXPLAIN (ANALYZE, BUFFERS)` before and after the feed index on 10,000+ seeded rows (repeatable seed, fake data) and save both under `docs/`. Integration tests use the real Docker databases (T1).

## 10. Mistakes to avoid
A foreign key across databases; a query without a team ID; reading a role from a cache or token; a migration applied to one database only; a pool size chosen by guess.

## Reference schema and migrations (added)
- The reference DDL is in `server/prisma/sql/`: `000-common.sql` (both DBs), `010-global.sql` (DB0 only), `020-team.sql` (both), `030-app-role.sql` (both, last). Apply them in that order as the baseline migration, with `psql -v ON_ERROR_STOP=1`. Do not use Prisma for migrations.
- After every schema change run `server/prisma/sql/selftest.sql` on DB0 and DB1 (it rolls back and uses fake data), then regenerate `docs/DATABASE.md` from the real database.
- Money is `bigint` minor units with a `currency` column; never add a `numeric`, `real`, `double precision` or `money` column.
- The app and worker connect as the non-owner role `DB_APP_USER` (`rowta_app`) using `DB0_WRITE_URL` / `DB1_WRITE_URL`; the owner URLs `DB0_ADMIN_URL` / `DB1_ADMIN_URL` are used ONLY to apply the SQL files, run `030-app-role.sql` and run `prisma db pull`. Apply `030-app-role.sql` last on both databases with `DB_APP_USER` and `DB_APP_PASSWORD` in the process environment (never on a command line), then run `selftest-app.sql` connected as the app role (`DB0_WRITE_URL`, `DB1_WRITE_URL`): it proves the role cannot update, delete or truncate the ledger, drop or alter tables, or create objects.
- `payment_intents` (global) and `ledger_entries` (shard) can disagree after a crash. Write a repair job that compares them and report the count. [DECISION to confirm]
