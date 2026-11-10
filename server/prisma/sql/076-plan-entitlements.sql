-- 076-plan-entitlements.sql
-- Forward-only migration: plan_entitlements table (db0 global, idempotent).
-- Apply to DB0 only, after 010-global.sql.
-- Prices and limits are DATA, not code. NGN only; USD is NOT seeded (disabled, unsold).
-- All amounts in kobo (NGN minor unit = 2 decimals). Yearly = 12 x monthly, no discount.
CREATE TABLE IF NOT EXISTS plan_entitlements (
  interval text NOT NULL CHECK (interval IN ('monthly', 'yearly')),
  base_price_minor bigint NOT NULL CHECK (base_price_minor > 0),
  free_teams int NOT NULL CHECK (free_teams >= 0),
  extra_team_price_minor bigint NOT NULL CHECK (extra_team_price_minor > 0),
  people_per_team int NOT NULL CHECK (people_per_team > 0),
  extra_person_price_minor bigint NOT NULL CHECK (extra_person_price_minor > 0),
  max_teams int NOT NULL CHECK (max_teams > 0),
  max_people_per_team int NOT NULL CHECK (max_people_per_team > 0),
  trial_days int NOT NULL CHECK (trial_days > 0),
  trial_teams int NOT NULL CHECK (trial_teams > 0),
  trial_people int NOT NULL CHECK (trial_people > 0),
  min_addon_charge_minor bigint NOT NULL CHECK (min_addon_charge_minor > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (interval)
);

-- Seed: monthly and yearly plans (NGN only).
INSERT INTO plan_entitlements (
  interval, base_price_minor, free_teams, extra_team_price_minor,
  people_per_team, extra_person_price_minor, max_teams, max_people_per_team,
  trial_days, trial_teams, trial_people, min_addon_charge_minor
) VALUES
  ('monthly', 650000, 2, 200000, 10, 20000, 20, 50, 14, 1, 10, 50000),
  ('yearly', 7800000, 3, 2400000, 10, 240000, 20, 50, 14, 1, 10, 50000)
ON CONFLICT (interval) DO UPDATE SET
  base_price_minor = EXCLUDED.base_price_minor,
  free_teams = EXCLUDED.free_teams,
  extra_team_price_minor = EXCLUDED.extra_team_price_minor,
  people_per_team = EXCLUDED.people_per_team,
  extra_person_price_minor = EXCLUDED.extra_person_price_minor,
  max_teams = EXCLUDED.max_teams,
  max_people_per_team = EXCLUDED.max_people_per_team,
  trial_days = EXCLUDED.trial_days,
  trial_teams = EXCLUDED.trial_teams,
  trial_people = EXCLUDED.trial_people,
  min_addon_charge_minor = EXCLUDED.min_addon_charge_minor;

-- USD is deliberately NOT seeded: no country maps to USD, no plan_prices in USD are sold.
