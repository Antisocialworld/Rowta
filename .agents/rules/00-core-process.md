---
trigger: always_on
description: "Process, git and phase rules (P1 to P12) that apply to every task"
---

# Rowta rules: Process and git

Status: binding. Every rule has an ID. Audits and phase reports cite rule IDs.
Words: MUST and NEVER are absolute. [DECISION] = a choice made here that the owner can change.
[VERIFY] = a fact to check against current official documentation before use; cite the page.
[OPEN] = waiting for the owner; see PRD section 15. Do not build anything that depends on an [OPEN] item.

These rules are restated here on purpose. Do not assume you already know them.

---------------------------------------------------------------------------------------------------

## P. Process and git

P1. **No git writes, no publishing, no deploys.** NEVER run `git add`, `commit`, `push`, `merge`, `tag`,
    `stash`, `reset`, `checkout` that changes files, or any publish or deploy command (Vercel, `eas submit`,
    any host). Read-only git (`status`, `diff`, `log`, `ls-files`, `check-ignore`) is allowed. The owner does
    every commit and push. At the end of a phase you may SUGGEST a branch name, a Conventional Commits
    message (for example `feat: add cursor pagination to activity feed`) and a pull request description (with the screenshots to attach, per brief 2.5), as text. Suggest one feature branch per phase.
P2. **Phases run in order, and every gate must pass before the next phase starts.** Full-build mode (the owner asked
    for the whole app in one run, 18 Oct 2026): you do not wait for "go" between phases, but you MUST (a) run the
    phase gate (PRD section 12), (b) save the real evidence in `docs/gates/phase-<n>.md`, and (c) fix any failure
    before moving on. STOP and report if a gate fails and you cannot fix it honestly, a rule conflicts with the PRD
    or the brief, or anything touches secrets or safety. NEVER make two risky changes in one step (a migration, a
    dependency change and a refactor are three separate steps). Keep `docs/BUILD-PROGRESS.md` current after every
    phase (done, in progress, not started, known problems) so a fresh session can resume from it.
P3. **Claim nothing you did not verify.** After any change, run the command that proves it and show the real
    output. Say "not verified" for anything not run. A passing build is not evidence a feature works.
    Evidence is the correct database row, the correct HTTP response, or a passing test whose output you show.
P4. **Stop and ask** when the PRD is ambiguous, contradicts itself, contradicts the brief, or depends on an
    [OPEN] item. Never silently choose. Offer the options and a recommendation.
P5. **Explain-back.** At the end of each phase write a plain-language DRAFT entry in `LEARNING-LOG.md`
    (what it does, why this way, what breaks it) for the owner to rewrite in their own words. One short
    Architecture Decision Record per important choice in `docs/decisions/` (problem, options, choice, why).
P6. **Fake data only** in seeds, tests, fixtures and screenshots. No real emails, phone numbers, names.
P7. **Dev-only code is fenced.** Any shortcut that exists only for testing (fake payment trigger, seed
    endpoint, debug route) MUST refuse to start when `NODE_ENV=production`, and is listed in `docs/SECURITY.md`.
P8. **Say which files you will touch and why before editing.** Small steps: one endpoint, one test, one
    migration at a time. Migrations are additive and applied to BOTH databases; show both applied.
P9. **Verify third-party facts against current official docs** before coding against them (Expo push,
    provider webhook signature scheme, EAS, Prisma multi-database, Apple and Google billing policy, Argon2
    library API, node-cron API, BullMQ API). Cite the page. If the network blocks you, say so and mark [VERIFY].
P10. **No scope creep.** Build only what the PRD lists. Anything extra needs the owner's approval first.
P11. **Folder structure** (brief 2.5): `/app`, `/server`, `/docs`, `/load-tests`, plus `/shared` for the Zod
    schemas used by both sides [DECISION; record an ADR], `docker-compose.yml`, `README.md`, `.env.example`. The
    scaffold already created these folders (with `.gitkeep` files), `/scripts`, `/web`, `LICENSE`, `.gitignore`,
    `.editorconfig`, `docker-compose.yml` and a documentation skeleton. Use them; do not rename or move them without an
    ADR. Keep README and `docs/README.md` truthful as things are built.
    `/web` holds the public web surface (decided Q1: yes; the owner deploys it to Vercel, the agent never does).
P12. **Step report format** (end of every step): what was built; evidence shown; what is NOT done or NOT
    verified; rules touched (IDs); suggested branch, commit message, PR text.
