-- Rowta schema self-test. Run on a database that already has the DDL (DB0: 000+010+020; DB1: 000+020).
-- It runs inside a transaction, raises on the first failure, and rolls everything back. Fake data only.
-- Usage: psql "<url>" -v ON_ERROR_STOP=1 -f selftest.sql      (prints PASS lines; a failure stops with an error)
BEGIN;
CREATE FUNCTION pg_temp.must_fail(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS (rejected): %', label; RETURN; END;
  RAISE EXCEPTION 'FAIL (was accepted): %', label;
END $$;
CREATE FUNCTION pg_temp.must_pass(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE stmt; RAISE NOTICE 'PASS (accepted): %', label; END $$;

-- D1: no floating or decimal money type anywhere; every *_minor column is bigint.
DO $$
DECLARE n integer; BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND data_type IN ('numeric', 'real', 'double precision', 'money');
  IF n > 0 THEN RAISE EXCEPTION 'FAIL: % numeric/real/double/money column(s) exist', n; END IF;
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND column_name LIKE '%\_minor' AND data_type <> 'bigint';
  IF n > 0 THEN RAISE EXCEPTION 'FAIL: % *_minor column(s) are not bigint', n; END IF;
  RAISE NOTICE 'PASS: no numeric/real/double/money columns; all *_minor columns are bigint';
END $$;

-- Common
SELECT pg_temp.must_fail('currency in lower case rejected',
  $$INSERT INTO ledger_entries (team_id, kind, amount_minor, currency, reason) VALUES (gen_random_uuid(), 'charge', 100, 'eur', 'x')$$);
SELECT pg_temp.must_fail('two-letter currency rejected',
  $$INSERT INTO ledger_entries (team_id, kind, amount_minor, currency, reason) VALUES (gen_random_uuid(), 'charge', 100, 'EU', 'x')$$);
SELECT pg_temp.must_pass('any ISO-shaped currency accepted on a shard (the server checks the list)',
  $$INSERT INTO ledger_entries (team_id, kind, amount_minor, currency, reason) VALUES (gen_random_uuid(), 'charge', 100, 'GHS', 'x')$$);
-- Team tables (every shard)
INSERT INTO teams (id, name) VALUES ('11111111-1111-1111-1111-111111111111', 'Team A'), ('22222222-2222-2222-2222-222222222222', 'Team B');
INSERT INTO memberships (team_id, user_id, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner'),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'staff'),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000001', 'owner');
SELECT pg_temp.must_fail('second active owner rejected',
  $$INSERT INTO memberships (team_id, user_id, role) VALUES ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000003', 'owner')$$);
SELECT pg_temp.must_fail('duplicate membership rejected',
  $$INSERT INTO memberships (team_id, user_id, role) VALUES ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'staff')$$);
SELECT pg_temp.must_fail('bad role rejected',
  $$INSERT INTO memberships (team_id, user_id, role) VALUES ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000009', 'admin')$$);
SELECT pg_temp.must_pass('shift for a member of the same team',
  $$INSERT INTO shifts (id, team_id, assigned_user_id, starts_at, ends_at, label, created_by) VALUES ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', now(), now() + interval '8 hours', 'Opening', 'aaaaaaaa-0000-0000-0000-000000000001')$$);
SELECT pg_temp.must_fail('shift assigned to another team''s member rejected',
  $$INSERT INTO shifts (team_id, assigned_user_id, starts_at, ends_at, label, created_by) VALUES ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-0000-0000-0000-000000000001', now(), now() + interval '1 hour', 'X', 'aaaaaaaa-0000-0000-0000-000000000001')$$);
SELECT pg_temp.must_fail('shift ending before it starts rejected',
  $$INSERT INTO shifts (team_id, assigned_user_id, starts_at, ends_at, label, created_by) VALUES ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', now(), now() - interval '1 hour', 'X', 'aaaaaaaa-0000-0000-0000-000000000001')$$);
SELECT pg_temp.must_pass('swap request',
  $$INSERT INTO swap_requests (id, team_id, shift_id, requested_by) VALUES ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'aaaaaaaa-0000-0000-0000-000000000002')$$);
SELECT pg_temp.must_fail('second pending swap on one shift rejected',
  $$INSERT INTO swap_requests (team_id, shift_id, requested_by) VALUES ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'aaaaaaaa-0000-0000-0000-000000000002')$$);
SELECT pg_temp.must_fail('approved swap without a decider rejected',
  $$UPDATE swap_requests SET status = 'approved' WHERE id = '44444444-4444-4444-4444-444444444444'$$);
SELECT pg_temp.must_pass('cancel the first swap', $$UPDATE swap_requests SET status = 'cancelled' WHERE id = '44444444-4444-4444-4444-444444444444'$$);
SELECT pg_temp.must_pass('a new pending swap after cancel',
  $$INSERT INTO swap_requests (team_id, shift_id, requested_by) VALUES ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'aaaaaaaa-0000-0000-0000-000000000002')$$);
SELECT pg_temp.must_fail('swap for a shift of another team rejected',
  $$INSERT INTO swap_requests (team_id, shift_id, requested_by) VALUES ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 'bbbbbbbb-0000-0000-0000-000000000001')$$);
SELECT pg_temp.must_pass('invite', $$INSERT INTO invites (team_id, email, role, selector, verifier_hash, invited_by, expires_at) VALUES ('11111111-1111-1111-1111-111111111111', 'new@example.test', 'staff', 'sel1', '$argon2id$v=19$fake', 'aaaaaaaa-0000-0000-0000-000000000001', now() + interval '7 days')$$);
SELECT pg_temp.must_fail('second open invite for same team+email rejected',
  $$INSERT INTO invites (team_id, email, role, selector, verifier_hash, invited_by, expires_at) VALUES ('11111111-1111-1111-1111-111111111111', 'new@example.test', 'staff', 'sel2', '$argon2id$v=19$fake', 'aaaaaaaa-0000-0000-0000-000000000001', now() + interval '7 days')$$);
SELECT pg_temp.must_fail('invite verifier that is not Argon2id rejected',
  $$INSERT INTO invites (team_id, email, role, selector, verifier_hash, invited_by, expires_at) VALUES ('11111111-1111-1111-1111-111111111111', 'x@example.test', 'staff', 'sel3', 'abc123', 'aaaaaaaa-0000-0000-0000-000000000001', now() + interval '7 days')$$);
SELECT pg_temp.must_fail('inviting an owner rejected',
  $$INSERT INTO invites (team_id, email, role, selector, verifier_hash, invited_by, expires_at) VALUES ('11111111-1111-1111-1111-111111111111', 'y@example.test', 'owner', 'sel4', '$argon2id$v=19$fake', 'aaaaaaaa-0000-0000-0000-000000000001', now() + interval '7 days')$$);
SELECT pg_temp.must_pass('subscription', $$INSERT INTO subscriptions (team_id, plan, seats, currency, period_start, period_end) VALUES ('11111111-1111-1111-1111-111111111111', 'starter', 3, 'USD', now(), now() + interval '30 days')$$);
SELECT pg_temp.must_fail('second subscription for a team rejected', $$INSERT INTO subscriptions (team_id, plan, seats, currency, period_start, period_end) VALUES ('11111111-1111-1111-1111-111111111111', 'team', 3, 'USD', now(), now() + interval '30 days')$$);
SELECT pg_temp.must_fail('starter above 5 seats rejected', $$INSERT INTO subscriptions (team_id, plan, seats, currency, period_start, period_end) VALUES ('22222222-2222-2222-2222-222222222222', 'starter', 6, 'USD', now(), now() + interval '30 days')$$);
SELECT pg_temp.must_fail('past_due without a grace end rejected', $$UPDATE subscriptions SET status = 'past_due' WHERE team_id = '11111111-1111-1111-1111-111111111111'$$);
-- D1, D3 ledger
SELECT pg_temp.must_pass('ledger charge in minor units', $$INSERT INTO ledger_entries (id, team_id, kind, amount_minor, currency, reason, provider_ref) VALUES ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'charge', 3333, 'USD', 'upgrade', 'ref-1')$$);
SELECT pg_temp.must_pass('ledger credit is negative', $$INSERT INTO ledger_entries (team_id, kind, amount_minor, currency, reason) VALUES ('11111111-1111-1111-1111-111111111111', 'credit', -1333, 'USD', 'proration credit')$$);
SELECT pg_temp.must_fail('negative charge rejected', $$INSERT INTO ledger_entries (team_id, kind, amount_minor, currency, reason) VALUES ('11111111-1111-1111-1111-111111111111', 'charge', -5, 'USD', 'x')$$);
SELECT pg_temp.must_fail('zero amount rejected', $$INSERT INTO ledger_entries (team_id, kind, amount_minor, currency, reason) VALUES ('11111111-1111-1111-1111-111111111111', 'adjustment', 0, 'USD', 'x')$$);
SELECT pg_temp.must_fail('duplicate provider_ref rejected', $$INSERT INTO ledger_entries (team_id, kind, amount_minor, currency, reason, provider_ref) VALUES ('11111111-1111-1111-1111-111111111111', 'charge', 100, 'USD', 'x', 'ref-1')$$);
SELECT pg_temp.must_fail('ledger UPDATE rejected (append-only)', $$UPDATE ledger_entries SET reason = 'edited' WHERE id = '55555555-5555-5555-5555-555555555555'$$);
SELECT pg_temp.must_fail('ledger DELETE rejected (append-only)', $$DELETE FROM ledger_entries WHERE id = '55555555-5555-5555-5555-555555555555'$$);
SELECT pg_temp.must_fail('ledger TRUNCATE rejected (append-only)', $$TRUNCATE ledger_entries$$);
SELECT pg_temp.must_pass('ledger survives deleting a team row (no foreign key)', $$DELETE FROM subscriptions WHERE team_id = '22222222-2222-2222-2222-222222222222'$$);
SELECT pg_temp.must_pass('idempotency key', $$INSERT INTO idempotency_keys (scope, key, request_fingerprint) VALUES ('team-1:pay', 'k1', 'fp')$$);
SELECT pg_temp.must_fail('duplicate idempotency key rejected', $$INSERT INTO idempotency_keys (scope, key, request_fingerprint) VALUES ('team-1:pay', 'k1', 'fp2')$$);
SELECT pg_temp.must_pass('activity event', $$INSERT INTO activity_events (team_id, kind, data) VALUES ('11111111-1111-1111-1111-111111111111', 'shift.created', '{"label":"Opening"}')$$);
SELECT pg_temp.must_fail('activity data must be an object', $$INSERT INTO activity_events (team_id, kind, data) VALUES ('11111111-1111-1111-1111-111111111111', 'x', '[1]')$$);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM shifts WHERE search @@ websearch_to_tsquery('simple', 'opening')) THEN RAISE EXCEPTION 'FAIL: full-text search found nothing'; END IF;
  RAISE NOTICE 'PASS: shift full-text search finds the label';
END $$;

-- Global tables (DB0 only; skipped on a shard-only database)
DO $$
BEGIN
  IF to_regclass('public.users') IS NULL THEN RAISE NOTICE 'SKIP: global tables not present (shard-only database)'; RETURN; END IF;
  PERFORM pg_temp.must_pass('currencies: dollar, naira, yen, dinar', $q$INSERT INTO currencies (code, name, minor_unit, provider_supported, enabled) VALUES ('USD', 'US dollar', 2, true, true), ('NGN', 'Nigerian naira', 2, true, true), ('JPY', 'Japanese yen', 0, false, false), ('KWD', 'Kuwaiti dinar', 3, false, false)$q$);
  PERFORM pg_temp.must_fail('currency code in lower case rejected', $q$INSERT INTO currencies (code, name, minor_unit) VALUES ('eur', 'Euro', 2)$q$);
  PERFORM pg_temp.must_fail('four decimals rejected', $q$INSERT INTO currencies (code, name, minor_unit) VALUES ('XXX', 'Test', 4)$q$);
  PERFORM pg_temp.must_fail('a currency cannot be enabled before the provider supports it', $q$INSERT INTO currencies (code, name, minor_unit, provider_supported, enabled) VALUES ('GHS', 'Ghanaian cedi', 2, false, true)$q$);
  PERFORM pg_temp.must_pass('countries', $q$INSERT INTO countries (code, name, currency) VALUES ('NG', 'Nigeria', 'NGN'), ('US', 'United States', 'USD')$q$);
  PERFORM pg_temp.must_fail('country with an unknown currency rejected', $q$INSERT INTO countries (code, name, currency) VALUES ('GH', 'Ghana', 'GHS')$q$);
  PERFORM pg_temp.must_fail('country code of three letters rejected', $q$INSERT INTO countries (code, name, currency) VALUES ('NGA', 'Nigeria', 'NGN')$q$);
  PERFORM pg_temp.must_pass('plan prices in USD (the brief)', $q$INSERT INTO plan_prices (plan, currency, base_minor, extra_seat_minor) VALUES ('starter', 'USD', 2000, NULL), ('team', 'USD', 5000, 300), ('business', 'USD', 12000, 200)$q$);
  PERFORM pg_temp.must_fail('a second price for the same plan and currency rejected', $q$INSERT INTO plan_prices (plan, currency, base_minor, extra_seat_minor) VALUES ('team', 'USD', 5100, 300)$q$);
  PERFORM pg_temp.must_fail('starter with an extra-seat price rejected', $q$INSERT INTO plan_prices (plan, currency, base_minor, extra_seat_minor) VALUES ('starter', 'NGN', 2000, 100)$q$);
  PERFORM pg_temp.must_fail('team without an extra-seat price rejected', $q$INSERT INTO plan_prices (plan, currency, base_minor, extra_seat_minor) VALUES ('team', 'NGN', 5000, NULL)$q$);
  PERFORM pg_temp.must_fail('price for an unknown currency rejected', $q$INSERT INTO plan_prices (plan, currency, base_minor, extra_seat_minor) VALUES ('team', 'GHS', 5000, 300)$q$);
  PERFORM pg_temp.must_fail('zero price rejected', $q$INSERT INTO plan_prices (plan, currency, base_minor, extra_seat_minor) VALUES ('business', 'NGN', 0, 200)$q$);
  PERFORM pg_temp.must_fail('user without a country rejected', $q$INSERT INTO users (email, display_name, password_hash) VALUES ('nc@example.test', 'No Country', '$argon2id$v=19$fake')$q$);
  PERFORM pg_temp.must_fail('user with an unknown country rejected', $q$INSERT INTO users (email, country, display_name, password_hash) VALUES ('uc@example.test', 'ZZ', 'Unknown', '$argon2id$v=19$fake')$q$);
  PERFORM pg_temp.must_fail('payment intent in an unknown currency rejected', $q$INSERT INTO payment_intents (team_id, tx_ref, purpose, amount_minor, currency, created_by) VALUES (gen_random_uuid(), 'tx-x', 'upgrade', 100, 'GHS', gen_random_uuid())$q$);
  PERFORM pg_temp.must_fail('uppercase email rejected', $q$INSERT INTO users (email, country, display_name, password_hash) VALUES ('A@Example.test', 'NG', 'Ada', '$argon2id$v=19$fake')$q$);
  PERFORM pg_temp.must_fail('password hash that is not Argon2id rejected', $q$INSERT INTO users (email, country, display_name, password_hash) VALUES ('a@example.test', 'NG', 'Ada', 'plain-text-not-a-hash')$q$);
  PERFORM pg_temp.must_fail('display name of 61 characters rejected', $q$INSERT INTO users (email, country, display_name, password_hash) VALUES ('a@example.test', 'NG', repeat('x', 61), '$argon2id$v=19$fake')$q$);
  PERFORM pg_temp.must_fail('display name with a line break rejected', $q$INSERT INTO users (email, country, display_name, password_hash) VALUES ('a@example.test', 'NG', E'Ada\nLovelace', '$argon2id$v=19$fake')$q$);
  PERFORM pg_temp.must_fail('empty display name rejected', $q$INSERT INTO users (email, country, display_name, password_hash) VALUES ('a@example.test', 'NG', '', '$argon2id$v=19$fake')$q$);
  PERFORM pg_temp.must_pass('user', $q$INSERT INTO users (id, email, country, display_name, password_hash) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'ada@example.test', 'NG', 'Ada', '$argon2id$v=19$fake')$q$);
  PERFORM pg_temp.must_fail('duplicate email rejected', $q$INSERT INTO users (email, country, display_name, password_hash) VALUES ('ada@example.test', 'NG', 'Ada 2', '$argon2id$v=19$fake')$q$);
  PERFORM pg_temp.must_fail('pending_deletion without a request time rejected', $q$UPDATE users SET status = 'pending_deletion' WHERE email = 'ada@example.test'$q$);
  PERFORM pg_temp.must_pass('pending signup', $q$INSERT INTO pending_signups (email, country, display_name, password_hash, code_hash, expires_at) VALUES ('new@example.test', 'NG', 'New', '$argon2id$v=19$fake', '$argon2id$v=19$fake', now() + interval '5 minutes')$q$);
  PERFORM pg_temp.must_fail('second pending signup for one email rejected', $q$INSERT INTO pending_signups (email, country, display_name, password_hash, code_hash, expires_at) VALUES ('new@example.test', 'NG', 'New', '$argon2id$v=19$fake', '$argon2id$v=19$fake', now())$q$);
  PERFORM pg_temp.must_fail('code hash that is not Argon2id rejected', $q$INSERT INTO pending_signups (email, country, display_name, password_hash, code_hash, expires_at) VALUES ('c@example.test', 'NG', 'C', '$argon2id$v=19$fake', '123456', now())$q$);
  PERFORM pg_temp.must_pass('sent email', $q$INSERT INTO sent_emails (user_id, kind) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'welcome')$q$);
  PERFORM pg_temp.must_fail('welcome email twice rejected (send once)', $q$INSERT INTO sent_emails (user_id, kind) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'welcome')$q$);
  PERFORM pg_temp.must_pass('receipt email for a ledger entry', $q$INSERT INTO sent_emails (user_id, kind, ref) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'receipt', '55555555-5555-5555-5555-555555555555')$q$);
  PERFORM pg_temp.must_pass('refresh token', $q$INSERT INTO refresh_tokens (selector, verifier_hash, family_id, user_id, expires_at) VALUES ('s1', '$argon2id$v=19$fake', gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000001', now() + interval '30 days')$q$);
  PERFORM pg_temp.must_fail('duplicate refresh selector rejected', $q$INSERT INTO refresh_tokens (selector, verifier_hash, family_id, user_id, expires_at) VALUES ('s1', '$argon2id$v=19$fake', gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000001', now())$q$);
  PERFORM pg_temp.must_pass('password reset', $q$INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '$argon2id$v=19$fake', now() + interval '5 minutes')$q$);
  PERFORM pg_temp.must_fail('second active reset for one user rejected', $q$INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '$argon2id$v=19$fake', now())$q$);
  PERFORM pg_temp.must_fail('grant selector without a verifier rejected', $q$UPDATE password_resets SET grant_selector = 'g1'$q$);
  PERFORM pg_temp.must_pass('magic token', $q$INSERT INTO magic_tokens (selector, verifier_hash, user_id, expires_at) VALUES ('m1', '$argon2id$v=19$fake', 'aaaaaaaa-0000-0000-0000-000000000001', now() + interval '15 minutes')$q$);
  PERFORM pg_temp.must_pass('device', $q$INSERT INTO devices (user_id, device_id, push_token) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'dev-1', 'tok-fake')$q$);
  PERFORM pg_temp.must_fail('same device twice for a user rejected', $q$INSERT INTO devices (user_id, device_id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'dev-1')$q$);
  PERFORM pg_temp.must_pass('settings default row', $q$INSERT INTO user_settings (user_id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001')$q$);
  PERFORM pg_temp.must_fail('quiet start without end rejected', $q$UPDATE user_settings SET quiet_start = '22:00'$q$);
  PERFORM pg_temp.must_fail('unknown theme rejected', $q$UPDATE user_settings SET theme = 'neon'$q$);
  PERFORM pg_temp.must_pass('notification log', $q$INSERT INTO notification_log (user_id, kind, ref) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'grace', 'day3')$q$);
  PERFORM pg_temp.must_fail('same notification twice rejected', $q$INSERT INTO notification_log (user_id, kind, ref) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'grace', 'day3')$q$);
  PERFORM pg_temp.must_pass('team directory', $q$INSERT INTO team_directory (team_id, shard) VALUES ('11111111-1111-1111-1111-111111111111', 0)$q$);
  PERFORM pg_temp.must_fail('shard 2 rejected', $q$INSERT INTO team_directory (team_id, shard) VALUES (gen_random_uuid(), 2)$q$);
  PERFORM pg_temp.must_pass('payment intent in minor units', $q$INSERT INTO payment_intents (team_id, tx_ref, purpose, amount_minor, currency, created_by) VALUES ('11111111-1111-1111-1111-111111111111', 'tx-1', 'upgrade', 3333, 'USD', 'aaaaaaaa-0000-0000-0000-000000000001')$q$);
  PERFORM pg_temp.must_fail('duplicate tx_ref rejected', $q$INSERT INTO payment_intents (team_id, tx_ref, purpose, amount_minor, currency, created_by) VALUES ('11111111-1111-1111-1111-111111111111', 'tx-1', 'upgrade', 1, 'USD', 'aaaaaaaa-0000-0000-0000-000000000001')$q$);
  PERFORM pg_temp.must_fail('zero-amount intent rejected', $q$INSERT INTO payment_intents (team_id, tx_ref, purpose, amount_minor, currency, created_by) VALUES ('11111111-1111-1111-1111-111111111111', 'tx-2', 'upgrade', 0, 'USD', 'aaaaaaaa-0000-0000-0000-000000000001')$q$);
  PERFORM pg_temp.must_fail('finished intent without a completion time rejected', $q$UPDATE payment_intents SET status = 'succeeded'$q$);
  PERFORM pg_temp.must_pass('webhook event', $q$INSERT INTO webhook_events (provider, provider_event_id, tx_ref) VALUES ('flutterwave', 'evt-1', 'tx-1')$q$);
  PERFORM pg_temp.must_fail('duplicate webhook event rejected (processed once)', $q$INSERT INTO webhook_events (provider, provider_event_id) VALUES ('flutterwave', 'evt-1')$q$);
  PERFORM pg_temp.must_pass('deleting the user cascades their email records', $q$DELETE FROM users WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'$q$);
  IF EXISTS (SELECT 1 FROM sent_emails WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001') THEN RAISE EXCEPTION 'FAIL: sent_emails survived user deletion'; END IF;
  RAISE NOTICE 'PASS: sent_emails removed with the account';
END $$;
ROLLBACK;
SELECT 'SELFTEST COMPLETE (transaction rolled back)' AS result;
