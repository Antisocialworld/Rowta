-- Run CONNECTED AS THE APP ROLE (DB0_WRITE_URL / DB1_WRITE_URL), not the owner. Proves the app cannot damage the ledger or the schema.
-- Rolled back; fake data only.  Usage: psql "$DB0_WRITE_URL" -v ON_ERROR_STOP=1 -f selftest-app.sql
BEGIN;
CREATE FUNCTION pg_temp.must_fail(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS (rejected, %): %', SQLSTATE, label; RETURN; END;
  RAISE EXCEPTION 'FAIL (was accepted): %', label;
END $$;
CREATE FUNCTION pg_temp.must_pass(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE stmt; RAISE NOTICE 'PASS (accepted): %', label; END $$;

DO $$ BEGIN
  IF (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'FAIL: % has elevated attributes', current_user; END IF;
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND pg_get_userbyid(c.relowner) = current_user) THEN
    RAISE EXCEPTION 'FAIL: the app role owns a table'; END IF;
  RAISE NOTICE 'PASS: the app role is not a superuser and owns nothing';
END $$;
SELECT pg_temp.must_pass('team insert', $$INSERT INTO teams (id, name) VALUES ('11111111-1111-1111-1111-111111111111', 'App test')$$);
SELECT pg_temp.must_pass('ledger insert', $$INSERT INTO ledger_entries (id, team_id, kind, amount_minor, currency, reason) VALUES ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'charge', 100, 'USD', 'x')$$);
SELECT pg_temp.must_pass('ledger select', $$SELECT * FROM ledger_entries$$);
SELECT pg_temp.must_fail('ledger UPDATE', $$UPDATE ledger_entries SET reason = 'y'$$);
SELECT pg_temp.must_fail('ledger DELETE', $$DELETE FROM ledger_entries$$);
SELECT pg_temp.must_fail('ledger TRUNCATE', $$TRUNCATE ledger_entries$$);
SELECT pg_temp.must_fail('DROP TABLE', $$DROP TABLE ledger_entries$$);
SELECT pg_temp.must_fail('DROP the ledger trigger', $$DROP TRIGGER ledger_no_row_change ON ledger_entries$$);
SELECT pg_temp.must_fail('ALTER TABLE', $$ALTER TABLE ledger_entries DISABLE TRIGGER ALL$$);
-- Billing handovers: app can create and resolve (UPDATE its own rows)
SELECT pg_temp.must_pass('subscription for handover test', $$INSERT INTO subscriptions (id, team_id, plan, seats, currency, period_start, period_end, billing_user_id, interval) VALUES ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111', 'starter', 3, 'USD', now(), now() + interval '30 days', 'aaaaaaaa-0000-0000-0000-000000000001', 'month')$$);
SELECT pg_temp.must_pass('billing_handovers insert', $$INSERT INTO billing_handovers (id, subscription_id, team_id, from_user_id, to_user_id, status, expires_at) VALUES ('66666666-6666-6666-6666-666666666666', '88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'requested', now() + interval '7 days')$$);
SELECT pg_temp.must_pass('billing_handovers update (resolve)', $$UPDATE billing_handovers SET status = 'accepted', resolved_at = now() WHERE id = '66666666-6666-6666-6666-666666666666'$$);
SELECT pg_temp.must_pass('cancel_at_period_end update', $$UPDATE subscriptions SET cancel_at_period_end = true WHERE id = '88888888-8888-8888-8888-888888888888'$$);
-- FIX-A: payment_intents target columns writable by app role
SELECT pg_temp.must_pass('payment_intents target insert', $$INSERT INTO payment_intents (id, team_id, tx_ref, purpose, amount_minor, currency, created_by, plan, seats, interval, kind) VALUES ('99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', 'tx-target', 'first_purchase', 100, 'USD', 'aaaaaaaa-0000-0000-0000-000000000001', 'starter', 3, 'month', 'first_purchase')$$);
SELECT pg_temp.must_fail('CREATE TABLE', $$CREATE TABLE evil (id int)$$);
SELECT pg_temp.must_pass('normal team update', $$UPDATE teams SET name = 'Renamed' WHERE id = '11111111-1111-1111-1111-111111111111'$$);
ROLLBACK;
SELECT 'APP-ROLE SELFTEST COMPLETE (rolled back)' AS result;
