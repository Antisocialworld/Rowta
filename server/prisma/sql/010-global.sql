-- Rowta reference DDL, part 1: GLOBAL tables. Apply to DB0 ONLY (DB0 is also shard 0, so it ALSO gets 020-team.sql).
-- Requires 000-common.sql first.

-- Reference data for money and places. The tables ship EMPTY: the build seeds them from cited sources (PRD 5, Q12).
CREATE TABLE currencies (
  code               text PRIMARY KEY,
  name               text NOT NULL,
  minor_unit         smallint NOT NULL,
  provider_supported boolean NOT NULL DEFAULT false,
  enabled            boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT currencies_code CHECK (code ~ '^[A-Z]{3}$'),
  CONSTRAINT currencies_name_len CHECK (char_length(name) BETWEEN 1 AND 100),
  CONSTRAINT currencies_minor_unit CHECK (minor_unit BETWEEN 0 AND 3),
  CONSTRAINT currencies_enabled_needs_provider CHECK (NOT enabled OR provider_supported)
);
CREATE TRIGGER currencies_updated BEFORE UPDATE ON currencies FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE countries (
  code     text PRIMARY KEY,
  name     text NOT NULL,
  currency text NOT NULL REFERENCES currencies (code),
  CONSTRAINT countries_code CHECK (code ~ '^[A-Z]{2}$'),
  CONSTRAINT countries_name_len CHECK (char_length(name) BETWEEN 1 AND 100)
);
CREATE INDEX countries_currency_idx ON countries (currency);

-- One fixed, exact price per plan per currency (no run-time exchange rate). Starter has no extra-seat price (hard cap 5).
CREATE TABLE plan_prices (
  plan             text NOT NULL,
  currency         text NOT NULL REFERENCES currencies (code),
  base_minor       bigint NOT NULL,
  extra_seat_minor bigint,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan, currency),
  CONSTRAINT plan_prices_plan CHECK (plan IN ('starter', 'team', 'business')),
  CONSTRAINT plan_prices_base_positive CHECK (base_minor > 0),
  CONSTRAINT plan_prices_extra_positive CHECK (extra_seat_minor IS NULL OR extra_seat_minor > 0),
  CONSTRAINT plan_prices_starter_no_extra CHECK ((plan = 'starter') = (extra_seat_minor IS NULL))
);

CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 text NOT NULL,
  display_name          text NOT NULL,
  country               text NOT NULL REFERENCES countries (code),
  password_hash         text NOT NULL,
  email_verified_at     timestamptz,
  status                text NOT NULL DEFAULT 'active',
  deletion_requested_at timestamptz,
  deleted_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lower CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254),
  CONSTRAINT users_name_len CHECK (char_length(display_name) BETWEEN 1 AND 60),
  CONSTRAINT users_name_trimmed CHECK (display_name = btrim(display_name)),
  CONSTRAINT users_name_no_control CHECK (display_name !~ '[[:cntrl:]]'),
  CONSTRAINT users_password_argon2id CHECK (password_hash LIKE '$argon2id$%'),
  CONSTRAINT users_status CHECK (status IN ('active', 'pending_deletion')),
  CONSTRAINT users_pending_needs_time CHECK (status <> 'pending_deletion' OR deletion_requested_at IS NOT NULL)
);
CREATE UNIQUE INDEX users_email_key ON users (email);
CREATE INDEX users_pending_deletion_idx ON users (deletion_requested_at) WHERE status = 'pending_deletion';
CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE pending_signups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  display_name  text NOT NULL,
  country       text NOT NULL REFERENCES countries (code),
  password_hash text NOT NULL,
  code_hash     text NOT NULL,
  attempts      integer NOT NULL DEFAULT 0,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pending_email_lower CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254),
  CONSTRAINT pending_name_len CHECK (char_length(display_name) BETWEEN 1 AND 60),
  CONSTRAINT pending_name_trimmed CHECK (display_name = btrim(display_name)),
  CONSTRAINT pending_name_no_control CHECK (display_name !~ '[[:cntrl:]]'),
  CONSTRAINT pending_password_argon2id CHECK (password_hash LIKE '$argon2id$%'),
  CONSTRAINT pending_code_argon2id CHECK (code_hash LIKE '$argon2id$%'),
  CONSTRAINT pending_attempts CHECK (attempts >= 0)
);
CREATE UNIQUE INDEX pending_signups_email_key ON pending_signups (email);
CREATE INDEX pending_signups_expires_idx ON pending_signups (expires_at);

CREATE TABLE sent_emails (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind    text NOT NULL,
  ref     text NOT NULL DEFAULT '',
  sent_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sent_emails_once UNIQUE (user_id, kind, ref)
);

CREATE TABLE devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  device_id    text NOT NULL,
  push_token   text,
  platform     text NOT NULL DEFAULT 'android',
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT devices_platform CHECK (platform IN ('android', 'ios', 'web')),
  CONSTRAINT devices_user_device_key UNIQUE (user_id, device_id)
);

CREATE TABLE refresh_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  selector      text NOT NULL,
  verifier_hash text NOT NULL,
  family_id     uuid NOT NULL,
  parent_id     uuid REFERENCES refresh_tokens (id) ON DELETE SET NULL,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  device_id     uuid REFERENCES devices (id) ON DELETE SET NULL,
  used_at       timestamptz,
  revoked_at    timestamptz,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refresh_verifier_argon2id CHECK (verifier_hash LIKE '$argon2id$%'),
  CONSTRAINT refresh_selector_key UNIQUE (selector)
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_expires_idx ON refresh_tokens (expires_at);

CREATE TABLE password_resets (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash            text NOT NULL,
  attempts             integer NOT NULL DEFAULT 0,
  expires_at           timestamptz NOT NULL,
  consumed_at          timestamptz,
  grant_selector       text,
  grant_verifier_hash  text,
  grant_expires_at     timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reset_code_argon2id CHECK (code_hash LIKE '$argon2id$%'),
  CONSTRAINT reset_grant_argon2id CHECK (grant_verifier_hash IS NULL OR grant_verifier_hash LIKE '$argon2id$%'),
  CONSTRAINT reset_grant_complete CHECK ((grant_selector IS NULL) = (grant_verifier_hash IS NULL)
                                         AND (grant_selector IS NULL) = (grant_expires_at IS NULL)),
  CONSTRAINT reset_attempts CHECK (attempts >= 0),
  CONSTRAINT reset_grant_selector_key UNIQUE (grant_selector)
);
CREATE UNIQUE INDEX password_resets_one_active_idx ON password_resets (user_id) WHERE consumed_at IS NULL;
CREATE INDEX password_resets_expires_idx ON password_resets (expires_at);

CREATE TABLE magic_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  selector      text NOT NULL,
  verifier_hash text NOT NULL,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT magic_verifier_argon2id CHECK (verifier_hash LIKE '$argon2id$%'),
  CONSTRAINT magic_selector_key UNIQUE (selector)
);
CREATE INDEX magic_tokens_user_idx ON magic_tokens (user_id);
CREATE INDEX magic_tokens_expires_idx ON magic_tokens (expires_at);

CREATE TABLE user_settings (
  user_id              uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  quiet_start          time,
  quiet_end            time,
  time_zone            text NOT NULL DEFAULT 'UTC',
  notify_shift_changes boolean NOT NULL DEFAULT true,
  notify_swaps         boolean NOT NULL DEFAULT true,
  notify_billing       boolean NOT NULL DEFAULT true,
  language             text NOT NULL DEFAULT 'en',
  theme                text NOT NULL DEFAULT 'system',
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settings_quiet_pair CHECK ((quiet_start IS NULL) = (quiet_end IS NULL)),
  CONSTRAINT settings_language CHECK (language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  CONSTRAINT settings_theme CHECK (theme IN ('system', 'light', 'dark'))
);
-- updated_at is set by the SERVER on each change (last write wins, PRD 8.8).
CREATE TRIGGER user_settings_updated BEFORE UPDATE ON user_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE push_tickets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id  uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  ticket_ref text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz,
  CONSTRAINT push_tickets_ref_key UNIQUE (ticket_ref)
);
CREATE INDEX push_tickets_unchecked_idx ON push_tickets (created_at) WHERE checked_at IS NULL;

CREATE TABLE notification_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  team_id    uuid,
  kind       text NOT NULL,
  ref        text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_once UNIQUE (user_id, kind, ref)
);
CREATE INDEX notification_log_created_idx ON notification_log (created_at);

CREATE TABLE team_directory (
  team_id        uuid PRIMARY KEY,
  shard          smallint NOT NULL,
  override_shard smallint,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT directory_shard CHECK (shard IN (0, 1)),
  CONSTRAINT directory_override CHECK (override_shard IS NULL OR override_shard IN (0, 1))
);

-- Rule S8: NO role column here. Roles are read from memberships on every request.
CREATE TABLE user_team_index (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  team_id uuid NOT NULL,
  PRIMARY KEY (user_id, team_id)
);
CREATE INDEX user_team_index_team_idx ON user_team_index (team_id);

-- Payment intents and webhook events are GLOBAL on purpose: a webhook arrives knowing only a transaction reference,
-- not the team's shard. The intent row says what amount (minor units) and currency we expect; the webhook handler
-- re-verifies the provider's amount against it (PRD 8.6) and then writes the ledger on the team's shard.
CREATE TABLE payment_intents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         uuid NOT NULL,
  tx_ref          text NOT NULL,
  purpose         text NOT NULL,
  amount_minor    bigint NOT NULL,
  currency        text NOT NULL REFERENCES currencies (code),
  status          text NOT NULL DEFAULT 'pending',
  idempotency_key text,
  provider_ref    text,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  CONSTRAINT intents_purpose CHECK (purpose IN ('upgrade', 'seats', 'renewal', 'plan_change')),
  CONSTRAINT intents_amount_positive CHECK (amount_minor > 0),
  CONSTRAINT intents_status CHECK (status IN ('pending', 'succeeded', 'failed', 'expired')),
  CONSTRAINT intents_done_has_time CHECK (status = 'pending' OR completed_at IS NOT NULL),
  CONSTRAINT intents_tx_ref_key UNIQUE (tx_ref)
);
CREATE UNIQUE INDEX payment_intents_idem_idx ON payment_intents (team_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX payment_intents_provider_ref_idx ON payment_intents (provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX payment_intents_pending_idx ON payment_intents (created_at) WHERE status = 'pending';
CREATE INDEX payment_intents_team_idx ON payment_intents (team_id, created_at DESC);

-- No payload is stored (it holds customer data). Only what is needed to process once and trace.
CREATE TABLE webhook_events (
  provider          text NOT NULL,
  provider_event_id text NOT NULL,
  event_type        text,
  tx_ref            text,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  status            text NOT NULL DEFAULT 'received',
  PRIMARY KEY (provider, provider_event_id),
  CONSTRAINT webhook_status CHECK (status IN ('received', 'processed', 'ignored', 'failed'))
);
CREATE INDEX webhook_events_status_idx ON webhook_events (received_at) WHERE status IN ('received', 'failed');
CREATE INDEX webhook_events_tx_ref_idx ON webhook_events (tx_ref) WHERE tx_ref IS NOT NULL;
