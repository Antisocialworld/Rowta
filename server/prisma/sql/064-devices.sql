-- 064-devices.sql
-- Forward-only migration: unique constraint on push_token for devices table (Phase 6 Stage 3).
-- Applies to global database (DB0).
--
-- WHY:
-- 1. Table `devices` already exists in 010-global.sql with:
--    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
--    device_id text NOT NULL,
--    push_token text,
--    platform text NOT NULL DEFAULT 'android',
--    last_seen_at timestamptz NOT NULL DEFAULT now(),
--    created_at timestamptz NOT NULL DEFAULT now(),
--    CONSTRAINT devices_platform CHECK (platform IN ('android', 'ios', 'web')),
--    CONSTRAINT devices_user_device_key UNIQUE (user_id, device_id)
-- 2. Phase 6 Stage 3 & PRD 8.7: A push token is unique across the entire system.
--    Registering a token that already exists moves ownership to the signed-in user.
--    This constraint is enforced at the database level by a unique index on push_token.
-- 3. Note on user_id indexing: `devices_user_device_key` UNIQUE (user_id, device_id)
--    in 010-global.sql already creates a b-tree index with leading column user_id,
--    so a separate index on user_id is not needed.

CREATE UNIQUE INDEX IF NOT EXISTS devices_push_token_unique
  ON devices (push_token)
  WHERE push_token IS NOT NULL;


