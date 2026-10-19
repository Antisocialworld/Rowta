---
name: rowta-shifts-swaps-search-recipes
description: "Use when building Rowta shifts, the calendar, the activity feed, full-text search, swap requests, or the restricted-state rules: shift creation with team-safe constraints, activity events in the same transaction, swap state machine and approval, search over roster, shifts and activity."
---

# rowta-shifts-swaps-search-recipes

Part of the Rowta method. Scope: PRD 8.3, 8.4, 8.5, 8.6 (restricted state); rules S7, D2, D4, C3, C4, C7. SQL features are [VERIFY] on the installed PostgreSQL.
Code here is a PATTERN: check every library call against current documentation [VERIFY] before using it, and never paste real secrets (rule S1).

## 1. Shifts
- Columns and constraints per PRD 7.2: `CHECK (ends_at > starts_at)` and a composite foreign key (team_id, assigned_user_id) to memberships so a cross-team assignment is impossible. Code inside the transaction also rejects assigning a removed member.
- Every create, edit, delete and swap writes an `activity_events` row in the SAME transaction.
- Delete is soft (`deleted_at`, `deleted_by`); the data-access layer hides deleted rows by default (D4).
- Calendar endpoint: shifts for a date range with a configured maximum range; Zod-validated ISO 8601 with offset (V4). Staff see the team roster and shifts; only Owner and Manager mutate.

## 2. Activity feed (use recipe 3.9 in `rowta-data-recipes`)
Cursor `(created_at, id)`, opaque and validated; tampered cursor gives 422; index `(team_id, created_at DESC, id DESC)`. Seed 10,000+ fake events with a repeatable seed, capture `EXPLAIN (ANALYZE, BUFFERS)` before and after the index and save both (see `rowta-db-sharding-recipes`). Test: five rows with one identical timestamp straddling a page boundary give no skip and no duplicate.

## 3. Full-text search (PRD 8.4, decided: normal text search)
- PostgreSQL `tsvector` columns (or generated columns) with a GIN index over roster display names, shift labels and notes, and activity text [VERIFY syntax]. Always team-scoped and permission-filtered; deleted shifts excluded.
- Query with a parser safe for user input (for example the web-search style query function) [VERIFY], with ranking. Typo tolerance is NOT provided by full-text search alone; the common addition is the trigram extension [VERIFY availability]. Decide in an ADR whether to add it; do NOT build vector search.
- Index creation is a migration applied to BOTH databases (D8). Rate-limit the endpoint.
- The roster name is `users.display_name` (V8); never search or show emails of other members.

## 4. Swaps (PRD 8.5)
States `pending` then `approved`, `rejected` or `cancelled`.
| Step | Rule |
|---|---|
| Request | by the shift's assignee, optional target colleague; `Idempotency-Key` required; partial UNIQUE (shift_id) WHERE status = 'pending' enforces one pending swap per shift |
| Cancel | by the requester while pending |
| Decide | Owner or Manager only (Staff gets 403); in ONE transaction: lock the swap row (FOR UPDATE), confirm it is still pending, reassign the shift (target must be an active member of the same team), write the activity event, enqueue notifications |
App side: optimistic update with rollback and an announced error (recipe 3.7); the button is busy and disabled visually and in accessibility state.

## 5. Restricted subscription state (PRD 8.6)
When the subscription is `restricted`, block creating or editing shifts, issuing invites and approving swaps (members can still view). Enforce in ONE guard used by those routes and test each blocked action plus the lifted state after payment (see `rowta-payments-recipes`).

## 6. Tests (Phases 4 and 5 gates)
Same-timestamp pagination; the four list states in the app; no duplicate requests on fast scrolling (show the request log); soft-deleted shifts hidden; swap state machine; second pending swap rejected by the database; forced failure shows rollback and an announced error; cross-team shift assignment impossible.

## 7. Mistakes to avoid
An activity event written outside the transaction; a swap approved twice; a search query without the team ID; a hard delete; trusting the client to say who may approve.
