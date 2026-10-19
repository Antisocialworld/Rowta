# Rowta documentation index

| Document | Purpose | Written in | State |
|---|---|---|---|
| [SETUP.md](SETUP.md) | owner setup: `.env`, secrets, running locally | scaffold, extended in Phase 0 | started |
| [BUILD-PROGRESS.md](BUILD-PROGRESS.md) | real state of every phase | every phase | started |
| [AGENT-PROMPT.md](AGENT-PROMPT.md) | the full-build prompt to paste into the coding agent | scaffold | written |
| [AGENT-SETUP.md](AGENT-SETUP.md) | rules, skills, activation modes and how to check them | scaffold | written |
| [SECURITY.md](SECURITY.md) | secret handling, public values, 8 threats, dev-only code | every phase | skeleton |
| [LEARNING-LOG.md](LEARNING-LOG.md) | draft entries for the owner to rewrite, plus the 8 interview answers | every phase | empty |
| ARCHITECTURE.md | diagram, pools, caching table | Phase 10 | not written |
| PRORATION.md | formula, rounding, the 11 test rows | Phase 7 | not written |
| STATE.md | where each piece of data lives and why | Phase 8 | not written |
| SHARDING.md | shard key, large teams, costs | Phase 10 | not written |
| cron-registry.md | every schedule, purpose, lock key | Phase 6 | not written |
| payment-trace.md | tracing one payment through logs and ledger | Phase 7 | not written |
| DATABASE.md | every table, column, constraint and index, generated from a real PostgreSQL loaded with server/prisma/sql | Phase 2 | written (regenerate after schema changes) |
| TAX-NOTES.md | VAT, invoices and e-invoicing: what Rowta does not do, sources, unverified items | Phase 12 | written (draft, unverified) |
| PAYMENTS-CURRENCIES.md | sources for the currency and country lists, the provider's supported currencies and amount units, tax notes per country | Phase 7 | not written |
| PRIVACY.md | data inventory, processors, retention, deletion, privacy page text | Phase 9 | not written |
| BRANDING.md | how to replace the logo and rebuild icons | Phase 1 | not written |
| DEPLOY.md | owner deploy steps (web, API, worker, Redis) | Phase 12 | not written |
| OWNER-CHECKLIST.md | what only the owner can do | end of build | not written |
| AUDIT-NOTES.md | [VERIFY] items, deviations, unverified items | end of build | not written |
| `decisions/` | one short ADR per important choice | every phase | empty |
| `gates/` | saved evidence per phase | every phase | empty |
| `a11y/` | TalkBack and NVDA checklist per screen | every phase | empty |
| `ui-matrix/` | screenshots across the size matrix | Phase 1 onward | empty |

Rule: a document is marked "written" only after the content was checked against the real code.
