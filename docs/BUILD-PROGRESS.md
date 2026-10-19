# Build progress

Updated by the agent after every phase. A fresh session resumes from this file ("continue from docs/BUILD-PROGRESS.md").

| Phase | Name | State | Gate evidence |
|---|---|---|---|
| scaffold | folders, `.env.example`, README, docs skeleton | done (by the owner's planner, not yet committed) | n/a |
| 0 | Foundations | in progress — part A (databases + Prisma) done, part B (server skeleton, worker, health, logger, shard routing, lint) not started | `docs/gates/phase-0.md` |
| 1 | Design system and app shell | not started | |
| 2 | Auth | not started | |
| 3 | Teams, roles, invites | not started | |
| 4 | Shifts, calendar, feed, search | not started | |
| 5 | Swaps | not started | |
| 6 | Jobs, cron, push, settings | not started | |
| 7 | Billing | not started | |
| 8 | Offline and Dashboard | not started | |
| 9 | Lifecycle | not started | |
| 10 | System design layers | not started | |
| 11 | Web surface | not started | |
| 12 | Load tests, docs, build, demo | not started | |

## Known problems

- Owner hand steps for this round: run `node fix-env-name.mjs` (dry run), then with `--write`, then plain again; in `.env` delete the old `PAYMENT_CURRENCY` line and the `PAYMENT_FALLBACK_CURRENCY` line and set `TRUST_PROXY_HOPS=0`; delete `fix-env-name.mjs` and the stray root files; run `node scripts/setup-env.mjs --check`; confirm `git status` shows no `.env`, then commit and push to https://github.com/Antisocialworld/Rowta; rename the folder to `rowta`.
- Q9 (light theme only), Q11 (warning/success colours as-is), Q12 (price/currency/country seeding) remain open with stated defaults.
- Prisma's `latest` npm tag points at a release candidate (`8.0.0-rc.23`). Versions are pinned at 7.10.1 in `server/package.json`; bump deliberately, never with `@latest`.
- `prisma db pull` mis-infers three one-to-many relations as one-to-one (partial unique indexes). `scripts/prisma-pull.mjs` repairs them after every pull — never run `npx prisma db pull` directly, and never hand-edit `server/prisma/db*/schema.prisma`. Details: `docs/decisions/0002`.
- ESLint is not configured yet (Phase 0 part B), so the floating-promise gate has not been run.

## Session log

### 2026-10-19 — scaffold re-verify + sync + no-fallback confirmations + owner env-fix script
- STEP 1: `rowta-scaffold-v3.md` (370,799 B) and `rowta-scaffold.json` (373,121 B) verified against the expected blake2b512 digests — both PASS.
- STEP 2: sync wrote only `docs/BUILD-PROGRESS.md` (1 overwritten, 84 identical, 0 created; `.env` protected, `design-system/` and `rowta-old-backup/` untouched). Confirmations: `.env.example` = 50 names, no `PAYMENT_FALLBACK_CURRENCY`; PRD + `rowta-payments-recipes` + `docs/DATABASE.md` all state NO fallback currency and that the sign-up country list offers only countries whose currency is sold; `grep -rn FALLBACK` (skipping `.env` and backups) hits only transport strays, policy/fallback-page text, and one `design-system/convertTokens.js` comment (report-only, not edited).
- STEP 3: `fix-env-name.mjs` created in the repo root with the owner's exact content — NOT run by the agent; added to `.gitignore`; `scripts/scan-name.mjs` skips it.
- STEP 4: `docs/a11y/rule-ids.txt` regenerated — 109 IDs (per file: 00=12, 01=14, 02=15, 03=8, 10=24, 20=11, 21=14, 22=6, 90=5); 109 lines, 0 non-matching; no rule file edited.
- STEP 5: `scan-name.mjs` TOTAL 0/0/0; `verifyTokens.js` = 391 / 391 / 0 errors; token test PASS; `check-ui-tokens.mjs` PASS (0 source files built yet).

### 2026-10-19 — Phase 0 part A: databases, self-tests, Prisma clients
- STEP 1: preflight. `setup-env.mjs --check` = ok. Image tags verified to exist on Docker Hub; the mail catcher was pinned in `docker-compose.yml` from `axllent/mailpit:latest` to `axllent/mailpit:v1.31.6`.
- STEP 2: `docker compose up -d`. All four containers healthy: `postgres:16-alpine` on 127.0.0.1:5442 and :5443, `redis:7-alpine` on :6390, Mailpit on :1025/:8025. Left running.
- STEP 3: `scripts/db-apply.mjs` written and run. Applies 000/010/020/030 to both databases as the owner through `psql ON_ERROR_STOP=1` inside the container; skips files whose tables already exist; 030 gets the app-role name/password by env name, never printed. Re-run proved idempotent. Real table counts: DB0 = 27, DB1 = 10 (matches `docs/DATABASE.md`).
- STEP 4: `selftest.sql` as owner: DB0 103 PASS / 0 ERROR, DB1 50 PASS + 1 SKIP (shard-only) / 0 ERROR, rolled back. New `scripts/db-as-app.mjs` runs `selftest-app.sql` as the app role: 12 PASS on each, 0 errors. `--ledger` mode proves append-only in the database: INSERT accepted, UPDATE/DELETE/CREATE TABLE refused, rollback leaves 0 rows and no scratch table, on both databases.
- STEP 5: Prisma set up as query client only (ADR 0002). Root `package.json` adds npm workspaces (ADR 0001); `server/package.json` pins `prisma@7.10.1`, `@prisma/client@7.10.1`, `@prisma/adapter-pg@7.10.1`, `pg@8.23.1` (npm's `latest` tag is a release candidate). One `prisma.config.ts` per database; `DB0_ADMIN_URL`/`DB1_ADMIN_URL` for setup, `DB0_WRITE_URL`/`DB1_WRITE_URL` for the app; configs load the root `.env` with `process.loadEnvFile` because Prisma 7 does not. `db pull` introspected 27 and 10 models; `generate` built two clients into `server/prisma/generated/` (git-ignored). No migration command was run or added.
- STEP 6: the introspection bug. Prisma turns partial unique indexes on foreign-key targets into one-to-one relations, which is wrong for `teams.memberships`, `users.password_resets` and `shifts.swap_requests` (and fails validation outright for the last one). Adding a `@@unique` was rejected: the database has no such constraint, so the model would lie. `scripts/prisma-pull.mjs` runs the pull with `--force` and rewrites exactly those three back-relations to lists, failing loudly if the counts change.
- STEP 7: `scripts/prisma-smoke.mjs` — both clients connect as the app role; `2000::bigint` returns `BigInt`, text returns `string`, `timestamptz` returns `Date`; ledger append allowed, `updateMany`/`deleteMany` refused with permission denied, row count unchanged. Its first version wrongly expected INSERT to be refused; the correct rule (D3) is append allowed, modify/delete refused, and the test was fixed to match the database.
- STEP 8: docs and gates. `docs/SETUP.md` gained §4 "Databases" and the stale "containers not started" line was replaced with the verified state. ADRs 0001 and 0002 written. `docs/gates/phase-0.md` holds the real output for every part A gate item and marks every part B item "not verified". Forbidden-pattern gates 1–5 clean in scope (planner files `rowta-scaffold*`/`rowta-old-backup/` and the git-ignored `server/prisma/generated/` excluded, both documented); `scan-name.mjs` 0/0/0; `verifyTokens.js` 391/391/0; `check-ui-tokens.mjs` PASS.
- Rule slips disclosed in the gate file: two one-off `node -e` probes; the folder name is `Rowta`, not `rowta` (owner rename step, NTFS cannot hold both).

## Not verified

Phase 0 part B: health endpoint, request-ID middleware, structured logger with redaction, BullMQ queue and worker with one end-to-end test job, node-cron with a Redis lock, Zod env validation, shard routing with the 1,000-ID seed and split, a nodemailer test email through the catcher, ESLint with floating-promise rules, and any test suite. Everything outside the commands in the session logs. `.env` was never opened; no git command that writes was run.
