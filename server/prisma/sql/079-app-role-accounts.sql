-- 079-app-role-accounts.sql
-- Role grants for billing/account tables added by 075-077 (db0 only, idempotent).
-- Apply on DB0 only, after 030-app-role.sql and the numbered migration that creates
-- each table. The name and password come from the environment (DB_APP_USER).
\getenv app_user DB_APP_USER
\if :{?app_user}
\else
  DO $$ BEGIN RAISE EXCEPTION 'DB_APP_USER is not set; refusing to continue'; END $$;
\endif

-- DB0 global tables: app can read/update owner_accounts, plan_entitlements, owner_team_registry.
-- DELETE is NOT granted on owner_accounts (accounts are removed only by the purge job).
GRANT SELECT, INSERT, UPDATE ON owner_accounts TO :"app_user";
GRANT SELECT ON plan_entitlements TO :"app_user";
GRANT SELECT, INSERT, UPDATE ON owner_team_registry TO :"app_user";

-- Teams coverage columns on both shards are already covered by 030's GRANT on ALL TABLES
-- plus ALTER DEFAULT PRIVILEGES; this is explicit for clarity.
GRANT SELECT, INSERT, UPDATE ON teams TO :"app_user";
