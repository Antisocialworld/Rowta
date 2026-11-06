-- 072-app-role-billing.sql
-- Role grants for billing tables added by 070-billing-holder.sql.
-- Apply on DB0 and DB1, after 030-app-role.sql and 070-billing-holder.sql.
-- The name and password come from the environment (DB_APP_USER), never from this file.
\getenv app_user DB_APP_USER
\if :{?app_user}
\else
  DO $$ BEGIN RAISE EXCEPTION 'DB_APP_USER is not set; refusing to continue'; END $$;
\endif

-- The app can read, insert, update billing_handovers (hand-over requests are created and resolved by the app).
-- DELETE is deliberately NOT granted: hand-over rows are resolved by status change, never deleted.
GRANT SELECT, INSERT, UPDATE ON billing_handovers TO :"app_user";
-- ALTER DEFAULT PRIVILEGES (set by 030-app-role.sql) already covers tables added after it;
-- this GRANT is explicit and idempotent if re-run.
-- The ledger remains append-only: REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entries
-- was already applied by 030-app-role.sql and is not repeated here.
-- No card data, no personal data, no payment secrets in any billing table.
