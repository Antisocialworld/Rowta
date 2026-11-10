-- 081-backfill-team-coverage.sql
-- Forward-only backfill: coverage_status on existing teams (db0 + db1, idempotent).
-- Apply to DB0 and DB1, after 078-team-coverage-columns.sql.
-- Every existing team gets coverage_status = 'covered', is_extra = false, extra_people = 0,
-- so existing teams behave exactly as today during the 14-day trial window.
-- Safe to run twice (UPDATE is idempotent with the same values).
UPDATE teams
SET coverage_status = 'covered',
    is_extra = false,
    extra_people = 0,
    coverage_updated_at = now()
WHERE coverage_status IS DISTINCT FROM 'covered'
   OR is_extra IS DISTINCT FROM false
   OR extra_people IS DISTINCT FROM 0;
