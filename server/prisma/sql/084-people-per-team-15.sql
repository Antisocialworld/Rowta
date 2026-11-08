-- 084-people-per-team-15.sql
-- Forward-only migration: people_per_team = 15 for monthly and yearly (DB0 only, idempotent).
-- Apply to DB0 only, after 076-plan-entitlements.sql.
-- Paid plans include 15 people per team; trial stays at 10 (trial_people unchanged).
-- Every other column (base price, free teams, extra team price, extra person price,
-- max teams, max people per team, trial days/teams/people, min add-on charge) is unchanged.
UPDATE plan_entitlements
SET people_per_team = 15
WHERE interval IN ('monthly', 'yearly');
