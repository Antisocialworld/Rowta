# Payments — Currencies

Rowta is sold in **NGN (Nigerian naira) only**. USD and every other currency stay disabled and unsold. No USD price, and no hard-coded price of any kind, may exist in production code or in the real seed. The PRD's USD list (Starter 2000; Team 5000 + 300 per extra seat; Business 12000 + 200 per extra seat, in cents) is a **test fixture only** for reproducing the PRD's printed proration rows.

## Supported currencies

| Code | Name | Minor unit (decimals) | Provider supported | Enabled | Sold | Price rows |
|------|------|----------------------|-------------------|---------|------|------------|
| NGN | Nigerian naira | 2 | true | true | Yes | Yes (owner-supplied, kobo) |
| USD | US dollar | 2 | false | false | No | No (test fixture only) |
| JPY | Japanese yen | 0 | false | false | No | No |
| GBP | Pound sterling | 2 | false | false | No | No |
| KWD | Kuwaiti dinar | 3 | false | false | No | No |

## Currency rule

A currency is **sold** only if all three conditions hold:
1. `currencies.enabled = true`
2. `currencies.provider_supported = true`
3. `plan_prices` has a row for every plan (starter, team, business) in that currency

No fallback currency exists. If a currency is not sold, its country is not offered at sign-up.

## Locked currency

The payment currency is the paying user's country currency, fixed at the **first purchase** and locked on `subscriptions.currency` for the subscription's life. A later country change affects only a **new** subscription. There is no exchange rate and no conversion.

## NGN price table (owner-supplied, 6 Nov 2026)

All amounts in kobo (NGN minor unit = 2 decimals).

| Plan | Base (kobo) | Extra seat (kobo) | Included seats | Hard cap |
|------|-------------|-------------------|----------------|----------|
| Starter | 650000 | Not available | 5 | 5 |
| Team | 1625000 | 97500 | 15 | 200 |
| Business | 3900000 | 65000 | 40 | 200 |

## Yearly billing

Yearly = 12 × monthly for every plan and extra seat. No discount. Same `plan_prices` rows; interval chosen at first purchase and locked for the subscription's life. Changing interval mid-subscription is rejected.

## Sources

- ISO 4217: NGN = Nigerian naira, minor unit 2
- ISO 3166-1: NG = Nigeria
- Currency data seeded via `server/prisma/sql/071-ngn-seed.sql` (DB0 only, idempotent)
- NGN price rows seeded via the same file (owner-supplied)
- USD rows in `server/prisma/sql/selftest.sql` are test data only; not copied into any real seed

## Account-level plan data (C2/C7)

Account-level pricing and limits live in `plan_entitlements` (db0, seeded by `076-plan-entitlements.sql`),
which supersedes the per-team `plan_prices` table for account-level billing. `plan_prices` remains as legacy
for the per-team subscription flow. NGN only; USD is not seeded and not sold.

## Adding a currency (owner decision)

1. Add the currency to `currencies` with `minor_unit`, `provider_supported = true`, `enabled = true`
2. Add the country to `countries` mapping to the currency
3. Add `plan_prices` rows for all three plans (starter, team, business)
4. Only then is the currency sold and its country offered at sign-up
