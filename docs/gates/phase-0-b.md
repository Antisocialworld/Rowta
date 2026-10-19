# Phase 0 — Part B gate evidence

Date: 2026-10-19. Branch: `rowta-1`. Every claim below is backed by real output captured in this session.
Anything not run says "not verified".

## 1. Dependencies and toolchain

`npm install` from the repo root (workspaces) added 171 packages, 0 vulnerabilities.

Pinned exact versions in `server/package.json`:

| Package | Version | Why this version |
|---|---|---|
| hono | 4.13.13 | latest stable 4.x (`next` is 5.0.0-rc.1; PRD 9.1 allows Express but Hono is lighter and has built-in middleware we need) |
| @hono/node-server | 2.1.5 | pairs with hono 4.x |
| zod | 4.6.7 | latest 4.x |
| pino | 10.4.0 | latest |
| pino-pretty | 13.2.0 | dev-only transport |
| bullmq | 6.3.17 | latest stable (`release-v5.x` is 5.81.5; v6 connection rules verified below) |
| ioredis | 6.0.0 | latest |
| node-cron | 4.6.0 | latest; v4 API verified on the installed README |
| nodemailer | 10.1.7 | latest |
| typescript | **6.0.3** | npm `latest` is 7.0.2 but `typescript-eslint@8.71.2` peers `>=4.8.4 <6.1.0` — see ADR 0003 |
| eslint | 10.13.0 | latest |
| @eslint/js | 10.0.1 | latest published; `@eslint/js` has no 10.13.0 (npm ETARGET proved it) |
| typescript-eslint | 8.71.2 | latest, no v9 exists |
| vitest | 5.0.5 | latest 5.x |
| tsx | 4.23.15 | latest |
| @types/node | 26.6.5 | latest |
| @types/nodemailer | 8.0.2 | latest |
| prisma / @prisma/client / @prisma/adapter-pg | 7.10.1 | unchanged from part A (ADR 0002) |

## 2. Commands run, with results

```
npm run typecheck   # tsc --noEmit            -> 0 errors
npm run lint        # eslint .                -> 0 errors, 0 warnings
npm test            # vitest run              -> 10 files, 55 tests, 55 passed, 0 failed
node scripts/mail-test.mjs                    -> 4 PASS, exit 0
npx tsx scripts/server-smoke.mjs              -> 5 PASS, exit 0
node scripts/scan-name.mjs                    -> TOTAL fix=0 names=0 reportOnly=0
node scripts/setup-env.mjs --check            -> RESULT: ok
node scripts/setup-env.mjs --audit-example    -> OK: 50 names; every sensitive name empty
node design-system/verifyTokens.js            -> 391 JSON / 391 CSS / 0 errors
node scripts/check-ui-tokens.mjs              -> PASSED (13 files scanned)
```

## 3. Forbidden-pattern gates

| Gate | Command / method | Result |
|---|---|---|
| 1 banned hashing (sha256/sha-1/md5/hs256/hmac) | regex scan of `server/` + `scripts/` excluding `generated/`, `node_modules/` | **0 hits** |
| 2 banned auth phrases | regex scan of `server/src/**/*.ts` | **0 hits** |
| 3 tracked env files | `git ls-files` for `.env` | **no `.env` tracked** (only `.env.example`) |
| 5 token storage (localStorage/AsyncStorage) | regex scan of `server/src/**/*.ts` | **0 hits** |
| postgres:// literal leak | regex scan of `server/src`, `server/tests`, `scripts` excluding `generated/` | 6 hits, all in `server/tests/env-validation.test.ts` lines 29–34 — **obviously-fake test fixtures** (`postgresql://user:pass@localhost:...`) that exist to exercise the Zod shape check. No real credential. Documented exclusion. |
| ESLint floating promises (gate 6) | `@typescript-eslint/no-floating-promises` + `no-misused-promises` set to `error`, `projectService: true` | enabled and passing; the rule caught one real floating promise in `registry.ts` during development, which was fixed with an explicit `void` |

## 4. Env validation (skill section 1)

- `server/src/config/env.ts` is the only module that reads `process.env`.
- All 50 `.env.example` names are in the Zod schema. `tests/env-parity.test.ts` compares `ENV_NAMES` to the parsed `.env.example` names and asserts set equality — it passed.
- Errors name variables, never values: `tests/env-validation.test.ts` asserts a missing `DB0_PASSWORD` is named while `fake-db1-password` (a sibling value) does not appear in the message, and that a malformed `API_PORT` value is not echoed.
- Boot guard (P7): `assertNotProductionSimulator` throws when `NODE_ENV=production` and `PAYMENT_SIMULATOR_ENABLED=true`; runs at import time of `env.ts`, so no entry point can skip it. Covered by a test.
- Feature-gated group: `FLW_*` keys are optional in test mode, required when `PAYMENT_MODE=live` (superRefine), tested.

## 5. Logger and redaction (skill section 3, S9)

- `pino` with `redact: { paths: [...], censor: '******' }`. Paths cover top-level and one-level-down `password/token/secret/code/selector/verifier` fields plus `req.headers.authorization`, `req.headers.cookie`, `req.body.password` etc.
- `tests/redaction.test.ts` logs a fake password, token, secret and authorization header through `buildLoggerOptions('info')` piped to an in-memory Writable, and asserts the fake values never appear while ordinary fields (`requestId`, `status`, `userId`) do.
- `pino-pretty` only when `NODE_ENV !== 'production'`; production gets plain JSON.
- Source for the API: https://raw.githubusercontent.com/pinojs/pino/master/docs/redaction.md (fetched this session).

## 6. Request ID and error envelope (skill sections 3–4, S9, PRD 9.3)

- Wraps Hono's built-in `requestId` middleware (verified against the installed `hono@4.13.13` source at `node_modules/hono/dist/middleware/request-id/request-id.js`: it accepts an inbound `X-Request-Id` only when non-empty, within `limitLength`, and matching `/[^\w\-=]/` is absent; otherwise regenerates). We set `limitLength: 64` and `generator: randomUUID` from `node:crypto`.
- Request ID is set on the context, echoed in the `x-request-id` response header, and included in every error body by the single error handler.
- Error body shape: `{ "error": { "code", "message", "requestId" } }`. Success: `{ "data", "meta" }`.
- `tests/request-id.test.ts` covers: generation when absent, acceptance of a safe inbound ID (`req-ABC_123`), regeneration for unsafe (`bad id with spaces`) and over-long (200 chars) values, the 409 envelope carrying the ID, an unknown error becoming `generic.error` with the internal message absent from the response, and the 404 envelope.
- Status map in `codeForStatus`: 404 `not.found`, 413 `request.too_large`, 504 `request.timeout`, default `generic.error`. Verified that Hono's `timeout` middleware throws `HTTPException(504)` and `bodyLimit` throws `HTTPException(413)` by reading the installed middleware source.

## 7. Shard routing and data access (PRD 9.4–9.5, skill rowta-db-sharding-recipes)

- `shardFor(teamId)` = first 4 bytes of `blake2b512(teamId)` as big-endian uint32, modulo 2. Pure function, one file.
- `tests/shard-routing.test.ts`: only returns 0/1; deterministic across 50 UUIDs; **1000-UUID split printed as evidence: shard0=512, shard1=488** (both >= 400, i.e. >= 40%); no collisions across a 100-ID set; zero-UUID handled.
- `server/src/db/clients.ts` is the ONLY file that imports the generated Prisma clients (enforced by `tests/data-access.test.ts`, which scans every `.ts` file under `src/` and asserts the only importer is `db/clients.ts`). Exports `globalDb()`, `forTeam(teamId)`, `readDb(shard)`, `writeDb(shard)`, `closeAllDatabases()`.
- `readDb` returns the same client as `writeDb` today; PRD 9.4's `ryw:<userId>` 5s TTL layer is **deliberately not implemented** in part B and is recorded as a later-phase item.
- Clients are lazy: no connection is opened at import time.

## 8. Health (skill section 9)

- `GET /health` — public, touches no dependency, returns `{ data: { status: "ok", uptimeSeconds } }`. No versions, paths or secrets (asserted in `tests/health.test.ts` by regex against the serialised body).
- `GET /health/deep` — returns `{ data: { status, dependencies: [{ name, pass }] } }` for `redis`, `db0`, `db1`. Pass/fail booleans only; no host, URL, version or error text. Returns 200 even when degraded (documented rationale in the file: a 5xx would make an orchestrator kill a still-useful process).
- Live proof via `scripts/server-smoke.mjs` (boots the real `serve()` listener on a random port, real Redis + real Prisma clients):
  - `GET /health` -> `{"data":{"status":"ok","uptimeSeconds":8}}`
  - `GET /health/deep` -> `{"data":{"status":"ok","dependencies":[{"name":"redis","pass":true},{"name":"db0","pass":true},{"name":"db1","pass":true}]}}`
  - `GET /definitely-not-a-route` -> 404 `{"error":{"code":"not.found","message":"Not found.","requestId":"..."}}` with `x-request-id` header set.

## 9. BullMQ worker (skill rowta-jobs-worker-recipes sections 1–3, PRD 9.8)

- Six queues: `push`, `webhook`, `email`, `renewal`, `purge` (PRD 9.8) plus `foundation` (Phase 0 proof).
- Queue defaults (J1): 5 attempts, exponential backoff 1000 ms, `removeOnComplete: { age: 3600, count: 1000 }`, `removeOnFail: { age: 86400 }` (failed jobs kept for inspection). Asserted in `tests/bullmq.test.ts`.
- Connection rules, verified against https://docs.bullmq.io/guide/connections and the installed `bullmq@6.3.17`: **worker connections must set `maxRetriesPerRequest: null` or BullMQ throws at construction**; producer connections keep the ioredis default. Implemented in `createRedisConnection(forWorker)`.
- Job IDs: `jobId(name, epochSeconds)` produces `name-epoch` (e.g. `renewals-due-1760000000`); throws on a colon, and tests assert the result is not digits-only and contains no colon (skill section 3).
- End-to-end proof (`tests/bullmq.test.ts`): a real `Worker` consumes `foundation.ping` with the same processor the production worker registers; the job writes `foundation:ping:<uuid>` with TTL 120 s; the test polls Redis, observes the value, and asserts TTL is in (0, 120].
- Worker entry `server/src/worker/index.ts` is a separate process (`npm run worker`); wires one structured log line per attempt (queue, jobId, attempt, outcome, duration) and graceful shutdown: stop cron -> `worker.close()` (waits for in-flight) -> close queues -> close DBs -> exit.
- `server/src/index.ts` (the web server) does NOT import or start node-cron — only the worker does (skill section 10).
- Unhandled rejections and uncaught exceptions log `fatal` and exit 1 in both processes (C8).

## 10. Cron and Redis lock (skill section 4, J2)

- `CRON_REGISTRY` is one exported array: `{ name, schedule, lockKey, ttlSeconds, queue, jobName }`. Phase 0 ships `foundation-heartbeat` (`0 0 * * * *` = hourly at :00:00 UTC, lock `cron:lock:foundation-heartbeat`, ttl 300 s, queue `foundation`, job `heartbeat`).
- Each tick: `acquireLock` (`SET key token NX EX ttl`) -> if not acquired, return; else `queue.add` with `jobId(name, epoch)`, then `releaseLock` (compare-and-delete Lua script so a process never deletes a lock retaken by someone else).
- node-cron scheduled with `{ name, timezone: 'UTC', noOverlap: true }` (v4 API verified on the installed package README: `cron.schedule(expr, task, options) -> Task`, `task.destroy()`).
- `tests/cron-lock.test.ts`: two concurrent `acquireLock` on one key -> exactly one wins; released lock is reusable; a 1 s TTL expires and frees; `withLock` runs `fn` exactly once across two concurrent callers (flags `[false, true]`); `withLock` releases even when `fn` throws; registry entries use colon lock keys, six-field UTC schedules, and `jobId()` output passes the no-colon/not-digits rule; `startCron` registers one task per entry and `stopAll` destroys them.

## 11. Email through the catcher (PRD Q7, rule A13)

`node scripts/mail-test.mjs`:
```
PASS  Mailpit inbox cleared before the test
PASS  nodemailer accepted the message (accepted 1 recipient(s))
PASS  Mailpit received it: subject matches, 1 recipient(s)
PASS  test message deleted from Mailpit
MAIL TEST OK: SMTP delivery to the local catcher is working.
exit=0
```
- Sends via nodemailer to `SMTP_HOST:SMTP_PORT` (localhost:1025), then confirms via Mailpit's HTTP API on `MAILPIT_UI_PORT` (8025) by matching the unique subject. Prints only subject-match and recipient count, never a body.
- Mailpit API facts learned and used: `GET /api/v1/messages` lists; `DELETE /api/v1/messages` with body `{"IDs":[]}` clears all; single-message delete also goes through `DELETE /api/v1/messages` with `{"IDs":["<id>"]}` — **there is no `DELETE /api/v1/message/{id}` route** (verified against the Mailpit server route table at https://github.com/axllent/mailpit/blob/develop/server/server.go and by a 405 from the running v1.31.6 container).
- The script uses `node:http` with `agent: false` rather than `fetch()`: undici's keep-alive sockets trip a libuv assertion on Windows at `process.exit`, which made the exit code non-zero despite all checks passing. Switching removed it (exit 0 verified).

## 12. Live process proof

- Real API booted via `npm run start` (tsx) in the background: `GET /health` 200 `{"data":{"status":"ok","uptimeSeconds":8}}`; `GET /health/deep` 200 all three deps `pass: true`; `GET /nope` 404 with `x-request-id: eeac5d9d-...` header and `{"error":{"code":"not.found",...,"requestId":"..."}}` body. Process terminated afterwards.
- `npx tsx scripts/server-smoke.mjs` (in-process, repeatable): 5 PASS, exit 0 (see section 8 for the payloads).

## 13. Middleware order (skill section 2)

Documented as a numbered comment at the top of `server/src/index.ts` and implemented in that exact order:
1 request ID, 2 structured request log, 3 timeout (15 s), 4 body limit (256 KiB), 5 secure headers, 6 CORS allowlist (no wildcard, credentials on, `x-request-id` exposed), 7 rate limit (Phase 2 slot reserved), 8 auth + policy (Phase 2 slot reserved), 9 routes, 10 ONE error handler + 404 handler.

## 14. Not verified / deliberately out of scope for part B

- The `ryw:<userId>` read-your-own-writes cache (PRD 9.4) — not implemented, recorded as a later item.
- Rate limiting, authentication, the `can()` policy function — Phase 2 (skill sections 5–7); slots are reserved in the middleware order.
- Real processors for `push`/`webhook`/`email`/`renewal`/`purge` — later phases; the worker acknowledges any job landing on them with a log line.
- `docs/cron-registry.md` generation from `CRON_REGISTRY` — later phase (the array is the single source; the doc does not exist yet).
- Redis `INFO commandstats` measurement for the free-tier cost check (skill section 8) — Phase 6.
- Production TLS, real replica routing, Sentry wiring.
- Load / concurrency testing.
