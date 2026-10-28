# Phase 3 gate — Teams, roles, invites, seat skeleton

State: **Phase 3 gate — Teams, roles, invites, seat skeleton.** Rows 1-4 are **PROVEN**. Row 5 is split:
**5a (WEB) PROVEN** by the owner's browser walkthrough (27-28 Oct 2026, Expo web on 8081 + real API on 3000,
two real accounts; evidence `docs/gates/evidence-web-address.txt` and `app/scripts/test-web-address.ts`);
**5b (NATIVE Android deep link) NOT PROVEN** — no native device/emulator run yet; the exact owner step is §4e.
Branch: `rowta-1`. Date: 2026-10-27 (Fix Round 2; original gate 2026-10-25, Part A re-run 2026-10-26). Full-build mode. Owner does all git work (P1).

Every claim below was produced by the command shown, on this machine, at gate time. "not verified" means exactly that.

---

## 1. Scope delivered

| Item | Where |
|---|---|
| Central permission policy engine (`can()`, `PERMISSION_MATRIX` as pure DATA, deny by default) | `server/src/security/policy.ts` |
| 12 endpoints: create team (idempotent), list/get teams, list/change/remove members, leave team, list/create/revoke invites, accept invite, team settings | `server/src/teams/service.ts`, `routes.ts` |
| 12 route rate limits with C/O fail modes (`team.create`, `teams.list`, `team.get`, `members.list`, `member.role`, `member.remove`, `member.leave`, `invites.list`, `invite.create`, `invite.revoke`, `invite.accept`, `team.settings`) | `server/src/security/limits.ts` |
| Shared Zod schemas + catalog error messages | `shared/src/teams.ts`, `shared/src/messages.ts`, `shared/src/constants.ts` |
| Database schema: `managers_can_revoke_invites` column on `teams` table applied to DB0 & DB1 | `server/prisma/sql/020-team.sql`, `server/prisma/db0/schema.prisma`, `server/prisma/db1/schema.prisma` |
| Seat cap enforcement: Starter tier hard cap = 5 active non-owner seats (Owner Decision 1, owner not counted), row locks (`FOR UPDATE`) on invite and accept | `server/src/teams/service.ts` (`getSeatCap`, `createInvite`, `acceptInvite`) |
| Selector.verifier invite tokens, 7-day TTL, Argon2id verifier hashing, cross-database search, dummy timing decoy (Rule A7) | `server/src/teams/service.ts`, `server/src/security/tokens.ts` |
| Automated reconciliation job: `repair-user-team-index` scheduled daily at 03:30 UTC (PRD 8.11) with dry-run support | `server/src/jobs/repair/user-team-index.ts`, `server/src/cron/registry.ts`, `server/src/worker/index.ts` |
| App client: `teamsApi` (12 endpoints), error mappings in `CODE_KEYS`, deep link invite handler | `app/src/lib/api.ts`, `app/App.tsx`, `app/src/state/auth-session.ts`, `app/src/i18n/en.ts` |

---

## 2. Static gates (run at gate time, exit 0)

| Gate | Command | Evidence |
|---|---|---|
| Server typecheck (strict) | `npm run typecheck --workspace @rowta/server` | `tsc --noEmit`, 0 errors, exit 0 |
| Server lint (flat config, floating-promise rule live) | `npm run lint --workspace @rowta/server` | `eslint .`, 0 errors, exit 0 |
| Full server test suite | `npm test --workspace @rowta/server` | **29 test files passed, 248 tests passed** (was 243; +5 added by the Part A fixes), exit 0 |
| App typecheck (strict) | `npm run typecheck --workspace @rowta/app` | `tsc --noEmit`, 0 errors, exit 0 |
| App lint (tokens, strings, a11y) | `npm run lint --workspace @rowta/app` | eslint clean; tokens scanned 103, strings scanned 61, a11y scanned 61; all gates passed, exit 0 (real output in `docs/gates/evidence-phase-3-part-b.txt`) |
| Banned algorithm scan | `npm run check:hashing` | 0 hits across 114 files, exit 0 |
| Env names check | `node scripts/setup-env.mjs --check` | `RESULT: ok` |
| `.env.example` audit | `node scripts/setup-env.mjs --audit-example` | `OK: 49 names … every sensitive name is empty` |
| Tracked env files | `git ls-files \| Select-String '(^\|/)\.env'` | only `.env.example` |

---

## 3. Database evidence

| Claim | Command | Evidence |
|---|---|---|
| Schema check | `node scripts/db-apply.mjs --check` | `skip 000-common.sql, 010-global.sql, 020-team.sql (already applied: public.teams exists)` |
| App role selftest, both DBs | `node scripts/db-as-app.mjs` | `selftest-app PASS counts: DB0=12 DB1=12`, 0 errors, exit 0 |
| Prisma smoke test | `node scripts/prisma-smoke.mjs` | both DB0 and DB1 clients read their own database; ledger append allowed, update/delete refused, exit 0 |

---

## 4. Evidence map — every Phase 3 requirement, one row, PROVEN or NOT PROVEN

Rows are the PRD section 12 Phase 3 gate items (lines 597-599) plus every behaviour the Phase 3 scope promises.
A requirement missing from the old table now appears here; anything unproven says NOT PROVEN and why.

### 4a. PRD section 12 Phase 3 gate rows

| # | Requirement (PRD 597-599) | Status | Evidence |
|---|---|---|---|
| 1 | Permission matrix tests pass | **PROVEN** | `tests/teams-permissions-matrix.test.ts` 26/26 (every role x action, PERMISSION_MATRIX as pure DATA) |
| 2 | A raw HTTP call as Staff to a forbidden endpoint returns 403 | **PROVEN** | `tests/teams-routes.test.ts` — `POST /teams/:teamId/invites` as Staff returns 403 `team.forbidden`; also Settings toggle as Staff 403 (new test) |
| 3 | Team isolation tests pass for every route that exists | **PROVEN** | `tests/teams-isolation.test.ts` 10/10 — 404 `team.notFound` on all 9 teamId-scoped routes (get team, list members, change role, remove member, leave, list invites, create invite, revoke invite, settings); queries without teamId throw (S7). The 3 non-teamId routes (create team, list teams, accept invite) are user-scoped and covered by their own suites |
| 4 | Starter cannot invite a sixth seat (owner not counted) | **PROVEN** | `tests/teams-concurrency.test.ts` — 6th invite returns 422 `team.seatLimit`; owner not counted (5-seat boundary proven both by invite and by accept) |
| 5a | Invite deep link lands in the right team — WEB (Expo web + real API) | **PROVEN** | Owner browser walkthrough 27-28 Oct 2026, Expo web on 8081 + API on 3000, two real accounts (emails masked): invite created as Owner; link opened in the browser; token parsed from `/invite/<token>`; automatic accept; outcome shown "You joined &lt;team name&gt;."; the new member appears on the Members screen with the correct role; role-based controls differ by role; a wrong-email account sees the uniform failure card with Dismiss; the token is stripped from the address bar after parsing. Evidence: `docs/gates/evidence-web-address.txt`, `app/scripts/test-web-address.ts` |
| 5b | Invite deep link lands in the right team — NATIVE Android (`rowta://` scheme and Android App Link on a device) | **NOT PROVEN** | No native device/emulator run yet. Only the web half is proven (row 5a). The exact owner step is §4e; the row stays NOT PROVEN until that passes. |

### 4b. Server behaviour requirements

| Requirement | Status | Evidence |
|---|---|---|
| 12 endpoints exist and respond (create team idempotent, list/get teams, list/change/remove members, leave, list/create/revoke invites, accept, settings) | **PROVEN** | `tests/teams-routes.test.ts` (36/36) — every route exercised over real HTTP |
| Idempotency: same key + same body replays original team | **PROVEN** | `tests/teams-routes.test.ts` (HTTP replay asserts same `id`) |
| Idempotency fingerprint allowlists ONLY `name`: a non-allowlisted extra field replays the original team (service level); the same extra field over HTTP is refused by the strict schema (`validation.unknown_field`) before idempotency | **PROVEN** | `tests/teams-routes.test.ts` new test `idempotency fingerprint allowlists only name` |
| Changing an allowlisted field with the same key → error. **Conflict flagged for owner:** the owner brief said 409; the PRD (496-497, 640) and the server return **422** `idempotency.fingerprint_mismatch` (409 is reserved for `idempotency.in_flight`). Kept 422 (PRD-compliant); server unchanged | **PROVEN** | `tests/teams-routes.test.ts` `Same key + different body is refused with 422`; PRD 496-497, 640 |
| Permission matrix enforced from pure DATA (`can()`, deny by default, no ad-hoc if-chains) | **PROVEN** | `server/src/security/policy.ts`; matrix suite 26/26 |
| Demotion takes effect on the very next request (S8: membership read per request, never from JWT) | **PROVEN** | `tests/teams-routes.test.ts` demotion test (invite immediately 403 after role change) |
| Owner-only operations: change role, toggle settings, remove Manager/Owner | **PROVEN** | `tests/teams-routes.test.ts` — role change 403 for Manager/Staff; settings 403 for Manager (and now Staff, new test) |
| Manager cannot remove another Manager | **PROVEN** | `tests/teams-routes.test.ts` `Manager cannot remove another Manager` → 403 `team.forbidden` |
| Manager cannot remove the Owner | **PROVEN** | `tests/teams-routes.test.ts` `Manager cannot remove the Owner` → 400 `auth.deleteOwner.blocked` (owner guard fires before `can()`, service.ts:349-351) |
| Owner cannot be removed or leave (single-owner rule) | **PROVEN** | `tests/teams-routes.test.ts` `Owner cannot be removed by anyone`, `Owner cannot leave the team`, `Owner role cannot be changed` (pre-existing; not duplicated) |
| Staff can leave and loses access immediately | **PROVEN** | `tests/teams-routes.test.ts` leave test (404 on next read) |
| Manager can invite Staff but not Manager (403) | **PROVEN** | `tests/teams-routes.test.ts` |
| Manager revoke permission honours `managers_can_revoke_invites` (true → revoke, false → 403; Manager invite always 403 for Manager, Owner always allowed) | **PROVEN** | `tests/teams-routes.test.ts` settings/revoke block |
| Invite acceptance: uniform `auth.link.invalid` for unknown selector, wrong verifier, wrong email, expired, revoked, reused | **PROVEN** | `tests/teams-routes.test.ts` — byte-identical message asserted for all six failure paths |
| Invite creation response identical whether the email exists or not (A6) | **PROVEN** | `tests/teams-routes.test.ts` byte-identical JSON text |
| Raw verifier never stored: invite row holds only Argon2id hash; no column contains the raw verifier | **PROVEN** | `tests/teams-routes.test.ts` (all columns scanned) |
| Invite email contains the canonical link `<PUBLIC_WEB_URL>/invite/<token>` (Owner Decision 3) | **PROVEN** | `tests/teams-routes.test.ts` — asserts `${env.PUBLIC_WEB_URL.replace(/\/+$/,'')}/invite/${token}` in the mail text (was only `/invite/` before) |
| Invite raw token never appears in the request logs (Owner Decision 3, S9) | **PROVEN** | `tests/teams-routes.test.ts` log-capture test (pino Writable): token and verifier absent from captured logs during create + accept |
| Seat cap code: exactly ONE code exists — `team.seatLimit` (422), returned by BOTH `POST /teams/:teamId/invites` (service.ts:478) and `POST /invites/accept` (service.ts:703). `team.seat_cap_reached` appears in ZERO files across server/, shared/, app/ | **PROVEN** | `Select-String team.seatLimit` / `team.seat_cap_reached` over server, shared, app (Fix 3 evidence below) |
| Race: concurrent accepts for the last seat serialize with row locks (exactly one 200, surplus 422) | **PROVEN** | `tests/teams-concurrency.test.ts` |
| Repair job `repair-user-team-index` (PRD 8.11): dry-run, real reconciliation, idempotent second run | **PROVEN** | `tests/teams-repair.test.ts` 3/3 |
| Cross-team access returns 404 never 403 (S7) | **PROVEN** | `tests/teams-isolation.test.ts` |
| Rate limits: 12 route limits with C/O fail modes registered | **PROVEN** | `server/src/security/limits.ts` (12 ids); fail-mode behaviour covered by `tests/auth-limits-validation.test.ts` patterns and the C/O tests |

### 4c. App-side Phase 3 items

| Requirement | Status | Evidence |
|---|---|---|
| `teamsApi` client (12 endpoints) + `CODE_KEYS` mappings + deep-link invite plumbing + Accept-invite view + team management UI | **PROVEN** | `app/src/lib/api.ts` (12 routes), `app/App.tsx` (deep-link handler using `consumeInviteToken`), `app/src/state/auth-session.ts` (consumeInviteToken), `app/src/state/teams.ts` + `app/src/state/teams-view.ts` (zustand stores), `app/src/screens/teams/` (TeamListScreen, CreateTeamScreen, MembersScreen, InviteScreen, InviteResultCard); app typecheck + lint pass; app test scripts **55/55** and **22/22** passed (real output in `docs/gates/evidence-phase-3-part-b.txt`). Row 5a (web deep link) is **PROVEN** by the owner's browser walkthrough; row 5b (native) remains **NOT PROVEN**; see §4e for the owner walkthrough. |

### 4d. Seat-cap error-code search output (Fix 3 evidence)

Real output of a search for `team.seatLimit` and `team.seat_cap_reached` across `server/`, `shared/`, `app/`
(excluding `node_modules` and tests):

```
=== team.seatLimit (server/shared/app) ===
server\src\teams\service.ts:478: throw new HttpError(422, 'team.seatLimit', 'Seat limit reached.');
server\src\teams\service.ts:703: throw new HttpError(422, 'team.seatLimit', 'Seat limit reached.');
shared\src\messages.ts:21: 'team.seatLimit': 'Seat limit reached.',
app\src\i18n\en.ts:52: 'team.seatLimit': 'Seat limit reached.',
app\src\lib\api.ts:112: 'team.seatLimit': 'team.seatLimit',

=== team.seat_cap_reached (server/shared/app) ===
(no matches)
```

**Conclusion: only ONE code exists — `team.seatLimit` (HTTP 422)**, thrown by BOTH routes that can exhaust the
cap: invite creation (`createInvite`, service.ts:478) and invite acceptance (`acceptInvite`, service.ts:703).
There is no second code; `team.seat_cap_reached` appears in zero files. An earlier report that claimed two codes
or the `team.seat_cap_reached` name was wrong — no such symbol was ever written.

### 4e. Manual walkthrough for row 5b (NATIVE Android deep link — NOT PROVEN — owner step)

This is the only remaining proof for row 5b (the web half, row 5a, is already PROVEN by the owner's
browser walkthrough of 27-28 Oct 2026). Do **not** flip 5b to PROVEN until every step passes on a real
Android device or emulator with the development build. The unit script uses a mocked API and cannot prove the
native deep link, the real server, or the device hand-off.

1. Prepare two accounts: A (owner or manager of a team) and B (a different person, signed in on the device).
   B must not already be in the team.
2. As A, invite B's test email from the Invite screen. Confirm the email arrives with an
   `https://…/invite/<token>` link. The token is a secret (A3/S1): never paste it into a ticket, chat or log.
3. On the device signed in as B, open the link. The app must come to the foreground and run the automatic
   accept. Expected: the result card says "You joined <team>." and the team appears in the list.
4. Open a fresh link while signed in as the WRONG account: expected the ONE uniform failure line
   ("This invitation can't be used. …"), never a specific reason (A5/A6). Repeat with a revoked and an expired
   invite: the same line.
5. Disable the network, open a fresh link: expected the retry state; the token survives for the retry. Restore
   the network, press Retry, expected joined.
6. Record device model, Android version, app build, date and the result of steps 3–5 here. Only then change
   row 5b to PROVEN (and update ADR 0012's status).

## 5. Final Phase 3 gate rows (PROVEN or NOT PROVEN only)

| # | PRD section 12 row | Status |
|---|---|---|
| 1 | Permission matrix tests pass | **PROVEN** |
| 2 | A raw HTTP call as Staff to a forbidden endpoint returns 403 | **PROVEN** |
| 3 | Team isolation tests pass for every route that exists | **PROVEN** |
| 4 | Starter cannot invite a sixth seat (owner not counted) | **PROVEN** |
| 5a | Invite deep link lands in the right team — WEB (Expo web + real API, owner walkthrough) | **PROVEN** |
| 5b | Invite deep link lands in the right team — NATIVE Android (device hand-off) | **NOT PROVEN** |
