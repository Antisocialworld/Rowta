-- 085-intents-kind-account-renewal.sql
-- Forward-only migration: widen payment_intents kind CHECK to include 'account_renewal' (DB0 only, idempotent).
-- Apply to DB0 only, after 083-intents-purpose-account-action.sql.
-- account-renewal-processor.ts writes kind 'account_renewal'; the existing intents_kind CHECK
-- (first_purchase, upgrade, seats, renewal, account_subscribe, account_add_team, account_add_people,
-- account_switch_interval, account_interval_switch) rejects it, causing the renewal upsert to fail.
-- Drop and re-add the constraint adding 'account_renewal'. purpose 'account_renewal' is NOT valid;
-- renewal intents use purpose 'renewal' (already allowed), kind 'account_renewal', interval 'month'/'year'.
ALTER TABLE payment_intents DROP CONSTRAINT IF EXISTS intents_kind;
ALTER TABLE payment_intents ADD CONSTRAINT intents_kind CHECK (kind IS NULL OR kind IN ('first_purchase', 'upgrade', 'seats', 'renewal', 'account_subscribe', 'account_add_team', 'account_add_people', 'account_switch_interval', 'account_interval_switch', 'account_renewal'));
