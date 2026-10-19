-- Rowta reference DDL, part 2: TEAM tables. Apply to EVERY shard (DB0 and DB1). Requires 000-common.sql first.
-- user ids refer to users in the GLOBAL database, so they are plain uuid columns here (no cross-database foreign key,
-- rule D7); the application and repair jobs keep them consistent.

CREATE TABLE teams (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deletion_requested_at timestamptz,
  deleted_at            timestamptz,
  CONSTRAINT teams_name_len CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT teams_name_no_control CHECK (name !~ '[[:cntrl:]]')
);
CREATE TRIGGER teams_updated BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX teams_deleted_idx ON teams (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE memberships (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    uuid NOT NULL REFERENCES teams (id),
  user_id    uuid NOT NULL,
  role       text NOT NULL,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memberships_role CHECK (role IN ('owner', 'manager', 'staff')),
  CONSTRAINT memberships_team_user_key UNIQUE (team_id, user_id)
);
-- Exactly one active owner per team (D2).
CREATE UNIQUE INDEX memberships_one_owner_idx ON memberships (team_id) WHERE role = 'owner' AND removed_at IS NULL;
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       uuid NOT NULL REFERENCES teams (id),
  email         text NOT NULL,
  role          text NOT NULL,
  selector      text NOT NULL,
  verifier_hash text NOT NULL,
  invited_by    uuid NOT NULL,
  expires_at    timestamptz NOT NULL,
  accepted_at   timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invites_email_lower CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254),
  CONSTRAINT invites_role CHECK (role IN ('manager', 'staff')),
  CONSTRAINT invites_verifier_argon2id CHECK (verifier_hash LIKE '$argon2id$%'),
  CONSTRAINT invites_selector_key UNIQUE (selector)
);
-- One open invitation per team and email; a resend replaces it.
CREATE UNIQUE INDEX invites_one_open_idx ON invites (team_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX invites_expires_idx ON invites (expires_at) WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE shifts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id          uuid NOT NULL REFERENCES teams (id),
  assigned_user_id uuid NOT NULL,
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  label            text NOT NULL,
  notes            text,
  created_by       uuid NOT NULL,
  deleted_at       timestamptz,
  deleted_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  search           tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce(label, '') || ' ' || coalesce(notes, ''))) STORED,
  CONSTRAINT shifts_time_order CHECK (ends_at > starts_at),
  CONSTRAINT shifts_label_len CHECK (char_length(label) BETWEEN 1 AND 100),
  CONSTRAINT shifts_notes_len CHECK (notes IS NULL OR char_length(notes) <= 2000),
  CONSTRAINT shifts_deleted_pair CHECK ((deleted_at IS NULL) = (deleted_by IS NULL)),
  CONSTRAINT shifts_team_id_key UNIQUE (team_id, id),
  -- A cross-team assignment is impossible: the assignee must be a membership of the SAME team.
  CONSTRAINT shifts_assignee_fk FOREIGN KEY (team_id, assigned_user_id) REFERENCES memberships (team_id, user_id)
);
CREATE TRIGGER shifts_updated BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX shifts_calendar_idx ON shifts (team_id, starts_at) WHERE deleted_at IS NULL;
CREATE INDEX shifts_assignee_idx ON shifts (team_id, assigned_user_id, starts_at) WHERE deleted_at IS NULL;
CREATE INDEX shifts_deleted_idx ON shifts (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX shifts_search_idx ON shifts USING gin (search);

CREATE TABLE swap_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id        uuid NOT NULL REFERENCES teams (id),
  shift_id       uuid NOT NULL,
  requested_by   uuid NOT NULL,
  target_user_id uuid,
  status         text NOT NULL DEFAULT 'pending',
  decided_by     uuid,
  decided_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT swaps_status CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  CONSTRAINT swaps_decision_recorded CHECK (status NOT IN ('approved', 'rejected') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT swaps_shift_fk FOREIGN KEY (team_id, shift_id) REFERENCES shifts (team_id, id),
  CONSTRAINT swaps_requester_fk FOREIGN KEY (team_id, requested_by) REFERENCES memberships (team_id, user_id),
  CONSTRAINT swaps_target_fk FOREIGN KEY (team_id, target_user_id) REFERENCES memberships (team_id, user_id)
);
CREATE TRIGGER swaps_updated BEFORE UPDATE ON swap_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- One pending swap per shift (D2).
CREATE UNIQUE INDEX swaps_one_pending_idx ON swap_requests (shift_id) WHERE status = 'pending';
CREATE INDEX swaps_team_status_idx ON swap_requests (team_id, status, created_at DESC);

CREATE TABLE activity_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       uuid NOT NULL REFERENCES teams (id),
  kind          text NOT NULL,
  actor_user_id uuid,
  subject_id    uuid,
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Never copy display names or emails into data (rule V8, S9); store IDs and join when showing.
  search        tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, coalesce(kind, '') || ' ' || coalesce(data ->> 'label', ''))) STORED,
  CONSTRAINT activity_data_object CHECK (jsonb_typeof(data) = 'object')
);
CREATE INDEX activity_feed_idx ON activity_events (team_id, created_at DESC, id DESC);
CREATE INDEX activity_search_idx ON activity_events USING gin (search);

CREATE TABLE subscriptions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id                  uuid NOT NULL REFERENCES teams (id),
  plan                     text NOT NULL,
  seats                    integer NOT NULL,
  status                   text NOT NULL DEFAULT 'active',
  currency                 text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  period_start             timestamptz NOT NULL,
  period_end               timestamptz NOT NULL,
  scheduled_plan           text,
  scheduled_seats          integer,
  grace_ends_at            timestamptz,
  provider_customer_ref    text,
  -- [OPEN Q6] only if automatic renewal by a saved authorization is chosen. Secret-like: never logged, never returned
  -- by the API, protect at rest (decide in an ADR).
  provider_authorization_ref text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_team_key UNIQUE (team_id),
  CONSTRAINT subscriptions_plan CHECK (plan IN ('starter', 'team', 'business')),
  CONSTRAINT subscriptions_sched_plan CHECK (scheduled_plan IS NULL OR scheduled_plan IN ('starter', 'team', 'business')),
  CONSTRAINT subscriptions_status CHECK (status IN ('active', 'past_due', 'restricted', 'cancelled')),
  CONSTRAINT subscriptions_seats CHECK (seats >= 0),
  CONSTRAINT subscriptions_starter_cap CHECK (plan <> 'starter' OR seats <= 5),
  CONSTRAINT subscriptions_sched_seats CHECK (scheduled_seats IS NULL OR scheduled_seats >= 0),
  CONSTRAINT subscriptions_period CHECK (period_end > period_start),
  CONSTRAINT subscriptions_past_due_has_grace CHECK (status <> 'past_due' OR grace_ends_at IS NOT NULL)
);
CREATE TRIGGER subscriptions_updated BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX subscriptions_renewal_idx ON subscriptions (period_end) WHERE status = 'active';
CREATE INDEX subscriptions_grace_idx ON subscriptions (grace_ends_at) WHERE status = 'past_due';

-- Append-only money record. NO foreign keys on purpose: it must survive a team purge and never be deleted (D3).
-- Money is bigint in the currency's smallest unit (cents, kobo, ...; exponent per currency), whatever the payment provider uses.
-- Sign convention: charge > 0 (the team owes), credit and refund < 0, adjustment either sign but never 0.
CREATE TABLE ledger_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         uuid NOT NULL,
  subscription_id uuid,
  kind            text NOT NULL,
  amount_minor    bigint NOT NULL,
  currency        text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reason          text NOT NULL,
  provider_ref    text,
  idempotency_key text,
  period_start    timestamptz,
  period_end      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_kind CHECK (kind IN ('charge', 'credit', 'refund', 'adjustment')),
  CONSTRAINT ledger_sign CHECK (
    (kind = 'charge' AND amount_minor > 0) OR (kind IN ('credit', 'refund') AND amount_minor < 0)
    OR (kind = 'adjustment' AND amount_minor <> 0)),
  CONSTRAINT ledger_period CHECK (period_start IS NULL OR period_end IS NULL OR period_end > period_start),
  CONSTRAINT ledger_reason_len CHECK (char_length(reason) BETWEEN 1 AND 200)
);
CREATE UNIQUE INDEX ledger_provider_ref_idx ON ledger_entries (provider_ref) WHERE provider_ref IS NOT NULL;
CREATE UNIQUE INDEX ledger_idem_idx ON ledger_entries (team_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ledger_team_idx ON ledger_entries (team_id, created_at DESC);

CREATE FUNCTION ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ledger_entries is append-only' USING ERRCODE = '42501'; END $$;
CREATE TRIGGER ledger_no_row_change BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
CREATE TRIGGER ledger_no_truncate BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_append_only();

CREATE TABLE idempotency_keys (
  scope               text NOT NULL,
  key                 text NOT NULL,
  request_fingerprint text NOT NULL,
  state               text NOT NULL DEFAULT 'in_flight',
  status_code         integer,
  response            jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key),
  CONSTRAINT idem_state CHECK (state IN ('in_flight', 'done'))
);
CREATE INDEX idempotency_created_idx ON idempotency_keys (created_at);

-- Privileges (PRD: "database trigger plus revoked privileges"). A superuser or table owner ignores GRANT/REVOKE, so the
-- application must connect as a NON-owner role. [OPEN] the agent proposes the role names and the env names for it
-- (names only; the setup script generates the password). This block does nothing until the role exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rowta_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entries FROM rowta_app;
  END IF;
END $$;
