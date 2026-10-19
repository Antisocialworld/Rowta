# AGENTS.md — Rowta

You are building Rowta, a shift-scheduling mobile app (Expo, Android) with a Node.js backend. Read these files before
writing any code, and again at the start of every phase and every session (also skim `README.md` and
`docs/BUILD-PROGRESS.md`):

1. `.agents/rules/*.md` — the binding rules, split by topic (rule IDs: P, S, A, V, C, D, J, U, X, W, T, M). The first four files
   are always loaded; the others load by file pattern or by need. When you are about to touch an area, open its rule file
   if it is not already in your context (table below).
2. `.agents/PRD/PRD-001-rowta.md` — what to build, the data model, the flows, the phases and their gates.
3. `.agents/skills/*/SKILL.md` — how to work: the loop, recipes, checklists, gates to run, report format. Load a skill when
   its description matches the task, and always before a gate or a report.

## The ten rules you must never forget (full text in `.agents/rules/`)

1. NEVER commit, push, stage, publish or deploy. The owner does all git work and all deploys. (P1)
2. NEVER write, print or log a real secret, key, token, password or code. Mask first. NEVER open `.env` files except
   `.env.example` (the empty `.env` in the repo is for programs and the owner, not for you). Check it only with
   `node scripts/setup-env.mjs --check`. (S1, S2)
3. The server decides everything that matters; the app only displays. Every query is scoped by `teamId`. (S5, S7)
4. Passwords and every short secret are hashed with Argon2id. SHA-256 is banned in any form. (A1 to A4)
5. Sign-in failure is always "Invalid email or password." Never reveal which part was wrong or whether an account
   exists. (A5, A6)
6. Zod on every form and request, schemas shared, validated on the client AND on the server. Passwords: minimum 8. (V1, V2, A8)
7. Authentication is views on one screen, not pages. Zero reload. Auto focus. Every control has an accessible name and
   state. Works for blind, deaf, and speech-impaired users and on every phone size. (U1, U3, U7, U9, X)
8. Money is an integer in the currency's smallest unit (cents, kobo, ...; per-currency decimals). The ledger is append-only. Uniqueness is enforced by the database. (D1 to D3)
9. Soft delete first; hard delete only by the purge job after the grace period; node-cron enqueues, BullMQ works,
   a Redis lock stops double runs. (D4 to D6, J2)
9a. The database schema lives in `server/prisma/sql/` (money is bigint minor units); run `selftest.sql` (owner) and `selftest-app.sql` (app role) after any change and regenerate `docs/DATABASE.md` from the real database. Never use Prisma migrations.
10. Phases run in order and each gate must pass, with evidence saved in `docs/gates/`, before the next phase starts.
    Prove every claim with real output. Say "not verified" when it was not. Stop on a failing gate, a rule
    conflict, or anything touching secrets. Keep `docs/BUILD-PROGRESS.md` current. (P2 to P4)

## Rule files and skills (activation, set in each file's frontmatter)

| File | Covers | Trigger |
|---|---|---|
| `rules/00-core-process.md` | P1 to P12 | always_on |
| `rules/01-secrets.md` | S1 to S14 | always_on |
| `rules/02-auth-credentials.md` | A1 to A13 | always_on |
| `rules/03-validation.md` | V1 to V8 | always_on |
| `rules/10-async-data-jobs.md` | C, D, J | glob: server, shared, app |
| `rules/20-ui.md` | U1 to U11 | glob: app, web |
| `rules/21-accessibility.md` | X1 to X14 | glob: app, web |
| `rules/22-web-surface.md` | W1 to W6 | glob: web |
| `rules/90-tests-and-docs.md` | T, M | model_decision |
| `skills/rowta-session-and-report` | method sections 1, 2, 6, 7, 8 | agent-triggered by description |
| `skills/rowta-auth-recipes` | recipes 3.1 to 3.6 and 3.16 to 3.20 (tokens, refresh, sign-up, reset, magic link) | agent-triggered |
| `skills/rowta-data-recipes` | recipes 3.7 to 3.14 | agent-triggered |
| `skills/rowta-web-metadata` | recipe 3.15 and web build notes | agent-triggered |
| `skills/rowta-accessibility-checklist` | method section 4 | agent-triggered |
| `skills/rowta-gate-checks` | method section 5 (gates) | agent-triggered |
| `skills/rowta-payments-recipes` | billing, Flutterwave, dev simulator, ledger, grace | agent-triggered |
| `skills/rowta-privacy-recipes` | personal data, logs, deletion, processors, privacy page | agent-triggered |
| `skills/rowta-notifications-email-recipes` | push and nodemailer email jobs | agent-triggered |
| `skills/rowta-db-sharding-recipes` | two databases, shard routing, pools, cache, EXPLAIN | agent-triggered |
| `skills/rowta-app-ui-recipes` | tokens, components, state, lists, size matrix, icons | agent-triggered |
| `skills/rowta-testing-recipes` | integration, permission, race, timing, cron tests | agent-triggered |
| `skills/rowta-server-foundation-recipes` | env validation, middleware order, logging, errors, policy, rate limit, idempotency, hardening | agent-triggered |
| `skills/rowta-jobs-worker-recipes` | BullMQ worker, job IDs, cron registry and locks, failed jobs, shutdown | agent-triggered |
| `skills/rowta-teams-roles-recipes` | permission matrix, team creation, invites, seats, role changes | agent-triggered |
| `skills/rowta-shifts-swaps-search-recipes` | shifts, feed, full-text search, swaps, restricted state | agent-triggered |
| `skills/rowta-settings-offline-dashboard-recipes` | settings, offline cache, Dashboard cards | agent-triggered |
| `skills/rowta-rate-limiting-recipes` | rate limits for every endpoint, fail modes, 429 behaviour, tests | agent-triggered |
| `skills/rowta-delivery-recipes` | progress and gate files, ADRs, docs, k6, deploy and owner files, git text, demo | agent-triggered |

"SKILL section N" or "SKILL 3.x" anywhere in these files means the skill that holds that section (see the table). Details: `docs/AGENT-SETUP.md`.

## Where things go

`/app` mobile app · `/server` API, worker, cron · `/shared` Zod schemas used by both · `/docs` all documents ·
`/load-tests` k6 scripts and report · `/web` public web surface (the owner deploys it to Vercel) ·
`/scripts` `setup-env.mjs` (creates `.env`, generates local secrets, checks names; prints no values) ·
`docker-compose.yml` (two PostgreSQL, Redis, local mail catcher) · `.env.example` (every variable name).
The folders already exist (marked by `.gitkeep`); fill them, do not rename them.

## Current state

Phase: 0 in progress — part A done (two PostgreSQL databases applied and self-tested as owner and app role; Prisma set
up as the query client only with two clients, proven by `node scripts/prisma-smoke.mjs`), part B not started (server
skeleton, BullMQ worker, health, logger, shard routing, Zod env validation, ESLint). Full-build mode. Payments:
Flutterwave test mode plus the dev-only simulator. Email: nodemailer over SMTP. Evidence: `docs/gates/phase-0.md`;
resume from `docs/BUILD-PROGRESS.md`. Decisions 0001 (npm workspaces) and 0002 (Prisma query client only) are in
`docs/decisions/`. Run `npm run db:pull --workspace @rowta/server`, never a bare `npx prisma db pull`. Update this
line at the end of each phase.
