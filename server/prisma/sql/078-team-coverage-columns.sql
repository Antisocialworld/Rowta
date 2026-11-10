-- 078-team-coverage-columns.sql
-- Forward-only migration: coverage columns on teams (db0 + db1, idempotent).
-- Apply to DB0 and DB1, after 020-team.sql.
-- These columns cache the coverage status computed by applyCoverage() so every request
-- reads the team row instead of crossing databases. Defaults keep every existing team
-- behaving exactly as today (coverage_status = 'covered' means no gate blocks anything).
ALTER TABLE teams ADD COLUMN IF NOT EXISTS coverage_status text NOT NULL DEFAULT 'covered';
ALTER TABLE teams ADD COLUMN IF NOT EXISTS extra_people integer NOT NULL DEFAULT 0;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS is_extra boolean NOT NULL DEFAULT false;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS coverage_updated_at timestamptz NOT NULL DEFAULT now();

-- App role grants for the new columns come through ALTER DEFAULT PRIVILEGES (030);
-- explicit GRANTs for the new tables are in 079.
