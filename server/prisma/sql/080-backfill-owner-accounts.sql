-- 080-backfill-owner-accounts.sql
-- Note: Reads db0 teams only and includes all deleted teams (including those outside the restore window); for existing data use the backfill-owner-accounts script instead.
-- Forward-only backfill: owner_accounts + owner_team_registry for existing teams (db0, idempotent).
-- Apply to DB0 only, after 075-077. Safe to run twice and on empty databases (INSERT ... ON CONFLICT DO NOTHING).
-- Creates one owner_accounts row per existing team creator (status 'trialing', 14-day trial, trial_used=true)
-- and one owner_team_registry row per existing team (status 'active', is_extra=false).
-- Existing teams and members are grandfathered for the 14 trial days; trial limits apply only to
-- NEW teams and NEW people. When the owner later subscribes, applyCoverage recalculates is_extra
-- from creation order (first 2 teams free, 3 on yearly; rest extra).
-- No card data, no personal data beyond user_id/team_id already in the database.
-- Does not touch users, memberships, subscriptions, or any other existing data.

-- owner_accounts: one row per user who created at least one team.
INSERT INTO owner_accounts (
  user_id, plan, status, trial_started_at, trial_ends_at, trial_used,
  period_start, period_end, currency, created_at, updated_at
)
SELECT DISTINCT
  t.created_by AS user_id,
  'monthly' AS plan,
  'trialing' AS status,
  now() AS trial_started_at,
  now() + interval '14 days' AS trial_ends_at,
  true AS trial_used,
  now() AS period_start,
  now() + interval '14 days' AS period_end,
  'NGN' AS currency,
  now() AS created_at,
  now() AS updated_at
FROM teams t
WHERE t.created_by IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;

-- owner_team_registry: one row per existing team, all non-extra during the trial.
INSERT INTO owner_team_registry (team_id, owner_user_id, status, is_extra, created_at)
SELECT
  t.id AS team_id,
  t.created_by AS owner_user_id,
  'active' AS status,
  false AS is_extra,
  t.created_at AS created_at
FROM teams t
WHERE t.created_by IS NOT NULL
ON CONFLICT (team_id) DO NOTHING;

-- App role grants for backfilled tables (idempotent, matches 079).
\getenv app_user DB_APP_USER
\if :{?app_user}
GRANT SELECT, INSERT, UPDATE ON owner_accounts TO :"app_user";
GRANT SELECT ON plan_entitlements TO :"app_user";
GRANT SELECT, INSERT, UPDATE ON owner_team_registry TO :"app_user";
\endif
