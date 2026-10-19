# 0002 — Prisma as query client only, two databases, two generated clients

- Status: accepted (2026-10-19)
- Related: PRD 7 (databases), PRD 9.1–9.5, rules D1–D8, skill `rowta-db-sharding-recipes`

## Problem

Rowta has two PostgreSQL databases (DB0 = global data and shard 0; DB1 = shard 1) whose schema lives in
`server/prisma/sql/*.sql`. The rule is explicit: never use Prisma migrations, the SQL is the source of truth (D8), and
money stays `bigint` minor units in the database. Prisma must therefore be used in a way that can never rewrite the
schema, and the app must connect to both databases.

## Options

1. **Prisma as query client only: `db pull` + `generate`, two configs, two clients** (chosen). Introspect the live
   databases into two schema files, generate one client per database, connect each with `@prisma/adapter-pg`.
   Cost: the pulled schema files must not be hand-edited (a repair script exists, below), and `Unsupported` columns
   (`tsvector`) are invisible to the client.
2. `prisma migrate` as the schema workflow. Rejected: PRD 7 and D8 make the numbered SQL files the schema of record;
   a second authority would drift and `migrate dev` can drop data.
3. Raw `pg` everywhere, no ORM. Cost: no types for the many models, and every query is hand-written boilerplate.
4. One client with a runtime `datasourceUrl` switch. Cost: one generated model set for two schemas that already differ
   (DB0 has 27 tables, DB1 has 10), which hides real differences and invites cross-database queries — the isolation
   rule S7 wants the opposite of.

## Choice

- One config per database: `server/prisma/db0/prisma.config.ts` (`DB0_ADMIN_URL`) and `.../db1/prisma.config.ts`
  (`DB1_ADMIN_URL`). Setup commands use the admin URLs; the app will use `DB0_WRITE_URL` / `DB1_WRITE_URL` (app role).
- Prisma 7 (`prisma@7.10.1`, `@prisma/client@7.10.1`, `@prisma/adapter-pg@7.10.1`, `pg@8.23.1`), pinned. npm's
  `latest` tag currently points at a release candidate, so versions are pinned and the pin is bumped deliberately.
- Schema files: `server/prisma/db0/schema.prisma` and `.../db1/schema.prisma`, generated clients into
  `server/prisma/generated/db0` and `.../db1` (git-ignored; regenerate with `npm run generate --workspace @rowta/server`).
- Commands go through `scripts/prisma-pull.mjs` (pull + repair) and `scripts/prisma-smoke.mjs` (connect + prove), both
  of which mask credentials before printing anything (S1).
- The config files load the root `.env` themselves with `process.loadEnvFile` (Node 24) because Prisma 7 does not load
  `.env` for `prisma.config.ts`. A program loading `.env` is allowed (S2); nothing is printed.

## Why

The SQL files stay the only authority (D8), introspection is read-only, and two clients make the DB0/DB1 split
impossible to confuse. Money columns come back as `BigInt`, `uuid` as `String @db.Uuid`, `timestamptz` as `DateTime` —
verified at runtime by `scripts/prisma-smoke.mjs`.

### The introspection mistake this choice costs

Prisma 7.10.1 turns a **partial unique index whose column is also a foreign-key target** into a one-to-one relation.
Three Rowta relations are affected and are really one-to-many: `teams.memberships` (one *active owner* per team, not one
member), `users.password_resets` (one *unconsumed* reset per user, not one row) and `shifts.swap_requests` (one *pending*
swap per shift). For `swap_requests` the generated schema fails validation outright
("A one-to-one relation must use unique fields on the defining side"). Adding `@@unique([team_id, shift_id])` was
rejected because the database has no such constraint — the model would lie about the database.

`scripts/prisma-pull.mjs` therefore runs every pull with `--force` (pull refuses to start while the previous schema is
invalid) and then rewrites exactly those three back-relations to lists, failing loudly if the expected counts change.
CHECK constraints are likewise not represented in the client: they live in the database and still guard the data (the
selftests prove this); the client simply cannot see them.

## What would change it

A Prisma release that models partial unique indexes correctly (then the repair step can be deleted), or the owner
choosing raw `pg` or Drizzle after seeing the client in use. Moving to migrations would need an explicit PRD change,
not a tooling preference.
