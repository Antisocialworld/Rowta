-- 040-teams-created-by-deleted-by.sql
-- Forward-only migration: add created_by and deleted_by to teams on both shards (DB0 and DB1).
-- User IDs reference users in the GLOBAL database (plain uuid columns, no cross-database foreign key, rule D7).

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

-- Backfill created_by from the earliest owner membership in the same shard
UPDATE teams t
SET created_by = (
  SELECT m.user_id
  FROM memberships m
  WHERE m.team_id = t.id
    AND m.role = 'owner'
  ORDER BY m.created_at ASC
  LIMIT 1
)
WHERE t.created_by IS NULL;

