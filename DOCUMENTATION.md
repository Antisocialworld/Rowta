# Rowta — documentation front door

Rowta is a shift-scheduling app for small teams, Android first. Owners and managers publish shifts; staff see
them, ask for swaps and get notified; the business pays per seat. The app never decides anything that matters:
the server enforces roles, team isolation, seats and money.

This page is the map. It says what exists, how to run it, how to test it, and — just as important — what is
proven and what is not. Every phase claim below comes from the gate file named beside it, not from a plan.

- Repository state and the next task: [docs/BUILD-PROGRESS.md](docs/BUILD-PROGRESS.md)
- The specification (what to build, data model, phases): `docs/` is the only documentation folder
- Database reference (generated from the real database): [docs/DATABASE.md](docs/DATABASE.md)
- Security notes: [docs/SECURITY.md](docs/SECURITY.md)
- Owner setup guide: [docs/SETUP.md](docs/SETUP.md)

## Repository layout

| Path | What it is |
|---|---|
| `app/` | Expo / React Native app (Android development build). Screens, components, theme tokens, API client, state. |
| `server/` | Node.js API (Hono), BullMQ worker, cron registry, SQL schema of record in `server/prisma/sql/`. |
| `shared/` | Zod schemas and message keys used by both the app and the server. Validated on both sides. |
| `web/` | The public static web surface (landing + legal pages) built by `web/build.mjs`; the owner deploys it. |
| `docs/` | All documentation: gates, ADRs, accessibility checklists, legal text, setup. |
| `scripts/` | Environment helper and operational scripts (env check, test databases, DB table counts). |
| `design-system/` | The owner's design system; colour values are never changed. |

The app and server are npm workspaces (`app`, `server`, `shared`) under one root `package.json`.

## Run it locally

Prerequisites: Node.js 22+, Docker Desktop, npm. Full details and troubleshooting are in
[docs/SETUP.md](docs/SETUP.md); the short form:

| Part | How | Address |
|---|---|---|
| Two PostgreSQL databases `db0` (global + shard 0) and `db1` (shard 1), Redis, mail catcher | `docker compose up -d` then `docker compose ps` | ports from `.env` (`DB0_PORT`, `DB1_PORT`, `REDIS_PORT`) |
| Environment | `node scripts/setup-env.mjs` creates `.env` and generates local secrets; it prints names, never values. `node scripts/setup-env.mjs --check` shows what is still empty. | — |
| API | `npm run dev --workspace @rowta/server` (watch) or `npm run start --workspace @rowta/server` | `http://localhost:3000`, health at `/health` |
| Worker | `npm run worker --workspace @rowta/server` (or `worker:dev`) | background jobs, cron |
| App | from the `app` folder: `npx expo start --web` for the web preview, or an Android development build | Expo dev server (typically 8081) |
| Static web surface | `npm run web:build` then `npm run web:serve` | `http://localhost:8321` (the port is configurable) |

The server and the app share secrets only through `.env`; nothing secret is ever committed. `.env.example` lists
every variable name.

### Test databases (server suite)

The server suite must never touch the development databases. It runs on throwaway copies — `rowta_db0_test`,
`rowta_db1_test` — and Redis index 15. One-time setup: `node scripts/db-create-test-databases.mjs`. The rule and
the guard are in [docs/decisions/0014-server-tests-isolated-databases.md](docs/decisions/0014-server-tests-isolated-databases.md);
the suite refuses to start if a target is not clearly a test target.

## Run the tests

Commands re-run on 28 October 2026 for this document (all exit 0 unless stated):

```powershell
node scripts/setup-env.mjs --check
node scripts/setup-env.mjs --audit-example
npm run check:hashing
npm test --workspace @rowta/server
npm run typecheck --workspace @rowta/server
npm run lint --workspace @rowta/server
npm run typecheck --workspace @rowta/app
npm run lint --workspace @rowta/app
npm run web:test
npm run app:test
```

- Server suite: real PostgreSQL and Redis on the test targets; `34` files and `298` tests at the verified
  run (28 Oct 2026, owner run). It runs through the isolation guard; do not run the live e2e-auth suite or the DB smoke
  scripts while the development stack is in use — they are write tests against a live stack.
- Web: `npm run web:test` (metadata, content safety, links, token pages, web-app button, button behaviour).
- App pure-logic scripts: `npm run app:test` (12 scripts: API client, auth machine, deep links, token store,
  teams store, and more).
- Static gates: the app lint command includes the UI-token gate (no hard-coded colours or sizes), the string
  gate (catalog keys only) and the accessibility lint gate. `npm run check:hashing` proves no banned hash
  algorithm is used.

## Phase status — only what the gate files prove

| Phase | Gate file | Status |
|---|---|---|
| 0 — Foundations (databases, schema, Prisma as query client, Hono server, worker, cron lock, mail) | [docs/gates/phase-0.md](docs/gates/phase-0.md), [docs/gates/phase-0-b.md](docs/gates/phase-0-b.md) | **Passed.** Health, shard split, test job through the worker, mail-catcher test, 55 tests at the time. |
| 1 — Design system, component kit, app shell | [docs/gates/phase-1.md](docs/gates/phase-1.md) | **Passed with an honest gap.** Tokens and component kit proven; screenshots are web renders — no Android emulator/device run. |
| 2 — Auth, server and app views | [docs/gates/phase-2.md](docs/gates/phase-2.md) | **Passed.** 13 `/auth/*` endpoints + countries, 17 files/124 tests at the server gate, live app e2e 45/45 × 3 runs. TalkBack device pass admitted as pending. |
| 3 — Teams, roles, invites, seat skeleton | [docs/gates/phase-3.md](docs/gates/phase-3.md) | **Mostly proven.** Permission matrix, Staff 403, team isolation, seat cap and the web invite deep link are PROVEN. Native Android deep link is **NOT PROVEN**. Server suite at this gate: 29 files/249 tests. |
| 4 — Shifts, calendar, activity feed, full-text search | [docs/gates/phase-4.md](docs/gates/phase-4.md) | Phase 4 built; server proven; app screens not yet verified (see gate file). |
| 5 — Swaps | [docs/gates/phase-5.md](docs/gates/phase-5.md) | Phase 5 built; server & pure-logic proven by owner test runs (28 Oct 2026; 34 files / 298 tests); app screens pending review (see gate file). |
| 11 — Web surface | [docs/gates/phase-11.md](docs/gates/phase-11.md) | **Passed with tooling limits.** Static build, metadata checks, axe 0 violations, Lighthouse accessibility 100. A human NVDA pass is **NOT PROVEN** (no screen reader on the build machine). |

Not started: Phases 6–10 and 12 (jobs/notifications/settings, billing, offline/dashboard, lifecycle,
system-design layers, load tests/delivery). Do not read a later phase as done because a table below it looks
complete.

### What that means in plain words

- Proven: the Phase 0–3 server behaviour, the auth app views, the Phase 3 team screens, and the public web
  build are covered by runnable tests or recorded evidence.
- Not proven: anything needing a real Android device or emulator (TalkBack, native deep links, the size matrix),
  a human screen-reader pass on the web, real payment provider traffic, and real email delivery. Those remain
  owner steps, named in each gate file.

## Web preview behaviour

The app can be previewed in a browser through Expo web:

- Access and refresh tokens are kept in memory only ([ADR 0013](docs/decisions/0013-web-tokens-memory-only.md)).
  A page reload signs you out; that is deliberate, not a bug.
- The "the web app is here" button on the static site exists only in development builds; production pages do
  not show it.
- The component gallery (every kit component in every state) opens only in development builds, behind the
  development tooling switch — never in a release build.

## Architecture decisions

Every decision with consequences has a numbered record in `docs/decisions/`:

| ADR | Decision |
|---|---|
| [0001](docs/decisions/0001-monorepo-npm-workspaces.md) | Monorepo layout: npm workspaces |
| [0002](docs/decisions/0002-prisma-query-client-two-databases.md) | Prisma as query client only; two databases, two generated clients |
| [0003](docs/decisions/0003-typescript-pin-typescript-eslint-peer.md) | TypeScript pinned to 6.0.3 for the typescript-eslint peer range |
| [0004](docs/decisions/0004-server-runtime-toolchain.md) | Server runtime and toolchain |
| [0005](docs/decisions/0005-design-direction.md) | Design direction: the owner's design system applied in the app |
| [0006](docs/decisions/0006-web-static-pre-render.md) | Web surface: static pre-rendered HTML with a small script |
| [0007](docs/decisions/0007-refresh-reuse-family-revoke.md) | Refresh-token replay revokes the whole family |
| [0008](docs/decisions/0008-magic-link-five-minutes.md) | Magic-link lifetime is 5 minutes (owner override) |
| [0009](docs/decisions/0009-job-side-secret-generation.md) | Codes and magic tokens are generated in the email job |
| [0010](docs/decisions/0010-timing-mirror-attempts-guard.md) | Timing parity for unknown-email branches |
| [0011](docs/decisions/0011-password-composition-rules.md) | Password composition rules |
| [0012](docs/decisions/0012-teams-sharded-data-and-permissions.md) | Teams, roles, invites and sharded-data permissions |
| [0013](docs/decisions/0013-web-tokens-memory-only.md) | Web build keeps tokens in memory only |
| [0014](docs/decisions/0014-server-tests-isolated-databases.md) | Server tests run on throwaway databases and a separate Redis keyspace |
| [0015](docs/decisions/0015-shifts-calendar-activity-and-search.md) | Shifts, calendar range, activity pagination and full-text search |
| [0016](docs/decisions/0016-swaps-state-machine-approval-and-concurrency.md) | Swaps state machine, approval atomicity, and concurrency guarantees |

## Where to look next

- To run the app: [docs/SETUP.md](docs/SETUP.md)
- To understand the database: [docs/DATABASE.md](docs/DATABASE.md), SQL in `server/prisma/sql/`
- To review a phase: the gate files above
- To read the products' legal pages: [docs/legal/](docs/legal/) (drafts pending owner/lawyer review)
- Accessibility checklists per screen: [docs/a11y/](docs/a11y/)
