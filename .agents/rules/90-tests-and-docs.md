---
trigger: model_decision
description: "Use when writing or running tests, producing gate evidence, or writing documentation such as the README, ADRs, the learning log or SECURITY.md"
---

# Rowta rules: Tests, evidence and documentation

Part of the binding Rowta rule set in `.agents/rules/`. Every rule has an ID; audits and reports cite the ID.
MUST and NEVER are absolute. [DECISION] = a choice made here that the owner can change. [VERIFY] = check against current official
documentation and cite the page. [OPEN] = waiting for the owner. Full legend: `00-core-process.md`.

---------------------------------------------------------------------------------------------------

## T. Tests and evidence

T1. Real database for integration tests (the Docker Postgres), never mocks, for permissions, team isolation,
    ledger immutability and race conditions.
T2. The required test list is PRD section 13. A gate lists each test by name and shows it passing.
T3. A test failure is shown, not hidden or retried silently. A test that cannot be run is reported as not run.
T4. Before every gate run the forbidden-pattern greps in skill `rowta-gate-checks` (section 5) and show the (empty) result.
T5. Money and time code get a unit test BEFORE the code that uses them. The proration module is pure functions
    with no input or output so its tests are fast and exhaustive.

## M. Documentation duties (deliverables)

README (first screen: one-line description, GIF, download link, demo video link, plus the app-store billing
section), `docs/ARCHITECTURE.md` (with diagram), `docs/PRORATION.md`, `docs/STATE.md`, `docs/SECURITY.md`,
`docs/SHARDING.md`, `docs/LEARNING-LOG.md`, `docs/decisions/*.md`, `docs/ui-matrix/`, `docs/a11y/`,
`docs/payment-trace.md`, `docs/cron-registry.md`, test results, load-test report. The agent drafts; the owner
rewrites learning entries in their own words.
