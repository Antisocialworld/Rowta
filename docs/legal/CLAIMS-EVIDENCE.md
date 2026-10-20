> **DRAFT — not legal advice.** Review by a qualified lawyer before launch.

# Claims and evidence (Phase 11 public pages)

Every factual claim in the web copy, with its status and the evidence behind it (L2).

- **ACTIVE** — true in the repository today, with the path as evidence.
- **PLANNED** — written in the product plan and/or partially built, not yet running end to end.
- **NOT VERIFIED** — written by secondary sources or awaiting an owner check; never stated as fact publicly
  without the DRAFT banner.

## Data, retention and deletion

| Claim in the copy | Status | Evidence |
|---|---|---|
| Account data: deletion request → 30-day grace → hard delete by a scheduled job | PLANNED | `.agents/PRD/PRD-001-rowta.md` 7.3/8.10; purge jobs not shipped yet |
| Soft-deleted shifts purged after 90 days | PLANNED | PRD 7.3; purge job not shipped |
| Tokens/codes purged 7 days after expiry | PLANNED | PRD 7.3 |
| Idempotency keys purged after 48 hours | PLANNED | PRD 7.3 |
| Notification log/push tickets 30 days | PLANNED | PRD 7.3, marked "[DECISION: proposed, not agreed]" — public copy says "proposed, not final" |
| Ledger entries never deleted, contain no personal data | ACTIVE (schema) / PLANNED (no payments yet) | `server/prisma/sql/020-team.sql:153` `CREATE TABLE ledger_entries`; append-only rule in PRD 8.10 |
| Payment intents kept until a tax adviser sets the period | NOT VERIFIED (open owner decision) | PRD 7.3 "[DECISION, VERIFY]" |
| Activity events lose the user reference at account purge | PLANNED | PRD 8.10 |
| Team deletion keeps ledger + minimal tombstone team row | PLANNED | PRD 8.10 |
| Sign-in links expire after 5 minutes (owner decision), single use | PLANNED | Owner input 20 Oct 2026; conflicts with PRD/rule A13 "15 minutes" (mismatch listed in OWNER-INPUTS.md); auth not built |
| Access token 15 minutes / refresh token 30 days | PLANNED | PRD 15 defaults; not built |
| Website stores nothing: no cookies, no localStorage, no analytics | ACTIVE | `web/build.mjs` output + `web/tests/test-content-safety.mjs` and `test-links.mjs`; only same-origin assets |

## Accounts and security

| Claim | Status | Evidence |
|---|---|---|
| Passwords stored as Argon2id hashes, never readable | PLANNED | Rule A1 in `.agents/rules/02-auth-credentials.md`; server auth ships in Phase 2 — no hash code exists yet |
| Logs redact passwords, codes, tokens | ACTIVE | `server/src/lib/logger.ts` (`REDACT_PATHS`), test `server/tests/redaction.test.ts` |
| Sign-in failure wording is uniform (no account enumeration) | PLANNED | Rules A5/A6; not built |
| Web pages contain no secrets/tokens | ACTIVE | `web/tests/test-content-safety.mjs` scans every built page and legal doc |
| Transmission security (TLS) on the production site | NOT VERIFIED | Backend/host undecided (PRD 15 Q8); the owner's Vercel site would serve HTTPS, but that is a host setting — verify at deploy |

## Billing

| Claim | Status | Evidence |
|---|---|---|
| Plans/seat prices (USD list): Starter 2000, Team 5000, Business 1200; extra seats 300/200 cents | ACTIVE (as product prices) | PRD 5 |
| Owner does not count as a seat; Starter hard cap 5; ceiling 200 | ACTIVE (product rule) | PRD 5, `MAX_SEATS_CEILING=200` in `.env.example` |
| Proration: upgrade charged today, downgrade/removal at period end, rounding down | ACTIVE (rule written) / PLANNED (software) | PRD 8.6 with worked examples; billing code ships Phase 7 |
| 7-day grace, notices day 0/3/6, then restricted state (view only) | PLANNED | PRD 8.6; cron/notifications not built |
| Payments run in test mode today (`PAYMENT_MODE=test`) | ACTIVE | `.env.example`, PRD Q4 (Flutterwave test mode) |
| No refund on team deletion at period end | ACTIVE (product rule) | PRD 8.10 |
| Refund policy otherwise | OPEN owner decision | Not defined in the PRD — public copy shows the placeholder |
| Store billing rules may apply in production | ACTIVE (as a statement) | README "App-store billing note": written in Phase 12 from current policies — public copy mirrors that status |
| Receipts, not tax invoices; no VAT calculation | ACTIVE (design position) / NOT VERIFIED (legality) | `docs/TAX-NOTES.md` |

## People and content

| Claim | Status | Evidence |
|---|---|---|
| Landing privacy line: "Your team's data stays inside your team." (owner copy lock, 20 Oct 2026 — kept because code + PRD support it) | ACTIVE (design + schema) / PLANNED (end-to-end tests) | Rule S7 `.agents/rules/01-secrets.md:38` (every team-scoped query takes a required `teamId`); PRD `.agents/PRD/PRD-001-rowta.md:161` (every row carries `team_id`) and `:218` (composite FK makes cross-team assignment impossible); code `server/src/db/clients.ts:40` `forTeam(teamId)`; applied schema `server/prisma/sql/020-team.sql:73` `shifts_assignee_fk` (Phase 0 self-tested as owner and app role). Team-isolation integration tests are planned (testing recipe), not yet written. |
| Minimum age 16, no marketing to children, no age data on the website | ACTIVE (owner input) | Owner decision 20 Oct 2026; website collects nothing (`test-content-safety.mjs`) |
| Display name shown to teammates instead of email | PLANNED | PRD 7.1 + privacy-recipe owner decision 18 Oct 2026; app shows it (Phase 1 kit), server rules ship later |
| Country chosen at sign-up sets currency; never derived from IP | PLANNED | PRD 5 + owner decision 18 Oct 2026 |
| Quiet hours delay notifications | PLANNED | PRD 8.8; jobs not built |
| Offline shows upcoming shifts with "last updated" | PLANNED | PRD 8.9; not built |
| No ads, no analytics, no selling data | ACTIVE | No analytics/ad dependency in any package.json; no third-party scripts in `web/dist` (link test asserts external URLs are only the PUBLIC_WEB_URL origin) |
| Push tokens removed at logout-all / invalid cleanup / purge | PLANNED | PRD 8.7, 7.3; not built |

## Subprocessors

| Claim | Status | Evidence |
|---|---|---|
| Vercel will host the website | PLANNED (not deployed) | PRD 10; agent never deploys (P1) |
| Flutterwave is the named payment provider | ACTIVE (configured) / PLANNED (integration) | `.env.example` `PAYMENT_PROVIDER=flutterwave`, `PAYMENT_MODE=test`; no SDK in `server/package.json` yet |
| Nodemailer over SMTP for email | ACTIVE (code) / owner must choose provider | `server/package.json` dependency `nodemailer 10.1.7`; `.env.example` SMTP names |
| Expo push for notifications | PLANNED | `expo-notifications` in `app/package.json`; sending ships later |
| PostgreSQL and Redis run locally today | ACTIVE | `docker-compose.yml`; production host undecided (PRD 15 Q8) |
| Sentry NOT in use | ACTIVE (negative claim) | No `@sentry/*` dependency anywhere; only env names in `.env.example` |

## Legal notices (structure, not claims)

| Claim | Status | Evidence |
|---|---|---|
| Region notices cite laws by name only, tagged "verify current text" | ACTIVE (as written) | `docs/legal/privacy.md`; legal accuracy NOT VERIFIED — lawyer review is an owner to-do |
| 72-hour NDPC breach notification (incident note, internal) | NOT VERIFIED | Reported by commentary in `.agents/skills/rowta-privacy-recipes/SKILL.md` §8; not checked against the NDPC text |
| Governing law Nigeria, courts [OWNER: city] | ACTIVE (owner input) / placeholder open | Owner decision 20 Oct 2026 |
