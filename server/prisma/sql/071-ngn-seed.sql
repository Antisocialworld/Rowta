-- 071-ngn-seed.sql
-- Forward-only migration: NGN currency, country, and plan prices (owner-supplied, 6 Nov 2026).
-- Apply to DB0 only. Idempotent.
-- Rowta is sold in NGN ONLY. USD and every non-NGN currency stay enabled=false with no plan_prices rows.
-- The USD rows in selftest.sql are test data only; not copied here.
-- Sources: ISO 4217 (NGN = Nigerian naira, minor unit 2), ISO 3166-1 (NG = Nigeria).
-- Record: docs/PAYMENTS-CURRENCIES.md (to be created by the owner).

INSERT INTO currencies (code, name, minor_unit, provider_supported, enabled)
VALUES ('NGN', 'Nigerian naira', 2, true, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  minor_unit = EXCLUDED.minor_unit,
  provider_supported = EXCLUDED.provider_supported,
  enabled = EXCLUDED.enabled;

INSERT INTO countries (code, name, currency)
VALUES ('NG', 'Nigeria', 'NGN')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  currency = EXCLUDED.currency;

-- NGN plan prices (owner-supplied, kobo; PRD section 5 + EDIT 2, 6 Nov 2026)
-- Starter: base 650000, no extra seat (hard cap 5)
-- Team:    base 1625000, extra 97500 (15 included)
-- Business: base 3900000, extra 65000 (40 included)
INSERT INTO plan_prices (plan, currency, base_minor, extra_seat_minor)
VALUES
  ('starter', 'NGN', 650000, NULL),
  ('team', 'NGN', 1625000, 97500),
  ('business', 'NGN', 3900000, 65000)
ON CONFLICT (plan, currency) DO UPDATE SET
  base_minor = EXCLUDED.base_minor,
  extra_seat_minor = EXCLUDED.extra_seat_minor;

-- Disable every non-NGN currency: no fallback currency, USD not sold in production.
UPDATE currencies SET enabled = false WHERE code <> 'NGN';
