-- 074-usd-price-rows.sql
-- Forward-only migration: USD price rows (DB0 only, idempotent).
-- Apply to DB0 only, after 010-global.sql and 071-ngn-seed.sql.
-- All additions are additive; existing columns and data are unchanged.
--
-- Rate basis NGN 1,350 per USD (CBN official, 6 Nov 2026). USD stays disabled until Flutterwave USD
-- is verified (capability, account enablement, payout currency, saved-card renewal).
--
-- Rowta is sold in NGN only. USD currency is inserted with enabled=false and provider_supported=false
-- so nothing can be sold in USD. No country maps to USD. Yearly prices are NOT stored: yearly =
-- 12 x monthly in code (Starter yearly = 6600 cents).
--
-- USD price table (minor units = cents):
--   Starter: base 550, no extra seat (hard cap 5)
--   Team:    base 1350, extra seat 80 (15 included)
--   Business: base 3250, extra seat 55 (40 included)

-- USD currency: 2 decimals, not enabled, not provider-supported (not sold).
INSERT INTO currencies (code, name, minor_unit, provider_supported, enabled)
VALUES ('USD', 'US dollar', 2, false, false)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  minor_unit = EXCLUDED.minor_unit,
  provider_supported = EXCLUDED.provider_supported,
  enabled = EXCLUDED.enabled;

-- USD plan prices (test fixture / reference only; not sold because enabled=false).
INSERT INTO plan_prices (plan, currency, base_minor, extra_seat_minor)
VALUES
  ('starter', 'USD', 550, NULL),
  ('team', 'USD', 1350, 80),
  ('business', 'USD', 3250, 55)
ON CONFLICT (plan, currency) DO UPDATE SET
  base_minor = EXCLUDED.base_minor,
  extra_seat_minor = EXCLUDED.extra_seat_minor;

-- No country maps to USD (owner supplies the country list later). No INSERT into countries for USD.
