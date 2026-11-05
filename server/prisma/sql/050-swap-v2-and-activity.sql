-- 050-swap-v2-and-activity.sql
-- Forward-only migration: Swap v2 columns, statuses, partial unique index;
-- Activity audience column, backfill, check constraint, and created_at index.
-- Note: Rejection reason constraint moved to 051-swap-rejected-reason.sql to run with Swap v2 code.
-- Applies to shard databases (DB0 and DB1). Requires 020-team.sql baseline.

-- =============================================================================================
-- 1. Swap v2: swap_requests columns and constraints
-- =============================================================================================

ALTER TABLE swap_requests
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS decline_reason text,
  ADD COLUMN IF NOT EXISTS colleague_responded_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- Note length limit (<= 140 chars)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'swaps_note_len'
  ) THEN
    ALTER TABLE swap_requests
      ADD CONSTRAINT swaps_note_len CHECK (note IS NULL OR char_length(note) <= 140);
  END IF;
END $$;

-- Update status check constraint: drop 4-status check, add 7-status check
ALTER TABLE swap_requests DROP CONSTRAINT IF EXISTS swaps_status;
ALTER TABLE swap_requests ADD CONSTRAINT swaps_status
  CHECK (status IN ('pending', 'awaiting_colleague', 'approved', 'rejected', 'colleague_declined', 'cancelled', 'expired'));

-- Replace partial unique index: covers both 'pending' and 'awaiting_colleague'
-- Guarantees at most one active swap attempt per shift at DB engine level.
DROP INDEX IF EXISTS swaps_one_pending_idx;
CREATE UNIQUE INDEX swaps_one_pending_idx ON swap_requests (shift_id)
  WHERE status IN ('pending', 'awaiting_colleague');

-- =============================================================================================
-- 2. Activity: activity_events audience column, backfill, and created_at index
-- =============================================================================================

ALTER TABLE activity_events
  ADD COLUMN IF NOT EXISTS audience text;

-- Backfill rule: existing shift.* kinds get 'team'; all other existing rows get 'managers'
UPDATE activity_events
SET audience = CASE
  WHEN kind LIKE 'shift.%' THEN 'team'
  ELSE 'managers'
END
WHERE audience IS NULL;

-- Enforce default and NOT NULL for audience
ALTER TABLE activity_events ALTER COLUMN audience SET DEFAULT 'managers';
ALTER TABLE activity_events ALTER COLUMN audience SET NOT NULL;

-- Audience check constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'activity_audience'
  ) THEN
    ALTER TABLE activity_events
      ADD CONSTRAINT activity_audience CHECK (audience IN ('team', 'managers', 'involved'));
  END IF;
END $$;

-- Cross-team retention purge index (enables index scans for 90-day purge without table scans)
CREATE INDEX IF NOT EXISTS activity_created_at_idx ON activity_events (created_at);

