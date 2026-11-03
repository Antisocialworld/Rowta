-- 060-team-restore.sql
-- Forward-only migration: Composite index for deleted teams query by deleter admin.
-- Applies to shard databases (DB0 and DB1).
--
-- WHY:
-- 1. GET /teams/deleted filters WHERE deleted_by = $1 AND deleted_at >= $2.
--    This index enables efficient index scans over soft-deleted teams for the deleter admin
--    without requiring sequential table scans on shard databases.
-- 2. Double-restore protection is enforced at the transaction engine level via SELECT ... FOR UPDATE
--    row-level locking and checking deleted_at IS NOT NULL.
-- 3. Team names are not constrained to be unique in Rowta, so restoring a team never conflicts
--    with existing active team names at the database constraint level.

CREATE INDEX IF NOT EXISTS teams_deleted_by_idx ON teams (deleted_by, deleted_at) WHERE deleted_at IS NOT NULL;

