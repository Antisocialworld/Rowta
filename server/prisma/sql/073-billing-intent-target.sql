-- 073-billing-intent-target.sql
-- Forward-only migration: payment_intents target columns (DB0 only, idempotent).
-- Apply to DB0 only, after 010-global.sql and 070-billing-holder.sql.
-- All additions are additive; existing columns and data are unchanged.
--
-- Existing constraints cited (010-global.sql):
--   payment_intents.purpose CHECK (purpose IN ('upgrade', 'seats', 'renewal', 'plan_change'))
--   payment_intents.status CHECK (status IN ('pending', 'succeeded', 'failed', 'expired'))
--   webhook_events.status CHECK (status IN ('received', 'processed', 'ignored', 'failed'))
--
-- Widen the purpose CHECK to include 'first_purchase' (F2) so first-purchase intents can be stored.
-- kind CHECK values ('first_purchase', 'upgrade', 'seats', 'renewal') are a new column; no existing constraint needs widening.

-- Widen intents_purpose to accept 'first_purchase'.
ALTER TABLE payment_intents DROP CONSTRAINT IF EXISTS intents_purpose;
ALTER TABLE payment_intents ADD CONSTRAINT intents_purpose CHECK (purpose IN ('first_purchase', 'upgrade', 'seats', 'renewal', 'plan_change'));

ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS plan text;
ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS seats integer;
ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS interval text
  CHECK (interval IS NULL OR interval IN ('month', 'year'));
ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS kind text
  CHECK (kind IS NULL OR kind IN ('first_purchase', 'upgrade', 'seats', 'renewal'));

CREATE INDEX IF NOT EXISTS payment_intents_target_idx ON payment_intents (team_id, kind);
