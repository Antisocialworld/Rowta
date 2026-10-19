-- Rowta reference DDL, part 3: the NON-OWNER role the running application uses. PostgreSQL 16 tested (needs psql 15+ for \getenv).
-- WHY: the Docker image's POSTGRES_USER owns every table and is a superuser; an owner can alter tables, drop triggers and
-- bypass REVOKE, which would defeat the append-only ledger (D3). The app connects as this role instead. Setup, this file and
-- `prisma db pull` use the owner (DB0_ADMIN_URL / DB1_ADMIN_URL); the app and worker use DB0_WRITE_URL etc. (this role).
-- The name and password come from the environment (DB_APP_USER, DB_APP_PASSWORD), never from this file or the command line.
-- PostgreSQL stores the role password with its own built-in scheme, chosen by the server (rule A4, exception E2).
-- Apply on DB0 and on DB1, after 000/010/020. Re-running it is safe and also rotates the password.
-- Usage (names only; the shell holds the values):  psql "$DB0_ADMIN_URL" -v ON_ERROR_STOP=1 -f 030-app-role.sql
\getenv app_user DB_APP_USER
\getenv app_password DB_APP_PASSWORD
\if :{?app_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'DB_APP_PASSWORD is not set; refusing to continue'; END $$;
\endif

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'app_user', :'app_password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'app_user', :'app_password') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_user') \gexec

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO :"app_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_user";
-- The ledger is append-only (D3): the app may read and insert, never change or remove, never truncate.
REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entries FROM :"app_user";
-- Tables added later by a numbered migration get the normal grants automatically. A later append-only table needs its own REVOKE.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
