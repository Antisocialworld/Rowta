# 0004. Server runtime and toolchain (tsx, vitest, ESLint flat config, pino, BullMQ 6, node-cron 4)

Date: 2026-10-19 · Status: Accepted · Phase 0 part B

## Context

PRD 9.1 names Hono [DECISION], Zod, BullMQ, node-cron, nodemailer over SMTP and Prisma-as-query-client.
Phase 0 part B had to choose exact versions and a run/test/lint toolchain, then prove each choice.

## Decisions

### Runtime: `tsx` for dev, worker and start

`server/package.json` uses `tsx` (4.23.15) for `dev`, `start`, `worker` and `worker:dev`. `build` and
`typecheck` both run `tsc --noEmit`.

Reason: the two generated Prisma clients live in `server/prisma/generated/` as TypeScript with
explicit `.ts` import specifiers (Node 24 type stripping, proven in part A by `scripts/prisma-smoke.mjs`).
Compiling `src/` to `dist/` with `tsc` would move the entry points out of sync with the generated
clients' location, and bundling is a deployment-phase decision. Running TypeScript directly keeps
the runtime identical to what the tests exercise. A bundler (esbuild/tsup) will be chosen when a
deployment target exists.

### Test runner: Vitest 5.0.5

Native TypeScript, no transpile step, `fileParallelism: false` so integration tests sharing the
local Docker Redis/PostgreSQL run sequentially. `testTimeout`/`hookTimeout` 30 s to allow real
network round-trips.

### Linter: ESLint 10.13.0 + typescript-eslint 8.71.2, flat config, typed linting

`eslint.config.mjs` uses `defineConfig` with `js.configs.recommended` + `tseslint.configs.recommended`,
`languageOptions.parserOptions.projectService: true`, and promotes
`@typescript-eslint/no-floating-promises` and `no-misused-promises` to `error` (Phase 0 gate 6, C8).
`projectService.allowDefaultProject: ['eslint.config.mjs']` covers the config file itself.
Ignores: `prisma/generated/**` (introspected output), `dist/**`, `node_modules/**`.
The rule caught one real floating promise during development (`task.destroy()` in the cron registry),
fixed with an explicit `void` and a comment — evidence the gate works.

### HTTP framework: Hono 4.13.13 + @hono/node-server 2.1.5

PRD 9.1 marks Express acceptable but Hono is the listed default. Chosen for: built-in typed
middleware (`request-id`, `timeout`, `body-limit`, `secure-headers`, `cors`, `http-exception`) whose
behaviour was verified by reading the installed source, first-class ESM, and a small surface that
maps cleanly onto the required middleware order. No framework lock-in at the route level.

### Logger: pino 10.4.0 (+ pino-pretty 13.2.0, development only)

Structured JSON in production, pretty transport in development. Redaction is init-time config
(`redact: { paths, censor: '******' }`) per pino's own docs; a test logs fake secrets and asserts
they never appear. See `docs/gates/phase-0-b.md` section 5.

### Queue: BullMQ 6.3.17 (not 5.x)

Latest stable. Connection rules differ from v5 in one load-bearing way, verified against
https://docs.bullmq.io/guide/connections and the installed package: **worker connections must set
`maxRetriesPerRequest: null`** or construction throws. Producers keep the ioredis default.
`createRedisConnection(forWorker)` encodes this; `tests/bullmq.test.ts` boots a real Worker.

### Scheduler: node-cron 4.6.0 (v4 API)

v4 is a TypeScript rewrite; `cron.schedule(expr, task, { name, timezone, noOverlap })` and
`task.destroy()` verified on the installed README. Used only in the worker process, only when
`CRON_ENABLED` is true (J2). The distributed guarantee is our own Redis `SET NX EX` lock
(`src/cron/lock.ts`), not node-cron's optional Redis coordinator, so the lock semantics stay
identical in tests and in production.

### Email: nodemailer 10.1.7 over SMTP

PRD Q7 / rule A13. Development targets the local Mailpit catcher; `scripts/mail-test.mjs` proves
delivery end to end via Mailpit's HTTP API. Mailpit has no `DELETE /api/v1/message/{id}` route —
single deletes go through `DELETE /api/v1/messages` with `{"IDs":["<id>"]}` (verified against the
Mailpit server route table and a live 405).

**SUPERSEDED 22 Oct 2026 (owner decision):** Mailpit is removed. Email is nodemailer over the
owner's REAL SMTP provider; the automated tests capture mail in process and the real transporter
refuses to build under vitest; `scripts/mail-test.mjs` sends exactly ONE message to a recipient
given as an argument. The Mailpit facts above are kept only as the history of the Phase 0 gate.

## Consequences

- All versions are pinned exactly; bumping any one requires re-running typecheck, lint, tests, the
  mail test and the server smoke, plus updating this ADR if the reason for the pin changes.
- Deployment will need a bundler or Node type-stripping strategy; deferred to the deployment phase.
- BullMQ 6 and node-cron 4 APIs must be re-verified on any major bump.
