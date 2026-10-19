# Build progress

Updated by the agent after every phase. A fresh session resumes from this file ("continue from docs/BUILD-PROGRESS.md").

| Phase | Name | State | Gate evidence |
|---|---|---|---|
| scaffold | folders, `.env.example`, README, docs skeleton | done (by the owner's planner, not yet committed) | n/a |
| 0 | Foundations | not started | |
| 1 | Design system and app shell | not started | |
| 2 | Auth | not started | |
| 3 | Teams, roles, invites | not started | |
| 4 | Shifts, calendar, feed, search | not started | |
| 5 | Swaps | not started | |
| 6 | Jobs, cron, push, settings | not started | |
| 7 | Billing | not started | |
| 8 | Offline and Dashboard | not started | |
| 9 | Lifecycle | not started | |
| 10 | System design layers | not started | |
| 11 | Web surface | not started | |
| 12 | Load tests, docs, build, demo | not started | |

## Known problems

- Owner hand steps for this round: run `node fix-env-name.mjs` (dry run), then with `--write`, then plain again; in `.env` delete the old `PAYMENT_CURRENCY` line and the `PAYMENT_FALLBACK_CURRENCY` line and set `TRUST_PROXY_HOPS=0`; delete `fix-env-name.mjs` and the stray root files; run `node scripts/setup-env.mjs --check`; confirm `git status` shows no `.env`, then commit and push to https://github.com/Antisocialworld/Rowta; rename the folder to `rowta`.
- Q9 (light theme only), Q11 (warning/success colours as-is), Q12 (price/currency/country seeding) remain open with stated defaults.

## Session log

### 2026-10-19 — scaffold re-verify + sync + no-fallback confirmations + owner env-fix script
- STEP 1: `rowta-scaffold-v3.md` (370,799 B) and `rowta-scaffold.json` (373,121 B) verified against the expected blake2b512 digests — both PASS.
- STEP 2: sync wrote only `docs/BUILD-PROGRESS.md` (1 overwritten, 84 identical, 0 created; `.env` protected, `design-system/` and `rowta-old-backup/` untouched). Confirmations: `.env.example` = 50 names, no `PAYMENT_FALLBACK_CURRENCY`; PRD + `rowta-payments-recipes` + `docs/DATABASE.md` all state NO fallback currency and that the sign-up country list offers only countries whose currency is sold; `grep -rn FALLBACK` (skipping `.env` and backups) hits only transport strays, policy/fallback-page text, and one `design-system/convertTokens.js` comment (report-only, not edited).
- STEP 3: `fix-env-name.mjs` created in the repo root with the owner's exact content — NOT run by the agent; added to `.gitignore`; `scripts/scan-name.mjs` skips it.
- STEP 4: `docs/a11y/rule-ids.txt` regenerated — 109 IDs (per file: 00=12, 01=14, 02=15, 03=8, 10=24, 20=11, 21=14, 22=6, 90=5); 109 lines, 0 non-matching; no rule file edited.
- STEP 5: `scan-name.mjs` TOTAL 0/0/0; `verifyTokens.js` = 391 / 391 / 0 errors; token test PASS; `check-ui-tokens.mjs` PASS (0 source files built yet).

## Not verified

Everything except the commands in the session log above. `.env` was never opened; no git commands run; docker not run; no phase code built; databases and Prisma not set up.
