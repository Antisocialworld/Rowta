-- 077-owner-team-registry.sql
-- Forward-only migration: owner_team_registry table (db0 global, idempotent).
-- Apply to DB0 only, after 010-global.sql.
-- Capacity ledger: one row per team, recording which account owns it and whether it is
-- an extra (chargeable) team. Capacity checks and slot reservation happen inside a db0
-- transaction that holds a row lock (SELECT ... FOR UPDATE) on the owner's owner_accounts
-- row. The team is then created on its shard; if the shard write fails, the slot is
-- released (the registry row is deleted or set back to a non-reserved status).
-- owner_user_id references users (global, db0). No cross-DB FK from shards to db0.
CREATE TABLE IF NOT EXISTS owner_team_registry (
  team_id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'extra', 'pending_payment', 'read_only', 'cancelled')),
  is_extra boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One team per row (team_id is the PK). Owner lookups go through owner_user_id.
CREATE INDEX IF NOT EXISTS owner_team_registry_owner_idx ON owner_team_registry (owner_user_id);
CREATE INDEX IF NOT EXISTS owner_team_registry_status_idx ON owner_team_registry (status);
