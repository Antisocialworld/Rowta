-- 082-move-billing.sql
-- Forward-only migration: account-level move billing support (db0 + db1, idempotent).
-- Apply to DB0 and DB1, after 070-billing-holder.sql.
-- Makes billing_handovers.subscription_id nullable so account-level moves (no per-team
-- subscription) can reuse the same table. Adds a partial unique index for one open
-- account-level move per team.
-- All additions are additive; existing columns and data are unchanged.

-- Allow NULL subscription_id for account-level moves (no per-team subscription).
ALTER TABLE billing_handovers ALTER COLUMN subscription_id DROP NOT NULL;

-- One open account-level move per team (subscription_id IS NULL).
-- Existing index billing_handovers_one_open_idx covers per-subscription moves (subscription_id NOT NULL).
CREATE UNIQUE INDEX IF NOT EXISTS billing_handovers_one_open_per_team_idx
  ON billing_handovers (team_id)
  WHERE status = 'requested' AND subscription_id IS NULL;
