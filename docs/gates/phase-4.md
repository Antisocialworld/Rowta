# Phase 4 gate — Shifts, calendar, activity feed, full-text search

State: **Phase 4 BUILT. Server rows PROVEN (isolated server suite). App screens NOT PROVEN until the owner has seen them.**
Every row below states PROVEN or NOT PROVEN backed by named tests and evidence files produced on this machine.

Branch: `rowta-1`. Date: 2026-10-28. Full-build mode. Owner does all git work (P1).

Scope source: PRD 6.1 (shift calendar, shift detail, create/edit shift, activity feed, roster with search),
8.3 (shifts, calendar, cursor feed, four app list states, atomic activity, soft delete), 8.4 (team-scoped
PostgreSQL full-text search over roster names, shift labels/notes and activity), PRD 4 (permission matrix) and
PRD 12 Phase 4 gate (lines 600–602).

---

## 1. PRD section 12 Phase 4 gate rows

| # | Requirement (PRD 600–602) | Status | Evidence that proves it |
|---|---|---|---|
| 1 | Same-timestamp pagination test: five events share one timestamp across a page boundary; no skip, no duplicate | **PROVEN** | `server/tests/shifts-activity.test.ts` ("five events sharing one timestamp across page boundaries — no duplicate and no gap over every page"); 31 files / 270 tests passed |
| 2 | `EXPLAIN (ANALYZE, BUFFERS)` before and after the feed index, on 10,000+ seeded fake rows, plans saved | **PROVEN** | `server/scripts/explain-phase4.ts` output in `docs/gates/evidence-phase-4-explain.txt` (Seq Scan 5.663 ms -> Index Only Scan 0.232 ms; buffer hits 234 -> 2) |
| 3 | The app shows all four list states: loading, empty, error with retry, populated | **NOT PROVEN** | built; pure-logic tests passed; screen render not observed. Owner step: run the app on web or an emulator and view each state (loading, empty, error with retry, populated) |
| 4 | Fast scrolling produces no duplicate requests (request log shown) | **PROVEN (simulated)** | `app/scripts/test-shift-feed.ts` (13/13 passed) and request log in `docs/gates/evidence-phase-4-app.txt` (35 trigger events, 3 sent, 7 dropped in-flight, 25 dropped at end-of-list, 0 duplicate cursor requests). Real physical Android device is **NOT PROVEN** (honest gap, owner step 1) |
| 5 | Soft-deleted shifts are hidden by default everywhere | **PROVEN** | `server/tests/shifts-activity.test.ts` ("hides a soft-deleted shift from detail, calendar and search but keeps the feed event") |

## 2. Server behaviour rows

| Requirement | Status | Evidence that proves it |
|---|---|---|
| Create shift (Owner/Manager) writes the shift and one `activity_events` row in the same transaction | **PROVEN** | `server/tests/shifts-activity.test.ts` create test + direct activity row check |
| Edit shift and delete shift (soft delete) each write activity atomically | **PROVEN** | `server/tests/shifts-activity.test.ts` (update and delete tests; soft delete sets deleted_at/deleted_by) |
| Activity rollback: a forced failure after the shift write leaves no shift change and no activity row | **PROVEN** | `server/tests/shifts-activity.test.ts` rollback test (forced activity insert error leaves shift unchanged) |
| Calendar range endpoint enforces a maximum range (42 days) and returns only the caller's team, not deleted | **PROVEN** | `server/tests/shifts-activity.test.ts` (42-day cap 422 `shift.range.tooLong`, overlap semantics, team isolation 404) |
| Activity feed: opaque cursor, order `(created_at DESC, id DESC)`, row comparison, limit bounds | **PROVEN** | `server/tests/shifts-activity.test.ts` (cursor tests, malformed cursor 400 `activity.cursor.invalid`) |
| Search: team-scoped full-text over roster names, shift labels/notes, activity; deleted shifts excluded; result shapes obey permissions | **PROVEN** | `server/tests/shifts-activity.test.ts` (full-text search over roster/shifts/activity; min length 422; deleted excluded) |
| Idempotency on shift create: same key + same allowlisted body replays the original; different body 422; missing key 400 | **PROVEN** | `server/tests/shifts-activity.test.ts` (missing key 400, replay identical 200, mismatch 422 `idempotency.fingerprint_mismatch`) |
| Permission matrix: Owner/Manager allowed, Staff 403 `team.forbidden` on create/edit/delete; all roles may read | **PROVEN** | `server/tests/shifts-activity.test.ts` (Manager allowed, Staff 403 on create/update/delete) + `teams-permissions-matrix.test.ts` |
| Team isolation: every new route returns 404 for a team the caller does not belong to | **PROVEN** | `server/tests/shifts-activity.test.ts` (404 on calendar, detail, create, update, delete, activity, search) |
| Rate limits: every new route has an explicit id and fail mode in `server/src/security/limits.ts`; no route without one | **PROVEN** | `server/tests/shifts-limits.test.ts` (all 7 shift routes registered with named limit and auth) |
| Uniform error envelope; no secret, token or email in logs | **PROVEN** | `server/tests/redaction.test.ts` + `shifts-activity.test.ts` |
| Shared Zod schemas are `.strict()` and reject unknown fields for every new form | **PROVEN** | `server/tests/shifts-activity.test.ts` (unknown field 422 `validation.unknown_field`) |

## 3. App rows

| Requirement | Status | Evidence that proves it |
|---|---|---|
| Shift calendar screen with range navigation and all four list states | **NOT PROVEN** | built; pure-logic tests passed (`app/scripts/test-shift-time.ts` 19/19 passed); screen render not observed. Owner step: run the app on web or an emulator and view each state |
| Shift detail screen, role-aware controls from the server's `role`/permission answer | **NOT PROVEN** | built; pure-logic tests passed (`app/scripts/test-shift-access.ts` 7/7 passed); screen render not observed. Owner step: run the app on web or an emulator and view each state |
| Create/edit shift form (Owner/Manager), Zod shared schema, inline field errors | **NOT PROVEN** | built; pure-logic tests passed (`app/scripts/test-shift-nav.ts` 25/25 passed); screen render not observed. Owner step: run the app on web or an emulator and view each state |
| Activity feed infinite scroll, pull to refresh, end-of-list state | **NOT PROVEN** | built; pure-logic tests passed (`app/scripts/test-shift-feed.ts` 13/13 passed); screen render not observed. Owner step: run the app on web or an emulator and view each state |
| Roster with search (search screen/tab) | **NOT PROVEN** | built; pure-logic tests passed; screen render not observed. Owner step: run the app on web or an emulator and view each state |
| No duplicate pagination requests on fast scrolling (fetching guard + query de-duplication) | **PROVEN (simulated)** | `app/scripts/test-shift-feed.ts` (13/13 passed) and request log in `docs/gates/evidence-phase-4-app.txt` (35 trigger events, 0 duplicates); physical device run **NOT PROVEN** |
| Token gate, string gate, a11y gate pass; no colour change | **PROVEN** | `npm run lint --workspace @rowta/app` output (0 errors, 0 warnings; 117 token files, 72 string files, 72 a11y files passed) |
| TalkBack checklist for the new screens saved in `docs/a11y/phase-4.md` (device pass is an owner step) | **PROVEN** | `docs/a11y/phase-4.md` exists and is complete; physical TalkBack pass is **NOT PROVEN** (owner step 1) |

## 4. Non-goals (explicitly out of Phase 4)

- Swaps (Phase 5), notifications (Phase 6), Dashboard (Phase 8), offline cache (Phase 8), billing (Phase 7).
- Embedding/vector search (PRD Q2: decided against).
- Native Android device runs (no device/emulator on this machine; owner step, marked NOT PROVEN).

## 5. Owner steps for the rows that stay NOT PROVEN

1. Run the app on web (`npm run app:web` or expo web) or an Android emulator/device and view each screen and all four list states (loading, empty, error with retry, populated). Repeat the TalkBack and fast-scroll checks (checklist in `docs/a11y/phase-4.md`).
2. Verification on DEV databases: The Phase 4 SQL schema is already present in `server/prisma/sql/020-team.sql`
   (applied during Phase 0). No schema migration or DDL changes are required for DEV.
