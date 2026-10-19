# Agent setup: rules, skills and activation modes (Antigravity)

Source: Google's Antigravity documentation (rules page, skills codelab), read on 18 Oct 2026. Docs change; re-check them if something does not load.

## Where each thing lives

| Kind | Path in this repo | Needs frontmatter | Activation |
|---|---|---|---|
| Entry file | `AGENTS.md` (repo root) | no | always active in its directory |
| Rules | `.agents/rules/*.md` | YES, `trigger` is required | set per file with `trigger` (table below) |
| Skills | `.agents/skills/<name>/SKILL.md` | `description` required, `name` optional | no mode setting: the agent matches the task to each skill's description, or you name the skill in the prompt |
| Reference | `.agents/PRD/PRD-001-rowta.md` | no | not a rule; `AGENTS.md` tells the agent to read the section for the current phase |

## The four activation modes for rules (the `trigger` key)

| `trigger` | Meaning |
|---|---|
| `always_on` | the full file is put in the prompt on every turn |
| `glob` | loads when the agent works with files matching `globs` (comma-separated patterns) |
| `model_decision` | the agent sees only the path and `description`, and opens the file when the task matches |
| `manual` | loads only when you @-mention the rule in chat |

## Mode chosen for each file, and why

| File | Rule IDs | Trigger | Why |
|---|---|---|---|
| `00-core-process.md` | P1 to P12 | `always_on` | git, phases, evidence: needed on every turn |
| `01-secrets.md` | S1 to S14 | `always_on` | a secret leak is never acceptable, in any file type |
| `02-auth-credentials.md` | A1 to A13 | `always_on` | Argon2id, uniform messages, banned algorithms: touched by server, app, docs and tests |
| `03-validation.md` | V1 to V8 | `always_on` | small; Zod on client and server everywhere |
| `10-async-data-jobs.md` | C1 to C11, D1 to D9, J1 to J4 | `glob`: `server/**,shared/**,app/**` | only matters when code is written |
| `20-ui.md` | U1 to U11 | `glob`: `app/**,web/**` | UI work only |
| `21-accessibility.md` | X1 to X14 | `glob`: `app/**,web/**` | UI work only |
| `22-web-surface.md` | W1 to W6 | `glob`: `web/**` | web surface only |
| `90-tests-and-docs.md` | T1 to T5, M | `model_decision` | when writing tests, evidence or documentation |

Skills (no mode; triggered by their description; 19 in total):

| Skill | Holds | Triggers when the task is about |
|---|---|---|
| `rowta-session-and-report` | method sections 1, 2, 6, 7, 8 | starting a session, a step, a report, being blocked |
| `rowta-auth-recipes` | recipes 3.1 to 3.6 and 3.16 to 3.20 | Argon2id, tokens, codes, sign-in, shared schemas, AuthGate |
| `rowta-data-recipes` | recipes 3.7 to 3.14 | optimistic updates, data access, pagination, proration, webhook, cron, purge, quiet hours |
| `rowta-web-metadata` | recipe 3.15 | any page in `/web` |
| `rowta-accessibility-checklist` | method section 4 | finishing or reviewing a screen |
| `rowta-gate-checks` | method section 5 | any gate or report |
| `rowta-payments-recipes` | billing, Flutterwave, dev simulator, ledger, grace | anything about plans, seats, checkout, webhooks, ledger, renewals |
| `rowta-privacy-recipes` | personal data, logs, deletion, processors, privacy page | a feature that stores, logs, sends, shows or deletes personal data |
| `rowta-notifications-email-recipes` | push and nodemailer email jobs | push notifications, codes, links, invites by email |
| `rowta-db-sharding-recipes` | two databases, shard routing, pools, cache, EXPLAIN | migrations, shard routing, pooling, caching |
| `rowta-app-ui-recipes` | tokens, components, state, lists, size matrix, icons | building or changing app UI |
| `rowta-testing-recipes` | integration, permission, race, timing, cron tests | writing or running tests |
| `rowta-server-foundation-recipes` | env validation, middleware order, logging, errors, policy, rate limit, idempotency, hardening | work in that area |
| `rowta-jobs-worker-recipes` | BullMQ worker, job IDs, cron registry and locks, failed jobs, shutdown | work in that area |
| `rowta-teams-roles-recipes` | permission matrix, team creation, invites, seats, role changes | work in that area |
| `rowta-shifts-swaps-search-recipes` | shifts, feed, full-text search, swaps, restricted state | work in that area |
| `rowta-settings-offline-dashboard-recipes` | settings, offline cache, Dashboard cards | work in that area |
| `rowta-rate-limiting-recipes` | rate limits for every endpoint, fail modes, 429 behaviour, tests | work in that area |
| `rowta-delivery-recipes` | progress and gate files, ADRs, docs, k6, deploy and owner files, git text, demo | work in that area |

The four `always_on` files total about 22 KB (roughly 5,600 tokens), inside the documented 20,000-token shared budget with `AGENTS.md` and any global rules you have. Each rule file is far below the documented 24,000-byte cap (larger files are truncated).

## How to apply and check in Antigravity

1. Unzip into the repo. The frontmatter in each file already sets its mode, which is the documented way.
2. Open the Customizations panel, then the Rules tab, and confirm the nine rules are listed. [VERIFY] I could not confirm whether the panel shows or edits the `trigger` value; if it does not, leave the frontmatter as the source of truth.
3. Test: ask the agent "which rules are active right now and which skills do you see?" It should name the four `always_on` rules and the 19 skill names. If it cannot, the folder path may be wrong for your version: the legacy `.agent/` (singular) folder is still read, so check which one your install uses and do not keep both.
4. To force a skill, name it in the prompt ("use the rowta-gate-checks skill"). To force a `manual` rule, @-mention it (none are manual today).
5. Do not create a `GEMINI.md` next to `AGENTS.md`: Google does not document which wins if both exist.

## Changing a mode

Edit the `trigger` line in that file's frontmatter. For `glob` rules, `globs` is required; for `model_decision`, `description` is required.

## Which skills each phase should load

Phase numbers are from PRD section 12. `rowta-session-and-report` and `rowta-gate-checks` apply to every phase (start, gate, report); `rowta-testing-recipes` whenever tests are written.

| Phase | Work | Skills to load first |
|---|---|---|
| 0 | scaffold check, server foundation, two databases, Redis, worker proof, mail catcher | server-foundation, rate-limiting, db-sharding, jobs-worker, notifications-email |
| 1 | shared schemas, sign-in, AuthGate | auth, rate-limiting, app-ui, accessibility-checklist, privacy |
| 2 | sign-up with code, forgot and reset, magic link, email jobs | auth, rate-limiting, notifications-email, jobs-worker |
| 3 | teams, roles, invites, seats | teams-roles, rate-limiting, server-foundation, db-sharding |
| 4 | shifts, calendar, activity feed | shifts-swaps-search, data, db-sharding, app-ui |
| 5 | search, swaps | shifts-swaps-search, data |
| 6 | worker, cron, push, quiet hours | jobs-worker, notifications-email, data |
| 7 | billing, simulator, ledger, grace | payments, rate-limiting, data, privacy |
| 8 | settings, offline, Dashboard | settings-offline-dashboard, app-ui |
| 9 | deletion, purge, privacy | privacy, data, jobs-worker |
| 10 | pooling, caching, sharding | db-sharding |
| 11 | web surface, accessibility pass | web-metadata, accessibility-checklist |
| 12 | docs, load tests, delivery | delivery |

(Each skill name above is shortened: add the `rowta-` prefix and the `-recipes` suffix where the folder has them.)
