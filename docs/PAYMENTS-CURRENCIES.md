# PAYMENTS-CURRENCIES.md — where the currency and country lists come from

State: the `currencies` and `countries` tables in DB0 are seeded from the cited sources below
(23 October 2026, `scripts/db-seed-reference.mjs`). Two parts of this document are still open and
are marked **[VERIFY]**: the provider's supported-currency list (PRD 5, Phase 7) and the per-country
tax notes (they live in `TAX-NOTES.md`).

## What is seeded, and from where

| Table | Rows | Source (pinned) | Licence | File read |
|---|---|---|---|---|
| `countries` | 249 | `i18n-iso-countries@7.14.0` (npm) | MIT | `langs/en.json` (ISO 3166-1 alpha-2 codes + English names) |
| `currencies` | 153 | `cldr-core@45.0.0` (npm, Unicode CLDR 45) | Unicode-3.0 | `supplemental/currencyData.json` (`fractions` = ISO 4217 minor units) |
| `currencies.name` | 153 | `cldr-numbers-modern@45.0.0` (npm) | Unicode-3.0 | `main/en/currencies.json` (`displayName`) |
| country → currency | 249 | `cldr-core@45.0.0` | Unicode-3.0 | `currencyData.region` (per-territory currency validity) |

- npm pages: <https://www.npmjs.com/package/i18n-iso-countries>, <https://www.npmjs.com/package/cldr-core>,
  <https://www.npmjs.com/package/cldr-numbers-modern>. Upstream: <https://github.com/michaelwittig/node-i18n-iso-countries>,
  <https://github.com/unicode-cldr/cldr-json>, <https://cldr.unicode.org>.
- All three are devDependencies of the repo root; the seed script fails loudly if they are missing.
  Nothing is typed from memory: the script reads the three JSON files and validates every row.

## Selection rules (the script applies exactly these)

1. **One row per ISO alpha-2 code the package ships** (250 codes; 249 land in the table, see the
   skip rule). The package carries `XK` (Kosovo), which is user-assigned and **not** officially in
   ISO 3166-1; it is kept so people in Kosovo can sign up. Deviation from strict ISO: 1 code.
2. **A country's currency is the first CLDR region entry that is current and tender**: an entry with
   no `_to` date and `_tender` not `"false"`. For the six countries where CLDR lists more than one
   current tender currency, CLDR's own order wins (domestic currency listed first):
   `BT` BTN (also INR), `HT` HTG (also USD), `LS` LSL (also ZAR), `NA` NAD (also ZAR),
   `PS` ILS (also JOD), `PA` PAB (also USD). One currency per country because `countries.currency`
   is a single foreign key (PRD 5: the country decides the payment currency).
3. **Skip countries with no current tender currency**: only `AQ` (Antarctica; CLDR lists sole entry
   `XXX`, marked not tender). Nothing else was skipped.
4. **`minor_unit`** = the CLDR `fractions[code]._digits` value for that currency, else the CLDR
   `DEFAULT` (2). Validated against the table CHECK (0–3) before writing. Spot checks: `NGN` 2,
   `JPY` 0, `BHD` 3, `USD` 2. (`CLF` and `UYW` carry 4 digits in CLDR but are never a current
   tender, so they never reach the table.)
5. **English names**: country = the package's first English name (arrays like `US` take the first
   entry, "United States of America"); currency = CLDR's English `displayName` ("Nigerian Naira").

## Flags: nothing is sold yet

Every currency row is seeded `provider_supported = false, enabled = false`. PRD 5 defines a SOLD
currency as: `enabled` **and** the provider supports it **and** `plan_prices` has a row for every
plan. Therefore:

- **`plan_prices` is untouched** — the owner supplies prices for every currency to be sold
  (PRD OPEN Q12). No price is invented anywhere in this repo.
- **Provider support is [VERIFY]** — Flutterwave's supported-currency list must be checked on the
  provider's official page in Phase 7 (test mode); until then no currency is marked supported.
- The seed's `UPDATE` never rewrites `enabled`/`provider_supported`, so the owner (or the Phase 7
  slice) can flip the flags and a later seed re-run keeps them.

## How to re-run

```
node scripts/db-seed-reference.mjs --check   # plan + counts, writes nothing
node scripts/db-seed-reference.mjs           # converge db0 (idempotent; refuses NODE_ENV=production)
```

Re-running with unchanged sources changes nothing (`INSERT 0 0` on both tables). Rows are only
inserted or updated when a name, minor unit or mapping differs; nothing is ever deleted. Only db0
is touched (these are global tables, docs/DATABASE.md section 2).

## The offer list vs PRD 5 (known mismatch, reported 23 Oct 2026)

PRD 5 and 8.1: the sign-up country list offers **only** countries whose currency is SOLD. Today
`listCountries` (`server/src/auth/service.ts`) returns every `countries` row unfiltered, and sign-up
accepts any code in the table. With this seed, 249 countries are offered while **zero** currencies
are sold. Options and the recommendation are in the agent's report for this step; the fix (filter by
`currencies.enabled` + complete `plan_prices`, or keep the table as a sold-only list) belongs to the
payments phase together with the owner's Q12 answer. Until then this table is reference data for
development, not the production offer.
