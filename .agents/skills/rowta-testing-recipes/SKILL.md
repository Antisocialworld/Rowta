---
name: rowta-testing-recipes
description: "Use when writing or running Rowta tests: real-database integration tests, the permission matrix, team isolation, concurrency (race) tests, uniform-response tests, the timing measurement, cron lock tests with two instances, cache and routing tests, and saving test evidence."
---

# rowta-testing-recipes

Part of the Rowta method. Scope: PRD 13; rules T1 to T5, C3, S6, S7, A5 to A7, J2. Test-runner choice is yours; record it in an ADR.
Code here is a PATTERN: check every library call against current documentation [VERIFY] before using it, and never paste real secrets (rule S1).

## 1. Ground rules
Integration tests use the real Docker PostgreSQL and Redis, never mocks, for permissions, team isolation, ledger immutability and races (T1). Time comes from an injectable clock (C9). A test that cannot run is reported as not run (T3). Show failures; never retry silently. Money and time code get a failing test BEFORE the implementation (T5).

## 2. Permission matrix (S6)
Generate the tests from one table that mirrors PRD section 4: rows are actions, columns are Owner, Manager, Staff and "other team". Each cell calls the real HTTP endpoint with a raw client (no app) and asserts 2xx, 403 or 404 exactly. One failing cell fails the suite.

## 3. Team isolation (S7)
For every route that takes or returns team data: a user in team A requests team B's resource and gets 404 with a body identical to a non-existent ID. Also assert a repository call without a team ID throws.

## 4. Concurrency (C3)
Fire two simultaneous requests with `Promise.all`: exactly one succeeds. Cover: invite acceptance at the seat limit, a second pending swap on one shift, two owners per team, a duplicate idempotency key, a duplicate webhook event, double code verification.

## 5. Uniform responses (A5, A6)
Call sign-in with an unknown email and with a known email and a different password: same status, same body shape and message, headers equal except the request ID. Repeat for sign-up, forgot password, magic link and invite with known and unknown emails. A string scan asserts no banned phrase exists in app or server strings (gate 2).

## 6. Timing (A7)
A script runs 50 sign-ins for an unknown email and 50 for a known email with a different password and prints the medians. Record the numbers in `docs/SECURITY.md`; this is a documented measurement, not a flaky assertion.

## 7. Cron and jobs (J2)
Start two worker instances against the same Redis; assert each schedule's work ran once. A job that fails then succeeds shows growing backoff delays; a job that exhausts its attempts lands in the failed list.

## 8. Other required tests
Everything in PRD section 13: proration (11 rows plus 2 limits), refresh rotation and reuse detection, code and link single use and expiry, cursor pagination with a same-timestamp straddle, quiet hours, rate limit across two instances or a restart, ledger immutability as the application role, `rebuildFromLedger`, shard determinism, cache invalidation, read-your-own-writes routing, server-side Zod rejection for every form, soft delete hidden by default, purge only after grace, ledger survives team purge, logger redaction, no floating promises (lint).

## 9. Evidence
Save the real summary line and the failing-then-passing runs in `docs/gates/phase-<n>.md`. Name tests so the owner can point at them in the interview.

## 10. Mistakes to avoid
Mocking the database; asserting only the status and not the body; a race test that passes by luck (run it in a loop); a flaky timing assertion; a test fixture containing a real-looking secret or email.

## Rate-limit tests (S14)
The nine tests in section 8 of `rowta-rate-limiting-recipes` are required, including the route walk that fails when a route has no limit.

## Code lifetime tests (rule A9)
With a controlled clock: a code works at 4:59 and fails at 5:01; a resend before 60 s is refused with the same answer and restarts nothing; after 60 s a new code kills the old one; the email text shows the same minutes as `CODE_TTL_SECONDS`; the app shows the countdown from the server's remaining seconds, not the phone clock.

## Decision tests (18 Oct 2026)
Display name: boundary lengths, line breaks, markup, never in subjects or logs. Magic link: a GET consumes nothing, only the button's POST consumes, one winner on two POSTs. Money: `toProviderAmount` table tests, and the Phase 7 test-mode payment whose provider-reported amount equals the expected minor-unit amount. `sent_emails`: welcome and each receipt are sent once when the job runs twice.

## Schema conformance (added)
Run `server/prisma/sql/selftest.sql` (as the owner) and `selftest-app.sql` (as the app role) against DB0 and DB1 in CI after applying the DDL. It checks no floating or decimal money column, `*_minor` columns are `bigint`, ledger immutability, and every constraint listed in PRD "Schema source of truth". A new constraint needs a new check in the same change.

## Not-ready buttons (X14)
For the sign-up, sign-in, reset (each step) and code forms: bad input leaves the button not ready with a visible reason; a press sends no request and moves focus; valid input makes it ready; the native `disabled` attribute is never present; the reason never mentions whether an account exists; icon-only buttons have names; no visible-text button has a label that does not start with its text. The server still rejects invalid input when the client is bypassed.
