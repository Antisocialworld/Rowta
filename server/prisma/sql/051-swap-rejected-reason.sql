-- 051-swap-rejected-reason.sql
-- Run together with the Swap v2 code that sends decline_reason. Running it earlier breaks Decline.
-- Applies to shard databases (DB0 and DB1). Requires 050-swap-v2-and-activity.sql.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'swaps_rejected_reason'
  ) THEN
    ALTER TABLE swap_requests
      ADD CONSTRAINT swaps_rejected_reason
      CHECK (status != 'rejected' OR (decline_reason IS NOT NULL AND char_length(trim(decline_reason)) > 0 AND char_length(decline_reason) <= 140))
      NOT VALID;
  END IF;
END $$;

