-- 075-owner-accounts.sql
-- Forward-only migration: owner_accounts table (db0 global, idempotent).
-- Apply to DB0 only, after 010-global.sql.
-- One row per paying user account. The account (not the team) holds the subscription.
-- user_id references users (global, db0); no cross-database FK issues because owner_accounts
-- lives on db0 where users also lives.
-- provider_authorization_ref is secret-like: never logged, never returned by any API.
CREATE TABLE IF NOT EXISTS owner_accounts (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan text NOT NULL CHECK (plan IN ('monthly', 'yearly')),
  status text NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'read_only', 'cancelled')),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  trial_used boolean NOT NULL DEFAULT false,
  period_start timestamptz,
  period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  currency text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  provider_customer_ref text,
  provider_authorization_ref text,
  grace_ends_at timestamptz,
  lapsed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A user can only ever start ONE trial: trial_used is unique among rows where it is true.
-- Because user_id is the PK there is one row per user; this index guarantees a trial can be
-- started once and never reset to allow a second trial.
CREATE UNIQUE INDEX IF NOT EXISTS owner_accounts_one_trial_idx
  ON owner_accounts (user_id)
  WHERE trial_used = true;

-- App role can read/update owner_accounts (charging, plan changes, grace). Grants are in 079.
