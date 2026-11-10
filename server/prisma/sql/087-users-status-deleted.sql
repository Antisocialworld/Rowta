-- 087-users-status-deleted.sql
-- Extend users_status CHECK to allow 'deleted' in addition to 'active' and 'pending_deletion'.
-- Keep users_pending_needs_time intact.
-- Tombstone rows are D3's job.
-- Apply to DB0 ONLY.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status;
ALTER TABLE users ADD CONSTRAINT users_status CHECK (status IN ('active', 'pending_deletion', 'deleted'));

