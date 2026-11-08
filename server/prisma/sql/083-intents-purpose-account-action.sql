-- 083-intents-purpose-account-action.sql
-- Forward-only migration: widen payment_intents purpose/kind CHECKs (DB0 only, idempotent).
-- Apply to DB0 only, after 073-billing-intent-target.sql.
-- account-service.ts writes purpose 'account_action' for account-level checkouts; the
-- existing purpose CHECK (first_purchase, upgrade, seats, renewal, plan_change) rejects it,
-- causing POST /billing/account/checkout to return 500.
-- Drop and re-add the purpose constraint allowing ALL existing values plus 'account_action'.
--
-- Kind note: account-service.ts also writes kind 'account_*' (account_subscribe,
-- account_add_team, account_add_people, account_switch_interval). The kind CHECK added
-- inline by 073 (first_purchase, upgrade, seats, renewal) blocks those values; the webhook
-- processor routes by intent.kind starting with 'account_' (T10), so without widening kind
-- checkout would still 500 on the kind constraint. The inline 073 constraint has no stable
-- name, so it is located via pg_constraint and dropped before re-adding a widened named one.
ALTER TABLE payment_intents DROP CONSTRAINT IF EXISTS intents_purpose;
ALTER TABLE payment_intents ADD CONSTRAINT intents_purpose CHECK (purpose IN ('first_purchase', 'upgrade', 'seats', 'renewal', 'plan_change', 'account_action'));

DO $$
DECLARE
  cons_name text;
BEGIN
  SELECT c.conname INTO cons_name
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'payment_intents'::regclass
    AND c.contype = 'c'
    AND a.attname = 'kind'
    AND c.conname <> 'intents_kind'
    AND pg_get_constraintdef(c.oid) LIKE '%first_purchase%';
  IF cons_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE payment_intents DROP CONSTRAINT %I', cons_name);
  END IF;
END $$;

ALTER TABLE payment_intents ADD CONSTRAINT intents_kind CHECK (kind IS NULL OR kind IN ('first_purchase', 'upgrade', 'seats', 'renewal', 'account_subscribe', 'account_add_team', 'account_add_people', 'account_switch_interval', 'account_interval_switch'));
