-- 086-app-role-delete-grants.sql
-- Role grants adjustment: grant DELETE on owner_team_registry (for releaseTeamSlot on failed reservation)
-- and revoke DELETE on owner_accounts (db0 only, idempotent).
-- Apply on DB0 only, after 075, 077, and 079.
-- The name comes from the environment (DB_APP_USER).
\getenv app_user DB_APP_USER
\if :{?app_user}
\else
  DO $$ BEGIN RAISE EXCEPTION 'DB_APP_USER is not set; refusing to continue'; END $$;
\endif

GRANT DELETE ON owner_team_registry TO :"app_user";
REVOKE DELETE ON owner_accounts FROM :"app_user";

