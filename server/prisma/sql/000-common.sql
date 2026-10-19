-- Rowta reference DDL, part 0: objects needed on EVERY database (DB0 and DB1). PostgreSQL 16 tested.
-- Rules: D1 money is bigint minor units (cents, kobo, ...; the exponent is per currency) beside a currency code; no float, numeric, real or
-- money type anywhere. D2 uniqueness is a constraint. D3 ledger append-only. C9 timestamps are timestamptz (UTC).
-- This file is REFERENCE DDL: the build agent adopts it as the baseline migration, applies it to BOTH databases, and
-- proves it with sql/selftest.sql. Do not put secrets here.

-- Currency columns: a payment is in the currency of the paying owner's country (PRD 5). Which currencies exist is DATA, not
-- code: the global table `currencies` (010-global.sql) lists them with their minor-unit exponent (0, 2 or 3 decimals).
-- Shard tables cannot reference DB0, so every shard currency column is plain text with CHECK (currency ~ '^[A-Z]{3}$')
-- (ISO 4217 shape); the server accepts only currencies that are enabled in `currencies` and have a row in `plan_prices`.
-- Plain text, not a custom domain, so Prisma maps it as a normal String.

CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- Every purge job writes here (no personal data).
CREATE TABLE purge_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job        text NOT NULL,
  table_name text NOT NULL,
  row_count  integer NOT NULL CHECK (row_count >= 0),
  dry_run    boolean NOT NULL,
  ran_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purge_log_ran_at_idx ON purge_log (ran_at DESC);
