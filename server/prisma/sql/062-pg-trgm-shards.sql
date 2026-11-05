-- 062-pg-trgm-shards.sql
-- Forward-only migration: pg_trgm extension and GIN trigram indexes for typo-tolerant team search.
-- Applies to shard databases: rowta_db0, rowta_db1, rowta_db0_test, rowta_db1_test.
-- PRD 8.4; ADR 0022.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram indexes for typo-tolerant fuzzy matching on shifts
CREATE INDEX IF NOT EXISTS shifts_label_trgm_idx ON shifts USING gin (label gin_trgm_ops);
CREATE INDEX IF NOT EXISTS shifts_notes_trgm_idx ON shifts USING gin (notes gin_trgm_ops);

-- Expression trigram index for typo-tolerant fuzzy matching on activity events label
CREATE INDEX IF NOT EXISTS activity_label_trgm_idx ON activity_events USING gin (((data ->> 'label')) gin_trgm_ops);

