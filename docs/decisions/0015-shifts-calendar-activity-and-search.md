# 0015. Shifts, calendar range, activity pagination and full-text search

Date: 2026-10-28. Status: accepted (agent decision, Phase 4 built; server proven; app screens not yet verified; owner to confirm).
Applies to Phase 4 server routes (`server/src/shifts/`), shared schemas (`shared/src/shifts.ts`), and app UI.

## Problem

Phase 4 (PRD 6.1, 8.3, 8.4, 12) introduces shifts, the 14-day/monthly calendar, cursor-paginated activity feed,
and cross-entity full-text search over roster members, shift details and activity events. Four concrete design
decisions were required to implement these specifications securely and robustly:
1. Calendar range maximum limit and interval overlap semantics.
2. Idempotency guarantees for shift creation.
3. Full-text search implementation and ranking without external dependencies or breaking migrations.
4. Activity feed keyset pagination, same-timestamp tie-breaking, and fast-scroll de-duplication.

## Decisions

### 1. Calendar range maximum (42 days) and overlap query semantics

- **Cap:** The `GET /teams/:teamId/shifts` calendar range query enforces a maximum interval of **42 days**
  (`CALENDAR_RANGE_MAX_DAYS = 42`). An over-range query is rejected with HTTP 422 (`shift.range.tooLong`).
  Why 42 days: exactly 6 weeks, covering any standard 5-week or 6-week calendar grid view month plus leading/trailing
  days, preventing unbounded range scans that could burn database memory.
- **Overlap semantics:** The server matches shifts that **overlap** the requested window:
  `starts_at < to AND ends_at > from`
  rather than shifts wholly enclosed within the window.
  Why: a shift starting before midnight (e.g., 23:00 on Sunday) and ending Monday morning (07:00) must appear on the
  calendar when Monday is viewed.

### 2. Idempotency-Key required on shift creation

- **Rule:** `POST /teams/:teamId/shifts` requires an `Idempotency-Key` header (400 `idempotency.missing` if absent).
  The server computes a SHA-256-free blake2b512 request fingerprint and records an entry in `idempotency_keys`
  scoped to `create_shift:<teamId>:<userId>`.
- Replaying the same key with an identical payload returns the cached shift response with identical payload.
- Replaying the same key with a different payload returns 422 `idempotency.fingerprint_mismatch`.
- Why: network retries on mobile networks frequently re-submit POST requests. Requiring an idempotency key guarantees
  that network retry never produces accidental duplicate shifts.

### 3. Full-text search via PostgreSQL tsvector and prefix ILIKE ranking

- **Search index:** Uses the existing schema of record (`020-team.sql`) with generated `tsvector` columns on
  `shifts.search` and `activity_events.search`, indexed with PostgreSQL GIN (`shifts_search_idx`, `activity_search_idx`).
- **Typo tolerance:** PRD 8.4 mentions "typo-tolerant ranking [VERIFY]". Enabling `pg_trgm` requires `CREATE EXTENSION`
  which modifies database configuration. Instead of an uncoordinated migration, typo tolerance is approximated using
  `simple` dictionary `tsvector` with `ts_rank_cd` and a case-insensitive prefix fallback. Prefix matches on member
  names rank first. True trigram fuzzy search is deferred as an owner decision for a later phase.
- **Soft-delete exclusion:** Search strictly filters `deleted_at IS NULL` for shifts and roster members.

### 4. Activity feed keyset cursor pagination and client fast-scroll gating

- **Cursor:** Opaque URL-safe base64 encoding of `{ t: ISO8601, id: UUID }`.
- **Query order:** Strict `(created_at DESC, id DESC)` tie-breaking using row comparison:
  `(created_at, id) < (cursor_t, cursor_id)`
  This guarantees that multiple activity events sharing the exact same microsecond timestamp across a page boundary
  are neither duplicated nor omitted.
- **Client de-duplication:** `createPagingGate` and `canRequestNextPage` (`app/src/lib/shift-feed.ts`) ensure that
  bursts of `onEndReached` triggers from rapid flick-scrolling serialize into exactly one in-flight request,
  and `mergeActivityPages` de-duplicates incoming events by ID.

## Consequences

- Calendar queries cannot exceed 42 days; callers wanting broader historical views must paginate or query multiple windows.
- Fast scrolling on the activity feed consumes minimal network traffic and cannot fire duplicate requests.
- All Phase 4 database queries leverage existing composite and GIN indexes in `server/prisma/sql/020-team.sql` without schema changes.
- All Phase 4 operations remain team-scoped (rule S7) and enforce the central permission matrix (rule S6).

