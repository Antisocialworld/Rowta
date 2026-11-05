-- 061-notification-outbox.sql
-- Forward-only migration: transactional notification outbox table on shard databases.
-- Applies to: rowta_db0, rowta_db1 (and test databases rowta_db0_test, rowta_db1_test).
--
-- WHY:
-- PRD 8.7, 8.11; Phase 6 Stage 4.
-- Outbox rows are inserted within the same database transaction as the business changes
-- (shifts, swaps), ensuring transactional atomicity and zero lost notifications.
-- The sweeper worker polls due rows in small batches with leases.

CREATE TABLE IF NOT EXISTS notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL,
  category text NOT NULL,
  payload jsonb NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  deliver_after timestamptz,
  claimed_at timestamptz,
  claimed_by text,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbox_status CHECK (status IN ('pending', 'processing', 'sent', 'skipped', 'failed'))
);

CREATE INDEX IF NOT EXISTS outbox_due_idx
  ON notification_outbox (status, next_attempt_at)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS outbox_recipient_idx
  ON notification_outbox (recipient_user_id);

