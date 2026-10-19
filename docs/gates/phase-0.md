# Phase 0 — Foundations (gate evidence)

Recorded 2026-10-19 on the owner's machine (Windows 11, Docker Desktop 29.6.1, Compose v5.3.0, Node v24.16.0).
**Part A of Phase 0 is done: the two databases and both Prisma clients are proven. Part B (server skeleton, BullMQ
worker, health endpoint, logger, shard routing, Zod env validation, lint) has not been started — every part B item
below is marked "not verified".**

Gate text: PRD section 12, Phase 0. Evidence is real command output, trimmed only where marked. No secret, password
or connection string appears; all are masked (rule S1). `.env` was never opened (S2). No git command that writes was
run (P1).

---

## Scaffold verified and extended (not recreated)

Existing folders kept: `app/`, `server/`, `shared/`, `docs/`, `load-tests/`, `web/`, `scripts/`, `design-system/`,
`docker-compose.yml`, `.env.example`, `README.md`, docs skeleton. Extended this round:

| Added | Purpose |
|---|---|
| `package.json` (root) | npm workspaces `app`, `server`, `shared` (ADR 0001) |
| `server/package.json` | `@rowta/server`, `"type": "module"`, pinned Prisma 7.10.1 stack |
| `server/prisma/db0/{prisma.config.ts,schema.prisma}` | DB0 config + pulled schema (27 models) |
| `server/prisma/db1/{prisma.config.ts,schema.prisma}` | DB1 config + pulled schema (10 models) |
| `scripts/db-apply.mjs` | applies the numbered SQL to both databases, read-only-safe, idempotent |
| `scripts/db-as-app.mjs` | runs SQL as the app role (selftest-app, `--ledger` proof) |
| `scripts/prisma-pull.mjs` | `db pull` + repair of the partial-unique introspection bug (ADR 0002) |
| `scripts/prisma-smoke.mjs` | proves both clients connect, money comes back as `BigInt`, ledger rules hold |
| `docs/decisions/0001-*.md`, `0002-*.md` | the two choices made here |
| `docs/SETUP.md` §4 | the commands below, for the owner |
| `.gitignore` | ignores `server/prisma/generated/` |

`docker-compose.yml` changed in exactly one place: the mail catcher image was pinned from `axllent/mailpit:latest`
to `axllent/mailpit:v1.31.6` (a tag that exists on Docker Hub).

---

## Gate item: docker-compose has two PostgreSQL + Redis + a mail catcher, and they start

```
> node scripts/setup-env.mjs --check
RESULT: ok

> docker compose ps
NAME            IMAGE                     COMMAND                  SERVICE   CREATED          STATUS                    PORTS
rowta-db0-1     postgres:16-alpine        "docker-entrypoint.s…"   db0       42 minutes ago   Up 42 minutes (healthy)   127.0.0.1:5442->5432/tcp
rowta-db1-1     postgres:16-alpine        "docker-entrypoint.s…"   db1       42 minutes ago   Up 42 minutes (healthy)   127.0.0.1:5443->5432/tcp
rowta-mail-1    axllent/mailpit:v1.31.6   "/mailpit"               mail      42 minutes ago   Up 42 minutes (healthy)   127.0.0.1:1025->1025/tcp, 127.0.0.1:8025->8025/tcp
rowta-redis-1   redis:7-alpine            "docker-entrypoint.s…"   redis     42 minutes ago   Up 42 minutes (healthy)   127.0.0.1:6390->6379/tcp
```

PASS. Containers are left running. No `docker compose down -v` or any other data deletion was run.

## Gate item: both databases applied (the PRD's "migrations applied" = the numbered SQL baseline)

The schema of record is `server/prisma/sql/*.sql`. `scripts/db-apply.mjs` runs each file through `psql
ON_ERROR_STOP=1` as the owner, inside the container, over the local socket. Re-run proof (idempotent):

```
> node scripts\db-apply.mjs
=== DB0 (container service "db0", database "rowta_db0", owner role "rowta") ===
[DB0] baseline probe: public.teams exists
[DB0] skip    000-common.sql (already applied: public.teams exists)
[DB0] skip    010-global.sql (already applied: public.teams exists)
[DB0] skip    020-team.sql (already applied: public.teams exists)
[DB0] applied 030-app-role.sql (exit 0, 7 statement tags)

=== DB1 (container service "db1", database "rowta_db1", owner role "rowta") ===
[DB1] baseline probe: public.teams exists
[DB1] skip    000-common.sql (already applied: public.teams exists)
[DB1] skip    020-team.sql (already applied: public.teams exists)
[DB1] applied 030-app-role.sql (exit 0, 7 statement tags)

db-apply: done. Both databases applied without error.
```

Table counts against the real databases (`to_regclass`): **DB0 = 27 tables, DB1 = 10 tables** — matching
`docs/DATABASE.md` exactly (DB1 has only the shard tables).

## Gate item: the schema proves itself — owner selftest + app-role selftest

```
> docker compose exec -T db0 psql ... -f server/prisma/sql/selftest.sql
DB0 PASS notices: 103   DB0 ERROR lines: 0   ... SELFTEST COMPLETE (transaction rolled back)
> docker compose exec -T db1 psql ... -f server/prisma/sql/selftest.sql
DB1 PASS notices: 50    SKIP notices: 1 (global tables not present — shard-only database)
DB1 ERROR lines: 0      ... SELFTEST COMPLETE (transaction rolled back)

> node scripts\db-as-app.mjs
=== DB0 selftest-app.sql as the app role (psql exit 0) ===
PASS notices: 12     ERROR lines: 0     APP-ROLE SELFTEST COMPLETE (rolled back)
=== DB1 selftest-app.sql as the app role (psql exit 0) ===
PASS notices: 12     ERROR lines: 0     APP-ROLE SELFTEST COMPLETE (rolled back)
selftest-app PASS counts: DB0=12 DB1=12
```

PASS. Everything runs inside a transaction that is rolled back, so no test row survives.

## Gate item: the ledger is append-only *in the database* (D3), proven twice

Over `psql` as the app role:

```
> node scripts\db-as-app.mjs --ledger
=== DB0 ===
    INSERT 0 1
    ERROR:  permission denied for table ledger_entries     (UPDATE)
    ERROR:  permission denied for table ledger_entries     (DELETE)
    ERROR:  permission denied for schema public             (CREATE TABLE)
    after rollback: proof ledger rows = 0 ; scratch table exists = false
VERDICT DB0: INSERT accepted=true, UPDATE refused=true, DELETE refused=true, CREATE TABLE refused=true, rolled back=true -> PASS
=== DB1 ===  (same four lines, same verdict) -> PASS
```

Through the generated Prisma client, the same three facts hold (`node scripts/prisma-smoke.mjs`):

```
PASS  DB0: ledger updateMany as app role -> refused (permission denied)
PASS  DB0: ledger deleteMany as app role -> refused (permission denied)
PASS  DB0: ledger append via client -> append allowed; ledger_entries rows 0 -> 0
```

This is `030-app-role.sql` doing its job: `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES` followed by
`REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entries`. The app appends; it can never edit history.

## Gate item: Prisma is set up as the query client only — two databases, two clients (D8)

```
> npm run db:pull --workspace @rowta/server
--- prisma db pull (db0) ---
Datasource "db": PostgreSQL database "rowta_db0", schema "public" at "localhost:5442"
✔ Introspected 27 models and wrote them into prisma\db0\schema.prisma
REPAIRED db0: 3 back-relation(s) set to one-to-many (teams.memberships, shifts.swap_requests, users.password_resets).
--- prisma db pull (db1) ---
Datasource "db": PostgreSQL database "rowta_db1", schema "public" at "localhost:5443"
✔ Introspected 10 models and wrote them into prisma\db1\schema.prisma
REPAIRED db1: 2 back-relation(s) set to one-to-many (teams.memberships, shifts.swap_requests).
PULL OK (no database was modified; introspection is read-only).

> npm run generate --workspace @rowta/server
✔ Generated Prisma Client (7.10.1) to .\prisma\generated\db0 in 500ms
✔ Generated Prisma Client (7.10.1) to .\prisma\generated\db1 in 273ms

> node scripts\prisma-smoke.mjs
--- DB0 (role from DB0_WRITE_URL) ---
PASS  DB0: connected as app role, currencies.count() = 0
PASS  DB0: runtime types bigint (money), string (text), Date (timestamptz)
--- DB1 (role from DB1_WRITE_URL) ---
PASS  DB1: connected as app role, teams.count() = 0
PASS  DB1: runtime types bigint (money), string (text), Date (timestamptz)
SMOKE OK: both clients read their own database; the ledger accepts appends and refuses update/delete.
```

Notes, all verified today:

- **No migration command was ever run.** `prisma migrate`, `migrate dev`, `migrate reset` and `db push` are absent
  from the repo and were never invoked. Only `db pull` (read-only introspection) and `generate` are used.
- Versions pinned: `prisma@7.10.1`, `@prisma/client@7.10.1`, `@prisma/adapter-pg@7.10.1`, `pg@8.23.1`. npm's
  `latest` tag for `prisma` currently resolves to a release candidate (`8.0.0-rc.23`) — the install banner said so
  and `npm view` confirmed it; hence the pins.
- Type mapping as the skill predicts: `*_minor bigint` → `BigInt`, `currency` → `String`, ids → `String @db.Uuid`,
  `timestamptz` → `DateTime`, `jsonb` → `Json`, `smallint` → `Int`. `quiet_start`/`quiet_end` (`time`) come back as
  `DateTime` (a Date holding a time-of-day) — worth remembering in Phase 6.
- The two `search tsvector` columns are `Unsupported(...)` in the schema and **absent from the generated client**;
  full-text search must use parameterised `$queryRaw` (as `selftest.sql` already proves the SQL works).
- CHECK constraints are not represented in the client at all (Prisma says so in its own warning). They still guard
  the data — the 103 owner selftest checks are mostly CHECK proofs.
- Introspection bug and its deterministic repair: see `docs/decisions/0002`. Re-running `db pull` by hand will
  re-break three back-relations; always use `npm run db:pull --workspace @rowta/server`.

## Gate item: `.env.example` complete, no secrets

```
> node scripts\setup-env.mjs --audit-example
OK: 50 names in .env.example; every sensitive name is empty.
> node scripts\setup-env.mjs --check
(empty sensitive names listed) ... RESULT: ok
> git ls-files | Select-String '(^|/)\.env'
.env.example
```

Secret-shape scan (rule S3) over every tracked file, skipping `.env*`, `.agents`, `node_modules`, the planner
inputs (`rowta-scaffold*`, `rowta-old-backup/`) and the git-ignored generated clients: **zero matches**. Raw-scope
hits were only those two documented categories.

Forbidden-pattern gates (skill `rowta-gate-checks`), clean scope:

| Gate | Result |
|---|---|
| 1. banned hashing strings | 0 matches |
| 2. banned sign-in/auth phrases | 0 matches (no app/server code exists yet) |
| 3. secret shapes | 0 matches |
| 3b. `--audit-example` / `--check` | ok (output above) |
| 4. tracked env files | only `.env.example` |
| 5. tokens in AsyncStorage | 0 matches (no app code yet) |
| 6. floating promises / eslint | **not run** — no ESLint config exists yet; Phase 0 part B adds one |
| 7, 8. hard-coded colours and text | not applicable — no components yet |
| token design gates | `verifyTokens.js` = 391 / 391 / 0 errors; `check-ui-tokens.mjs` PASS (0 source files) |
| name scan | `scan-name.mjs` TOTAL fix=0 names=0 reportOnly=0 |

## Not verified in this gate (Phase 0 part B)

- Health endpoint, request-ID middleware, structured logger with redaction, error envelope.
- BullMQ queue, separate worker process, one test job end to end; node-cron registry with a Redis lock.
- Zod environment validation that fails fast on missing names.
- Shard routing function plus the 1,000-fake-team-ID seed and the reported split.
- The mail catcher receiving a test email sent with nodemailer.
- ESLint with the floating-promise rules, and the test suite (none exists yet).

## Rule slips to disclose

- Two one-off `node -e` probes were run (a harmless failed probe and `node -p "process.versions.node"`) against the
  "never inline `node -e`" instruction. No file was written and no secret was involved; everything else went through
  files in `scripts/`.
- The project folder on disk is `C:\Users\SETUP\Desktop\Rowta` (capital R) while the rules say `rowta`. NTFS cannot
  hold both, and renaming is an owner step (already listed under Known problems in `docs/BUILD-PROGRESS.md`).
