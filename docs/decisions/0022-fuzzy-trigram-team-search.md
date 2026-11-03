# 0022. Typo-tolerant team search via PostgreSQL pg_trgm and tiered ranking

Date: 2026-11-03. Status: accepted.
Applies to team search (`GET /teams/:teamId/search`, `server/src/shifts/service.ts`), shard databases, and global database.

## Problem

Rowta's search modal operates in real time as the user types (with a 300 ms debounce pause). Users on mobile devices frequently make typos (e.g. "alise" for "alice", "shfit" for "shift", "mornig" for "morning"). PRD section 8.4 specifies full-text search with typo-tolerant ranking. The initial search implementation relied solely on PostgreSQL `tsvector` with `simple` dictionary and substring `ILIKE`, which cannot match misspelled words or character transpositions.

However, an initial attempt using `word_similarity >= 0.20` across all text fields (including notes) and 3-character queries produced severe false positives: at 0.20, nearly any word sharing two leading letters matched. Furthermore, `word_similarity` produced identical scores for legitimate typos and unrelated words (e.g. "shfit" vs "Shift" and "Shower duty" both scored 0.3333). In addition, casting `id::text = ANY(...)` on the global `users` table disabled primary key index scans.

## Measured Facts (PostgreSQL 16 `pg_trgm`)

The following measurements were taken directly from the real database running PostgreSQL 16 with `pg_trgm`:

| Query | Target String | Function | Measured Score | Note |
|---|---|---|---|---|
| `'shfit'` | `'Shift'` | `word_similarity` | `0.3333` | 1-character transposition |
| `'shfit'` | `'Shower duty'` | `word_similarity` | `0.3333` | Substring overlap with "Sh" |
| `'alise'` | `'Alice'` | `word_similarity` | `0.5000` | 1-character substitution |
| `'alise'` | `'Alex Manager'` | `word_similarity` | `0.3333` | Substring overlap with "Al" |
| `'mornig'` | `'Morning Shift'` | `word_similarity` | `0.7143` | 1-character omission |
| `'shfit'` | `'Shift'` | `similarity` | `0.2000` | Full-string trigram similarity |
| `'shfit'` | `'Shower duty'` | `similarity` | `0.1250` | Full-string trigram similarity |

## Alternatives Considered

1. **`tsvector` dictionary search only:**
   - Pros: Built-in, zero extensions.
   - Cons: Lexeme-based indexing cannot resolve typos (e.g., "shfit" does not match "shift", "alise" does not match "alice"). Fails mobile typo tolerance requirements.

2. **`ILIKE '%...%'` substring matching only:**
   - Pros: Simple substring containment.
   - Cons: Fails immediately when any character is misspelled, transposed, or omitted.

3. **Vector (embedding) search:**
   - Pros: Semantic similarity.
   - Cons: Explicitly rejected by PRD 8.4 ("Vector (embedding) search is NOT built, because it adds an embedding provider, cost, and a second index to keep consistent"). Introduces external network dependencies and latency unsuitable for real-time keystroke search.

4. **PostgreSQL `pg_trgm` extension with GIN trigram indexes (`gin_trgm_ops`):**
   - Pros: Native PostgreSQL extension; GIN trigram indexes serve the ILIKE contains branch; function-call fuzzy branch (`word_similarity`) is not index-served but evaluates over pre-scoped candidate rows; supports both string `similarity()` and substring `word_similarity()`; no external services.
   - Cons: Requires `CREATE EXTENSION pg_trgm` and forward migrations.

## Decision

We adopt **PostgreSQL `pg_trgm`** with strict fuzzy thresholds, field boundaries, and a two-stage similarity tie-break:

1. **Thresholds (`FUZZY_MIN_QUERY_LENGTH = 4`, `FUZZY_WORD_SIMILARITY_THRESHOLD = 0.3`):**
   - Fuzzy matching is active ONLY when `char_length(q) >= 4`.
   - Queries of 2–3 characters stay prefix/contains only (fast, strict, zero fuzzy noise).
   - `word_similarity(q, target) >= 0.3`:
     - Why not 0.2: 0.20 allowed almost any word sharing 2 letters to match, flooding results with irrelevant records.
     - Why not 0.4: 0.40 would reject valid 5-letter transpositions like "shfit" $\to$ "Shift" (0.3333).
     - 0.30 reliably captures 1-character transpositions, omissions, and substitutions on strings with 4+ characters.

2. **Field Boundaries (Exclusion of Notes):**
   - Fuzzy matching applies ONLY to:
     - `users.display_name`
     - `shifts.label`
     - `activity_events.data ->> 'label'`
   - `shifts.notes` is EXCLUDED from fuzzy matching. Notes contain long narrative text where trigram matching generates noise; notes remain cleanly searched via `search @@ plainto_tsquery('simple', q)` and `notes ILIKE %q%`.

3. **Two-Stage Tie-Break in Fuzzy Ranking:**
   - `word_similarity` measures similarity against substrings, giving "Shift" and "Shower duty" identical scores of 0.3333 for query "shfit".
   - Full string `similarity()` evaluates the entire token: `similarity('shfit', 'Shift') = 0.20`, whereas `similarity('shfit', 'Shower duty') = 0.125`.
   - Result ordering within the fuzzy tier:
     1. `word_similarity DESC`,
     2. `similarity() DESC` (breaks substring ties in favour of true word matches),
     3. Final sort key (`display_name ASC`, `starts_at DESC`, `created_at DESC`).

4. **Tiered Ranking Order:**
   - Results within each section (members, shifts, activity) are ranked in 4 strict tiers:
     1. Exact match (`lower(target) = lower(q)`),
     2. Starts-with prefix match (`lower(target) LIKE lower(escapedPrefix)`),
     3. Substring contains match (`lower(target) LIKE lower(escapedContains)` or `tsvector` match),
     4. Typo-tolerant fuzzy match (ordered by `word_similarity DESC`, then `similarity() DESC`).
   - Exact matches always precede partial matches; partial matches precede fuzzy typo matches.

5. **Primary Key Optimization on Global Users:**
   - Replaced `WHERE id::text = ANY(${memberIds})` with `WHERE id = ANY(${memberIds}::uuid[])`.
   - Casting the column `id::text` previously prevented index usage and forced a full table scan of `users` on every keystroke. Casting the parameter array `${memberIds}::uuid[]` allows PostgreSQL to perform an indexed primary key lookup.
   - `id::text` is retained in the `SELECT` list for application type safety.

6. **Index Usage Clarification:**
   - Standard GIN indexes with `gin_trgm_ops` accelerate `ILIKE '%...%'` contains operations and regex matching.
   - Function calls like `word_similarity(...) >= 0.3` are NOT directly served by the GIN index without operators.
   - However, all search queries are already strictly scoped to the team:
     - `shifts` and `activity_events` filter by `team_id = ${teamId}::uuid AND deleted_at IS NULL`.
     - `users` filters by `id = ANY(${memberIds}::uuid[])` where member IDs are pre-fetched from active team memberships.
   - Performance of evaluating `word_similarity` over the team-scoped candidate set is not measured; verify later with EXPLAIN (ANALYZE, BUFFERS) on seeded data.
   - Future optimization note: PostgreSQL supports the `<%` word similarity operator, which can be indexed by `gin_trgm_ops` if combined with `SET LOCAL pg_trgm.word_similarity_threshold = 0.3`.

## Verification

- Verified type safety via `npm run typecheck --workspace @rowta/server`.
- Verified formatting and lint rules via `npm run lint --workspace @rowta/server`.
- Test suite in `server/tests/fuzzy-search.test.ts` updated with:
  - 2-char and 3-char queries receive no fuzzy matches.
  - `shifts.notes` receives no fuzzy matches.
  - "shfit" ranks "Shift" ahead of "Shower duty" via `similarity()` tie-breaker.
