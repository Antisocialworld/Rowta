# Rowta documentation index

| Document | Purpose | Written in | State |
|---|---|---|---|
| [SETUP.md](SETUP.md) | owner setup: `.env`, secrets, databases, local test targets (§4c), running locally, pre-report checks | scaffold; extended Phase 0, Phase 3 and the 28 Oct overnight run | written (checked against the scripts in this session) |
| [BUILD-PROGRESS.md](BUILD-PROGRESS.md) | real state of every phase, session log, known problems, not-verified list | every phase | current through Phase 5 (Phase 5 built; server & pure-logic proven by owner test runs 28 Oct 2026; app screens pending review) |
| [AGENT-PROMPT.md](AGENT-PROMPT.md) | the full-build prompt to paste into the coding agent | scaffold | written |
| [AGENT-SETUP.md](AGENT-SETUP.md) | rules, skills, activation modes and how to check them | scaffold | written |
| [SECURITY.md](SECURITY.md) | secret handling, public values, 8 threats, dev-only code (component gallery gate added 28 Oct) | every phase | current through Phase 3 |
| [LEARNING-LOG.md](LEARNING-LOG.md) | draft entries for the owner to rewrite, plus the 8 interview answers | every phase | draft entries present |
| ARCHITECTURE.md | diagram, pools, caching table | Phase 10 | not written |
| PRORATION.md | formula, rounding, the 11 test rows | Phase 7 | not written |
| STATE.md | where each piece of data lives and why | Phase 8 | not written |
| SHARDING.md | shard key, large teams, costs | Phase 10 | not written |
| cron-registry.md | every schedule, purpose, lock key | Phase 6 | not written — the single source of truth lives in `server/src/cron/registry.ts`; generation from it is a later-phase item |
| payment-trace.md | tracing one payment through logs and ledger | Phase 7 | not written |
| [DATABASE.md](DATABASE.md) | every table, column, constraint and index, generated from a real PostgreSQL loaded with `server/prisma/sql` | Phase 2 | written — regenerate after any schema change |
| [TAX-NOTES.md](TAX-NOTES.md) | VAT, invoices and e-invoicing: what Rowta does not do, sources, unverified items | Phase 12 | written (draft, unverified) |
| [PAYMENTS-CURRENCIES.md](PAYMENTS-CURRENCIES.md) | sources for the currency and country lists, the provider's supported currencies and amount units, tax notes per country | Phase 7 (country/currency sources written 23 Oct 2026) | country + currency sources written; provider list and tax notes [VERIFY] |
| PRIVACY.md | data inventory, processors, retention, deletion, privacy page text | Phase 9 | not written — the public privacy page source is `legal/privacy.md` |
| [BRANDING.md](BRANDING.md) | how to replace the logo and rebuild icons | Phase 1 | written |
| [DEPLOY.md](DEPLOY.md) | owner deploy steps (web, API, worker, Redis) | Phase 12 | written |
| OWNER-CHECKLIST.md | what only the owner can do | end of build | not written |
| AUDIT-NOTES.md | [VERIFY] items, deviations, unverified items | end of build | not written |
| `legal/` | public page sources read by `web/build.mjs` (privacy, terms, billing, deletion, retention, subprocessors, accessibility, contact, landing, audit, incident response) + owner inputs and open decisions | Phase 11 (owner copy lock 20 Oct 2026) | written; open items in [legal/OWNER-INPUTS.md](legal/OWNER-INPUTS.md) |
| `decisions/` | one short ADR per important choice | every phase | 16 ADRs (0001–0016); ADR 0016 for Phase 5 |
| `gates/` | saved gate evidence per phase + raw evidence files (e2e, address strip, web-app button, dev tools, test isolation, db cleanup, phase-4 server/explain/app) | every phase | written for Phases 0, 0-b, 1, 2, 3, 4, 5, 11 and the 28 Oct overnight run |
| `a11y/` | TalkBack and NVDA checklist per screen, contrast report | every phase | auth-page, teams, phase-4, phase-5, web-invite, web-magic, contrast written (device/NVDA passes still pending) |
| `ui-matrix/` | screenshots across the size matrix + the capture procedure | Phase 1 onward | 40 files — web renders and gallery captures; the Android PRD 6.3 size matrix is NOT captured (no device/emulator) |

Rule: a document is marked "written" only after the content was checked against the real code.
