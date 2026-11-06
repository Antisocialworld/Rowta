-- 070-billing-holder.sql
-- Forward-only migration: billing holder, interval, and hand-over tables.
-- Apply to DB0 (global + shard 0) and DB1 (shard 1), after 000+010+020+030.
-- No cross-database foreign keys: billing_user_id references users (DB0, global) but subscriptions
-- live on shards; the column is a plain uuid (the server validates the user exists at the app layer).
-- All additions are additive: existing columns and data are unchanged.

-- subscriptions: add billing_user_id (holder; backfilled from current owner), interval,
-- and cancel_at_period_end.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_user_id uuid;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS interval text NOT NULL DEFAULT 'month'
  CHECK (interval IN ('month', 'year'));
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;

-- Backfill billing_user_id from each team's current owner membership.
UPDATE subscriptions s
SET billing_user_id = m.user_id
FROM memberships m
WHERE s.team_id = m.team_id
  AND m.role = 'owner'
  AND m.removed_at IS NULL;

-- Ledger: nullable additive columns for rebuildFromLedger (no personal data, no card data).
-- plan / seats / interval let rebuildFromLedger reconstruct a subscription's state from ledger rows only.
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS plan text;
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS seats integer;
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS interval text;

-- billing_handovers: one open hand-over per subscription (partial UNIQUE index).
-- Lives on the shard (subscription_id references the shard's subscriptions table).
-- No FK to users (cross-database); from_user_id / to_user_id are plain uuids validated at the app layer.
CREATE TABLE IF NOT EXISTS billing_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id),
  team_id uuid NOT NULL REFERENCES teams(id),
  from_user_id uuid NOT NULL,
  to_user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'accepted', 'declined', 'cancelled', 'expired')),
  CHECK (from_user_id <> to_user_id),
  giver_acknowledged_at timestamptz,
  recipient_acknowledged_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_handovers_one_open_idx
  ON billing_handovers (subscription_id)
  WHERE status = 'requested';
CREATE INDEX IF NOT EXISTS billing_handovers_team_idx ON billing_handovers (team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS billing_handovers_expires_idx ON billing_handovers (expires_at)
  WHERE status = 'requested';
