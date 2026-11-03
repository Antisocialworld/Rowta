-- 063-pg-trgm-global.sql
-- Forward-only migration: pg_trgm extension and GIN trigram index for user display names.
-- Applies to global database: rowta_db0, rowta_db0_test (users table exists only on DB0).
-- PRD 8.4; ADR 0022.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram index for typo-tolerant fuzzy matching on user display names
CREATE INDEX IF NOT EXISTS users_display_name_trgm_idx ON users USING gin (display_name gin_trgm_ops);

