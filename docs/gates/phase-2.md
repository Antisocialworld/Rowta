# Phase 2 gate — auth: 13 `/auth/*` endpoints + the app views (Prompts 6, 6b, 7)

State: **passed** — server slice (Prompt 6 + the Phase 2b fixes: reworked A7 timing with a
strict ≤ 1.25 ratio on all three failure-path pairs after the same-day ADR 0010 decoy-row
escalation, 9 concurrency tests over 10 rounds each, failure-modes table) **and** app views
(Prompt 7: AuthPage on the real API, secure-store token store, TanStack Query, deep links,
45/45 live e2e × 3 runs, 10 web screenshots). The Phase 1 session stub is now fully dead
code (P7 guard kept, `app/src/state/session.ts`). Remaining Phase 2 items listed in §12:
the `/magic` + `/invite` web fallback pages (next small task) and on-device passes.
Branch: `rowta-1`. Date: 2026-10-20. Full-build mode. Owner does all git work (P1).

Every claim below was produced by the command shown, on this machine, at gate time. "not verified"
means exactly that.

## 1. Scope delivered

| Item | Where |
|---|---|
| Sign-up with code, verify, resend (uniform A6 answers, 5-minute code, 60-second cooldown) | `server/src/auth/service.ts`, `routes.ts` |
| Sign-in (dummy-hash A7 timing, needsRehash upgrade, unverified and pending-deletion handling) | same |
| Refresh rotation with guarded reuse detection → family revoke (ADR 0007) | same |
| Logout (family revoke, idempotent) and logout-all (all tokens + devices) | same |
| Forgot → verify → reset (10-minute single-use grant, sessions killed) | same |
| Magic request → consume (5-minute link, owner override ADR 0008, token in URL fragment) | same |
| Shared Zod schemas + catalog messages | `shared/src/auth.ts`, `shared/src/messages.ts`, `shared/src/constants.ts` |
| 18 rate limits on the 14 routes (13 auth + `countries.read`; IP/email/IP+email/token/device/user keys, C/O fail modes) | `server/src/security/{limits,rate-limit}.ts` |
| `GET /auth/countries` (locale-sorted code+name list; empty in prod until Q12 seeds) | `server/src/auth/routes.ts`, `shared/src/auth.ts` |
| Email jobs: codes/tokens generated job-side (ADR 0009), nodemailer over SMTP, Mailpit-verified | `server/src/jobs/email/`, `server/src/mail/` |
| Argon2id module, selector.verifier tokens, HS512 access tokens | `server/src/security/{argon2,tokens,access-token}.ts` |
| Timing parity: unknown branches run the attempts-guard statement against seeded decoy rows (ADR 0010, 2b fix + same-day escalation) | `server/src/auth/service.ts` (`verifyCode`, `verifyResetCode`), `server/src/auth/timing-decoy.ts` |
| Concurrency evidence: conditional-UPDATE guards proven under races (2b fix) | `server/tests/auth-concurrency.test.ts` |
| **App: API client + authApi (14 endpoints), `ApiError` with `retryAfterSeconds`** | `app/src/lib/api.ts` |
| **App: token store (secure-store on device, in-memory on web), single-flight refresh, platform wiring** | `app/src/lib/{token-store,single-flight,token-platform}.ts` |
| **App: auth-session store (restore, refresh, sign-out, logout-all, deep-link entry), `AuthContext`** | `app/src/state/{auth-session,auth-context}.ts` |
| **App: all 10 auth views on authApi + CodeStep countdown/live-region choreography** | `app/src/screens/auth/*.tsx`, `CodeStep.tsx` |
| **App: `rowta://` deep-link parser (4 shapes) + App.tsx Linking listener → AUTH_ENTRY** | `app/src/lib/deep-links.ts`, `app/src/App.tsx` |
| **Live e2e: 45/45 assertions × 3 runs against real server + Mailpit** | `app/scripts/e2e-auth.ts` |
| **Web screenshots: 5 states × 2 viewports, real server flows** | `app/scripts/capture-web-auth-live.mjs` |

## 2. Static gates (run at gate time, exit 0)

| Gate | Command | Evidence |
|---|---|---|
| Server typecheck (strict) | `npm run -w @rowta/server typecheck` | `tsc --noEmit`, 0 errors |
| Server lint (flat config, floating-promise rule live) | `npm run -w @rowta/server lint` | `eslint .` 0 errors, 0 warnings |
| Full server suite | `npm run -w @rowta/server test` | **Test Files 17 passed, Tests 124 passed** (re-run at app-views gate time: Prompt 6 slice + cors/sessions + 9 concurrency + 3 timing + 1 decoy test + the `GET /auth/countries` addition), exit 0. Historic: 123 passed at the 2b gate (before countries) |
| Env names | `node scripts/setup-env.mjs --check` | `RESULT: ok` — 50 names |
| `.env.example` secrets empty | `node scripts/setup-env.mjs --audit-example` | `OK: 50 names … every sensitive name is empty` |
| Tracked env files | `git ls-files \| Select-String '(^|/)\.env'` | only `.env.example` |

## 3. Database evidence (no schema change this slice)

| Claim | Command | Evidence |
|---|---|---|
| DB0 owner selftest | `Get-Content server\prisma\sql\selftest.sql -Raw \| docker compose exec -T db0 psql -U rowta -d rowta_db0 -v ON_ERROR_STOP=1` | `SELFTEST COMPLETE (transaction rolled back)`, 0 ERROR |
| DB1 owner selftest | same on db1 | `SELFTEST COMPLETE`, 0 ERROR (global-table checks SKIP — shard-only) |
| App role, both DBs | `node scripts/db-as-app.mjs` | `selftest-app PASS counts: DB0=12 DB1=12`, 0 errors |
| No DDL touched | SQL files unchanged since Phase 0; selftests above are the standing proof | — |

Test fixture note: `countries`/`currencies` ship empty (PRD 5, Q12 seeds them in Phase 7 with cited
sources). The auth tests insert their own `ZZZ`/`ZZ` rows (codes that appear in no selftest and no
future ISO seed) and remove them in teardown — `pending_signups.country` also references
`countries`, so teardown deletes those rows too (found when the db0 selftest's "unknown country"
check saw the fixture; after the fix the suite leaves all three tables empty and the selftest passes).

## 4. Behaviour evidence (selected, full detail in the six test files)

| Claim | Test | Result |
|---|---|---|
| Unknown email and wrong password are byte-identical 401s (A5) | `auth-flows.test.ts` | pass — compared after requestId blanking |
| Sign-up answer identical for new, unknown-format and already-registered addresses (A6) | `auth-flows.test.ts` | pass — byte-identical; the registered case additionally sends a notice email to the address itself |
| 5 attempts, then even the correct code fails; `attempts == 5` in the row (A9) | `auth-flows.test.ts` | pass |
| Resend inside 60 s: same bytes, cooldown TTL not restarted (A9) | `auth-flows.test.ts` | pass |
| Rotation: replay of a used token revokes the whole family, child included (A11, ADR 0007) | `auth-sessions.test.ts` | pass |
| Logout idempotent `{"data":{}}`; logout-all revokes everything + deletes devices | `auth-sessions.test.ts` | pass |
| Forgot/reset: 10-minute single-use grant; reset kills every session; grant replay and expiry share one generic 401 body | `auth-reset-magic.test.ts` | pass |
| Magic link: uniform request, one winner, 5-minute wording in the email (ADR 0008), expired ≡ replayed body | `auth-reset-magic.test.ts` | pass |
| Seven forged/broken access-token variants → the SAME generic 401 (A4) | `auth-flows.test.ts` | pass — HS256/expired/none/tampered/missing/Basic/garbage |
| Rate-limit walk: exactly 30×401 then 429 with Retry-After and catalog text; counter shared across two app instances; X-Forwarded-For cannot mint a bucket when no proxy is trusted | `auth-limits-validation.test.ts` | pass |
| Fail-closed (dead Redis → generic 503) on sign-in; fail-open on logout only | `auth-limits-validation.test.ts` | pass |
| All 13 routes: 422 with field-level catalog codes, never raw Zod text; malformed JSON → 400 `request.malformed` | `auth-limits-validation.test.ts` | pass (logout-all accepts `{}` — its only input is the access token) |
| No password, code, token, email or `$argon2id$` in the request log; every stored secret is PHC; subjects carry no digits | `auth-security.test.ts` | pass |

## 5. A7 timing (rule A7; full write-up in `docs/SECURITY.md` §5, design in ADR 0010)

Method (Phase 2b): failure-path pairs, 60 runs per side ALTERNATED in one loop, first 5 discarded
(n=55 each, ≥ 50 required), medians and max/min ratio printed; strict assertions — ratio ≤ 1.25 and
≥ 5 ms floor on BOTH paths (the floor fails the build if a dummy verify is ever removed).

`npx vitest run tests/auth-security.test.ts --silent=false` (from `server/`), exit 0, 8/8 tests
(7 original + the `A7 timing decoys (ADR 0010 escalation)` proof), AFTER the same-day decoy-row
escalation:

```
[A7 sign-in unknown-vs-wrong] A(unknown) 38.1ms vs B(wrong) 38.8ms, ratio 1.02 (n=55 each after discarding 5, alternating)
[A7 sign-in correct-password] median 84.6ms (n=55; longer by design: issues refresh verifier + JWT)
[A7 verify-code unknown-vs-wrong] A(unknown) 49.3ms vs B(wrong) 48.5ms, ratio 1.02 (n=55 each after discarding 5, alternating)
[A7 reset-code unknown-vs-wrong] A(unknown) 48.3ms vs B(wrong) 52.2ms, ratio 1.08 (n=55 each after discarding 5, alternating)
```

Before/after record (all runs are real evidence and kept so each step is auditable):

| Stage | sign-in | verify-code | reset-code |
|---|---|---|---|
| Phase 2 (old pair: known+CORRECT vs unknown, n=50) | 124.5 vs 49.4 ms — retired as the wrong pair | not measured | not measured |
| 2b first rework (failure pairs, before the mirror fix) | 49.7 vs 51.8 ms, ratio 1.04 ✅ | 50.9 vs 64.7 ms, ratio 1.27 ❌ | 45.7 vs 62.0 ms, ratio 1.36 ❌ |
| 2b after ADR 0010 zero-row mirror | 44.6 vs 44.6 ms, ratio 1.00 ✅ | 51.8 vs 60.4 ms, ratio 1.17 ✅ | 52.1 vs 61.0 ms, ratio 1.17 ✅ |
| 2b same-day re-measure (baseline shrank ~52 → ~40 ms) | not re-measured (no change to that path) | 44.9 vs 53.8 ms, ratio 1.20 ✅ (borderline, standalone) | 48.0 vs 59.6 ms, ratio 1.24 ✅ standalone / **1.28–1.35 ❌ in full suite** |
| 2b after ADR 0010 decoy-row escalation | 38.1 vs 38.8 ms, ratio 1.02 ✅ | 49.3 vs 48.5 ms, ratio 1.02 ✅ | 48.3 vs 52.2 ms, ratio 1.08 ✅ |

The failed ratios had one structural cause: the known path runs the A9 attempts-guard conditional
UPDATE (one or two extra DB round-trips ≈ 14–16 ms) the unknown path had no row for — a real, if
minor, existence oracle on the code endpoints. The 2b fix mirrored that guard on the unknown
branches with the same statement shape against a random id (zero rows, no write); the same-day
re-measure showed the zero-row mirror equalised the round-trip but NOT the matched write (~11–14 ms
matched vs ~3.5 ms miss; reset-code also pays an extra findFirst ≈ 3.5 ms) while the Argon2id
baseline shrank, growing the ratio to ~1.24 — jitter then crossed 1.25 in the full suite. The
owner-authorized escalation ran instead of ever loosening the tolerance: the unknown branches now
target SEEDED decoy rows (`server/src/auth/timing-decoy.ts` — one per guard table plus the FK user;
emails without `@`, rejected by the shared email field; attempts cycles 0–4 inside the statement;
random-id mirror as fallback when the seed cannot run). The decoy test in `auth-security.test.ts`
proves the probes MOVE the decoy counters (a zero-row mirror would not). Sign-in — the classic A7
endpoint — needed no change (its known path does no write on failure).

## 6. Concurrency evidence (2b fix; `server/tests/auth-concurrency.test.ts`, 9 tests × 10 rounds)

Every scenario races real HTTP/service calls against the live Docker PostgreSQL and asserts the
POST-RACE ROW STATE, naming the DB mechanism that serialises the race. All 10 rounds of every
scenario passed (no double-success found anywhere — no production fix was needed):

| Race | Mechanism asserted | Outcome (10/10 rounds each) |
|---|---|---|
| Magic consume, 2-way | conditional `UPDATE … consumed_at IS NULL` (row lock serialises; only the first sees the token unconsumed) | exactly one 200; loser's 401 body byte-identical (`auth.link_invalid`); exactly ONE refresh row, one family |
| Magic consume, 8-way | same | exactly one 200, seven byte-identical 401s; one row, one family |
| Reset grant, 2-way | conditional UPDATE clearing `grant_selector` WHERE NOT NULL | one 200, one 401; the WINNER's password is the only one that signs in; the loser's password never works; the code cannot be used again |
| Sign-up verify, 8 concurrent CORRECT codes | conditional attempts++ + `SELECT … FOR UPDATE` users + unique-email, one transaction | one 200, seven 401s; exactly one users row; pending row deleted; same code re-verify fails (single use) |
| Sign-up verify, 8 concurrent WRONG codes | conditional attempts++ guard (`WHERE attempts < 5`) | zero successes; `attempts == 5` exactly — the cap holds under a race |
| Reset verify, 8 concurrent CORRECT codes | conditional consume UPDATE | exactly one grant; row consumed once; code single use |
| Reset verify, 8 concurrent WRONG codes | attempts guard | zero grants; `attempts == 5` exactly |
| Refresh rotation, 2-way (ADR 0007) | guarded `UPDATE … used_at IS NULL AND revoked_at IS NULL` in a transaction; loser's zero-row UPDATE → `RotationLost` → `revokeFamily` | one 200 + one 401 every round; ZERO live tokens in the family (forced re-login); exactly one child ever created |
| logout-all vs refresh | unconditional `updateMany` (logout-all) vs guarded UPDATE (refresh) — every interleaving ends revoked | logout-all always 200; refresh 200-or-401 (never 5xx); zero live tokens AND zero live children every round; when refresh wins, its child is already dead (re-refresh → 401) |

`clearRateKeys()` runs before every round so the 17 limits never starve a scenario; fixtures are
inserted directly (no Mailpit waits). The suite logged only redacted fields (`code: ******`).

## 7. Failure modes (Redis / SMTP / database)

The C/O letters in the rate-limit registry are FAIL MODES of the limiter itself, not of the endpoint:

| Dependency down | What happens | Why | Verified by |
|---|---|---|---|
| Redis down, C-mode limit (every limit EXCEPT `logout.user` — sign-in, sign-up, codes, forgot, reset, magic, refresh…) | Request blocked with the **generic 503 `service.unavailable`** — fail CLOSED, no limit arithmetic is skipped | Credential and email endpoints must never run unbounded when the counter is unavailable; the attacker gains nothing (every probe 503s) | `auth-limits-validation.test.ts` — dead Redis on sign-in → 503 (asserted) |
| Redis down, O-mode limit (`logout.user` only) | Log a warning and **proceed** — fail OPEN | The limit only throttles logout of an already-authenticated user; blocking it would lock people out of revoking sessions for no security gain | `auth-limits-validation.test.ts` — fail-open on logout (asserted) |
| Redis down, resend cooldown | Cooldown helper fails OPEN (`cooldownSeconds → 0`), but the per-email C-mode request limits around it still fail closed — abuse stays bounded | The cooldown is a UX nudge layered ON a hard limit; the hard limit is the security control | Design + the C-mode assertion above; the cooldown-fails-open path itself is code-path (see note) |
| SMTP / Mailpit down | The **HTTP request still answers 200/identical bytes**: the request path only ENQUEUES (ADR 0009) and never touches SMTP; the BullMQ worker retries the send job | C2: uniform response regardless of mailbox state; the job owns delivery | Code-path (request handlers contain no SMTP import) + job retry behaviour from the worker slice. NOT verified by deliberately stopping SMTP in this run — labelled honestly |
| Database down | Generic 500 through the single error handler (no stack, no SQL text in the body); rate limiter and logger keep working | One error handler, envelope only (Phase 0 foundation) | Phase 0 error-handler tests + code-path; NOT re-run with a killed DB in this run — labelled honestly |
| Timing jitter on a noisy machine | A pair's ratio could exceed the 1.25 band | The structural component (write-vs-zero-row) was removed by the decoy-row escalation; what remains is scheduler/GC noise, not a security change; floors (≥ 5 ms) remain the defect detector | ADR 0010 residual risks; re-measure before touching code → escalation executed 20 Oct 2026 (ratios now 1.02 / 1.02 / 1.08) |

## 8. Forbidden-pattern scans (skill `rowta-gate-checks` section 5; re-run after the 2b fixes)

| Gate | Result |
|---|---|
| 1. Banned hashing strings | Hits, all disclosed, none new from 2b: `server/src/security/access-token.ts:3` (comment stating HS512-only and that HS256 is rejected); `server/tests/auth-flows.test.ts:337/338/351` (negative tests that FORGE an HS256/`none` token with jose purely to prove the server rejects it); gate/progress docs describing this very scan (`phase-0-b.md:52`, `phase-1.md:45`, `phase-2.md` §4/§8, `BUILD-PROGRESS.md:129`, plus `AGENT-PROMPT.md` which the skill excludes by name); the owner's planner files `rowta-scaffold*` (documented exclusion since Phase 0). No use of a banned algorithm anywhere. Note: the skill's literal root-wide `Get-ChildItem -Recurse` walk times out on this machine (node_modules tree) — re-run scoped to `server/src`, `server/tests`, `shared`, `app/src`, `scripts`, `web/src`, `docs`, which covers every file the exclusion list targets; recorded as a method note, results above. |
| 2. Banned auth phrases | No new hits from 2b: only the disclosed set — Prisma-generated model comments (37 files, generated-code exclusion); `server/src/jobs/email/processor.ts:56` (a code comment); `server/src/mail/templates.ts:73/84/154/162` — the A6 **notice email** ("…an account already exists") sent only to the address itself while the HTTP answer stays byte-identical (asserted). The 2b files (`service.ts` mirror comments, `auth-concurrency.test.ts`) add zero hits. |
| 3/3b. Secrets + env script | Secret scan: hits are test-fixture passwords in test files (same disclosed class as `auth-flows`/`auth-limits-validation`/`env-validation` fixtures from Prompt 6 — fake, test-only strings, never credentials), including 5 lines in the NEW `auth-concurrency.test.ts`/timing fixtures; `prisma/generated` comment; the documented fake `postgres://` fixtures in `tests/env-validation.test.ts:29–34`; planner files. No real credential anywhere. `--audit-example` 50 names all empty; `--check` ok (`RESULT: ok`). |
| 4. Tracked env files | only `.env.example` |
| 5. Tokens in AsyncStorage | n/a — no app code changed this slice (scan empty anyway) |
| 6. Lint/floating promises | `npm run -w @rowta/server lint` 0 problems (§2); typecheck 0. App chain also run this session: `npm run -w @rowta/app lint` exit 0 (eslint + UI TOKEN GATE PASSED 74 files + STRING GATE PASSED 41 + A11Y GATE PASSED 41) after the owner-approved narrow px exception for `server/src/mail/` (DISCLOSURE in BUILD-PROGRESS, for owner ratification; probes: `node scripts/test-ui-tokens-gate.mjs` 4/4) |
| 7. Hard-coded colours in components | empty (app untouched this step; re-run for the record) — and a hex colour in `server/src/mail/` still fails the UI-token gate (probe-proven) |
| 8. Hard-coded user text | 2 hits, both code COMMENTS containing `->` (Card.tsx:3, AuthPage.tsx:83) — not user-visible JSX; acceptable |

## 9. App views evidence (Prompt 7; 2026-10-20)

All commands run from `app/` unless noted. Server + worker + Mailpit + Expo web were started for
the live runs and stopped afterwards (docker containers left running as found).

### 9a. Live end-to-end (`node scripts/e2e-auth.ts` via `npm exec --workspace @rowta/app -- tsx scripts/e2e-auth.ts`)

**45/45 PASS, three consecutive runs (exit 0).** Evidence file (run #2):
`docs/gates/evidence-phase-2-app-e2e.txt`. The harness starts against the real server on
`127.0.0.1:3000`, uses Mailpit's HTTP API and `pg` directly.

| Flow | Assertions proven |
|---|---|
| Countries | `GET /auth/countries` returns seeded `ZZ`/`ZZZ` fixtures; 422 `validation.country` when signup names an unseeded code (`XX`) |
| Sign-up + verify | signup → Mailpit code (content-predicate match, not just newest mail) → verify → access+refresh tokens; resend path (cooldown cleared) delivers a second code |
| Sign-in | signed-in via returned tokens; `GET /auth/me` round trip (`{userId, displayName}`) |
| Refresh rotation | refresh returns a NEW refresh token; old token replay → 401 `auth.refresh_invalid` + whole family revoked (ADR 0007) |
| Uniform failures (A5/A6) | wrong password and unknown email → byte-identical `auth.failed`; forgot-password same answer for known and unknown addresses |
| Unverified prompt | sign-in of unverified account → `{message}` prompt branch + codeTimer meta; verify-same-account then signs in |
| Forgot → reset | full loop: forgot → code → verify → grant → new password → sign in with it |
| Magic link | request → token from Mailpit → consume returns tokens; second consume → `auth.link_invalid` (single use) |
| Logout / logout-all | signOut clears local tokens and answers `auth.not_authenticated` afterwards; signOutAll revokes every family |
| 429 | `signin.ip` limit hit → `rate.limited` with integer `retryAfterSeconds` in the envelope |
| Token persistence | token store round trip (secure-store shim on Node) |

Notes recorded during the run: rate-limit + cooldown keys (`rl:*`, `cooldown:*`) are cleared at
harness start (dev hygiene, mirrors the server tests' `clearRateKeys`); the unverified-user fixture
is seeded with the server's own `hashSecret` (Argon2id) and a direct `INSERT … email_verified_at
NULL` because sign-up does not create `users` rows; cleanup best-effort removes run users in
`finally`.

### 9b. Web screenshots (10 files, `node scripts/capture-web-auth-live.mjs`)

`docs/ui-matrix/auth-{sign-in,create-account,verify-code,forgot-password,reset-code}-{360x800,1280x800}-web-render-not-android-p2.png`
— 5 states × 2 viewports, reached via REAL server submissions (country sheet driven by
`data-testid="country-row-ZZ"`). Captures are web-render, clearly suffixed `-p2` so the Phase 1
files stay intact; NOT Android (the PRD 6.3 size matrix remains the later emulator run).

### 9c. App static + pure suites (all exit 0)

| Command | Result |
|---|---|
| `npm run -w @rowta/app typecheck` | 0 errors (`tsc --noEmit`; `allowImportingTsExtensions` + `noEmit` added for the shared-workspace `.ts` imports) |
| `npm run -w @rowta/app lint` | exit 0 — eslint + UI TOKEN GATE (74 files) + STRING GATE (41) + A11Y GATE (41) |
| `npm exec --workspace @rowta/app -- tsx scripts/test-token-store.ts` | 36/36 |
| `npm exec --workspace @rowta/app -- tsx scripts/test-api-client.ts` | 12/12 |
| `npm exec --workspace @rowta/app -- tsx scripts/test-auth-session.ts` | 24/24 |
| `npm exec --workspace @rowta/app -- tsx scripts/test-auth-machine.ts` | 20/20 |
| `npm exec --workspace @rowta/app -- tsx scripts/test-deep-links.ts` | 22/22 |
| `npm exec --workspace @rowta/app -- tsx scripts/test-auth-entry-paths.ts` | 11/11 |
| `npm exec --workspace @rowta/app -- tsx scripts/test-session-guard.ts` | 2/2 |
| `node scripts/test-ui-tokens-gate.mjs` | 4/4 (Option 1 probes) |

## 10. ADRs and docs written with this slice

`docs/decisions/0007-refresh-reuse-family-revoke.md`, `0008-magic-link-five-minutes.md`,
`0009-job-side-secret-generation.md`, `0010-timing-mirror-attempts-guard.md`;
`docs/SECURITY.md` §4 threats 1, 2, 7 and §5 timing (rewritten for the 2b method and numbers).
App-side additions this slice: `docs/a11y/auth-page.md` (TalkBack checklist, device pass pending),
`docs/gates/evidence-phase-2-app-e2e.txt`.

## 11. Honest gaps

| Gap | Why |
|---|---|
| `/magic` and `/invite` web fallback pages (PRD 8.1) | deliberately deferred to the next small task (web surface); the deep-link PARSER and the `AUTH_ENTRY.invite` → acceptInvite path are app-side done and tested |
| On-device TalkBack / NVDA / Android size matrix | no emulator or device on this machine (same standing gap as Phase 1); checklist written with procedure in `docs/a11y/auth-page.md`; standing evidence = a11y lint gate + machine tests + web captures |
| `rowta://` deep-link routes on a real device / Android App Links | App Links intent filters deferred to Phase 12 (need the real domain + `assetlinks.json`); parser + entry mapping proven headlessly (22/22 + 11/11) |
| Rate-limit walk on a real multi-instance deployment (two Node processes behind one Redis) | proven with two in-process Hono instances sharing one Redis — the same counters, not two OS processes |
| Timing numbers on production hardware | laptop numbers; the floor assertion, not the absolute value, is the gate |
| Web token store | in-memory only (never localStorage) — by design for the preview surface; the real app uses secure-store. A persisted web store needs a web-build decision (A11) |

## 12. Forbidden-pattern re-scan after the app-views slice

The §8 scans were re-run scoped (`app/src`, `app/scripts`, `server/src`, `server/tests`, `shared`,
`scripts`, `web/src`) after Prompt 7 landed:

| Gate | Result |
|---|---|
| 1. Banned hashing | only the disclosed server-side set (§8) plus `scripts/hash-assets.mjs:2` — a comment stating the icon pipeline uses BLAKE2B512 digests and "never SHA-256, rule A2/A4" (the literal match is the rule name inside the prohibition itself). The app's only cross-workspace crypto import is `hashSecret` (Argon2id) in `app/scripts/e2e-auth.ts`. No banned algorithm anywhere. |
| 2. Banned auth phrases | disclosed set (§8) plus 2 hits in `app/scripts/e2e-auth.ts:329/331` — a code comment and a test-label string describing the A5 uniformity assertion ("wrong password → auth.failed"); neither is a user-facing auth answer (answers come from the catalog). |
| 3/3b. Secrets + env | fixture-password class as §8; `--audit-example` 50 names all empty; `--check` ok (`RESULT: ok`); tracked env files: only `.env.example`. |
| 5. Tokens in AsyncStorage | empty — the app has no AsyncStorage at all; tokens live in secure-store (device) / memory (web). |
| 6. Lint/floating promises | app lint exit 0 (eslint + UI TOKEN GATE 74 + STRING GATE 41 + A11Y GATE 41); server lint exit 0; both typechecks 0. |
| 7. Hard-coded colours | UI TOKEN GATE green (covers `app/src` + `server/src` with the disclosed `server/src/mail/` px exception). |
| 8. Hard-coded user text | STRING GATE green (catalog only). |

---

Server-slice sections 2–8 below are unchanged from the Prompt 6/6b gate and remain the
standing evidence for the server side.
