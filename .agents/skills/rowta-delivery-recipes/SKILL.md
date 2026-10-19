---
name: rowta-delivery-recipes
description: "Use when writing Rowta documentation or evidence or preparing delivery: BUILD-PROGRESS and gate evidence files, ADRs, learning-log drafts, ARCHITECTURE and the other required docs, k6 load tests and their report, DEPLOY.md, OWNER-CHECKLIST, AUDIT-NOTES, the app-store billing note, suggested commit text, and the demo video script."
---

# rowta-delivery-recipes

Part of the Rowta method. Scope: PRD 12 (Phase 12), 13, 14; rules P2, P5, P12, M, W6. Tool versions are [VERIFY].
Code here is a PATTERN: check every library call against current documentation [VERIFY] before using it, and never paste real secrets (rule S1).

## 1. Progress and evidence files
`docs/BUILD-PROGRESS.md`: one table row per phase with state (not started, in progress, done), the gate evidence file, known problems and what is not verified. After each phase also write `docs/gates/phase-<n>.md`: the gate text from PRD section 12, then for each item the REAL command output or row (masked where needed) or "not verified" with the reason. A gate with a missing item is not passed.

## 2. ADR (one per important choice, P5)
`docs/decisions/NNNN-title.md`: Problem, Options (with costs), Choice, Why, What would change it. Required ones include: shared `/shared` folder, Argon2id parameters, refresh-reuse handling (A11), the `sent_emails` send-once guard, the https magic link with fragment, minor-unit currency and the provider amount unit, display name, design direction, web rendering approach, search approach, initial subscription state, display name, cache TTLs.

## 3. Learning-log draft (P5)
Per phase, a DRAFT in plain language: what it does, why this way, what breaks it. Mark it "draft for the owner to rewrite". At the end, add answers to the interview questions from the brief; if the brief's list is not in the repo, ask the owner for it instead of inventing questions.

## 4. Required documents (PRD 14)
README (first screen: one-line description, GIF, download link, demo video link, plus the app-store billing section), `ARCHITECTURE.md` (diagram, pool arithmetic, what we cache and never cache), `PRORATION.md`, `STATE.md`, `SECURITY.md` (8 threats, each with how it is handled and the evidence), `SHARDING.md`, `LEARNING-LOG.md`, `cron-registry.md` (generated from the code registry), `payment-trace.md` (a real example answering "what happened to this user's payment at 3:14pm?"), `PRIVACY.md`, `BRANDING.md`, `TAX-NOTES.md` (what the app does and does not do about VAT, invoices and e-invoicing, with sources and what is unverified). Mark a document written only after checking it against the real code.

## 5. App-store billing note (README section)
Read the CURRENT Apple App Store Review Guidelines and Google Play payments policy now and cite the exact pages; do not write from memory. Explain in plain words how selling a digital subscription for using the app would be affected in production and what a production approach would be. Rowta is not published to the stores for this task.

## 6. Load tests (Phase 12)
- k6 scripts in `load-tests/`. Scenario: 200 virtual users loading the activity feed with ramp-up, steady state and ramp-down. Run twice: `CACHE_ENABLED=false` (before) and `true` (after) on identical data.
- Test users: the seed script creates fake users and writes their local credentials to `load-tests/.local/` (git-ignored); k6 reads them from there. Never commit that folder, never print its contents.
- Report in `load-tests/REPORT.md`: p50, p95, p99, error rate, requests per second, machine description, data size, and the caveat that a laptop with Docker is not production. If k6 cannot run in this environment, say "not run", keep the scripts, and list the exact command for the owner.

## 7. Deploy and owner files
`docs/DEPLOY.md`: options and exact steps for the owner: web surface on Vercel; API, worker and Redis on a host that can run a long-lived process [VERIFY limits]; the env variable NAMES to set on each host (no values); the EAS Android development build steps [VERIFY free-tier limits]; the App Links certificate fingerprint step. `docs/OWNER-CHECKLIST.md`: only what the owner can do (SMTP login and Flutterwave test keys in `.env`, the sending domain's SPF, DKIM and DMARC records, deploys, EAS build, replacing the logo, captioned demo video, LinkedIn post, commits and pushes). `docs/AUDIT-NOTES.md`: every [VERIFY] item, everything not verified, every deviation from the PRD, every hard-to-satisfy rule.

## 8. Suggested git text (text only, P1)
Branch `feat/phase-<n>-<topic>`; Conventional Commits message such as `feat: add cursor pagination to activity feed`; a PR description listing what changed, evidence files, what is not verified, and the screenshots to attach.

## 9. Demo video and posts (owner records)
Draft a 3-minute script: product first, then one deep dive; captions and a full transcript are required (X10). Draft the LinkedIn post about ONE decision (no "excited to announce") and the portfolio case study outline (problem, constraints, architecture, three hardest decisions, results with the load-test numbers, what next). Drafts only: the owner publishes.

## 10. Mistakes to avoid
Marking a document written without checking it against the code; a gate file with claims and no output; load-test numbers without the "before" run; deploy steps that contain a real value; inventing the interview questions.

## DATABASE.md (added)
`docs/DATABASE.md` is generated from a real database loaded with the reference DDL. Regenerate it from the real database whenever the schema changes; never hand-edit it.
