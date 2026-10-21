# 0010. Unknown-email branches mirror the attempts-guard statement so code-endpoint timing matches

Date: 2026-10-20. Status: accepted — escalation executed the same day (see final section).
Phase 2b (rules A7, A9; skill rowta-testing-recipes).

## Context

Rule A7 requires that when the email is unknown the server still runs a real Argon2id verify "so the
two paths cost about the same", and records a measurement in `docs/SECURITY.md`. The Phase 2b rework
of that measurement replaced the old known+CORRECT vs unknown comparison (124.5 ms vs 49.4 ms — the
wrong pair: an attacker probing with a wrong secret never pays the correct path's token issuance)
with the pair an attacker actually exercises: **unknown email vs known row + wrong secret**, run
alternating, 60 runs a side, first 5 discarded, medians and max/min ratio printed, ratio asserted
≤ 1.25 with ≥ 5 ms floors on both sides.

The sign-in pair passed immediately (ratio 1.04 → 1.00 after the fix below: one lookup + one verify
on both paths). The two code endpoints did not:

```
verify-code  unknown 50.9ms vs known+wrong 60.4ms   ratio 1.27   (before fix)
reset-code   unknown 45.7ms vs known+wrong 62.0ms   ratio 1.36   (before fix)
```

Cause — structural, not noise (the sign-in pair is the control: same method, same machine, same
loop, ratio 1.04): the known code path runs the A9 atomic attempts guard — a conditional
`UPDATE … SET attempts = attempts + 1 … RETURNING id` — which costs one database round-trip the
unknown path had no row to run (+1 for verify-code; +1 lookup and +1 UPDATE for reset-code), about
14–16 ms on top of the ~46–51 ms Argon2 verify. The unknown branch skipped straight to the dummy
verify, so a probe could tell "no such email" from "email exists, code wrong" by timing alone — a
minor but real enumeration oracle on `/auth/signup/verify` and `/auth/forgot/verify`.

## Decision

The unknown branches of `verifyCode` (unknown email) and `verifyResetCode` (unknown email AND
"account exists but no active code") now run **the same `$queryRaw` statement shape as the real
attempts guard, with a `randomUUID()` in the id position**:

- zero rows match, so nothing is written, nothing is incremented, no data exists to corrupt;
- the statement, the bind-parameter count and the round-trip are identical to the known path's;
- it runs immediately before the dummy Argon2id verify, in the same position the known path runs its
  guard.

Sign-in needed no change (its known path does no write on failure). Escalation design, reserved but
**not needed**: if a zero-row UPDATE had still measured > 1.25 (a matched-row write can cost more
than a miss), the plan was a single seeded decoy row per table — a counter incremented and reset by
the server, no personal data, reachable by no user flow — so the write cost matches. Measurement
after the zero-row fix: all three pairs ≤ 1.17, so the decoy rows were not created then — until
later the same day the band was crossed from inside (see "Escalation executed" below).

Evidence (`npx vitest run tests/auth-security.test.ts --silent=false`):

```
sign-in      unknown 44.6ms vs wrong 44.6ms  ratio 1.00
verify-code  unknown 51.8ms vs wrong 60.4ms  ratio 1.17
reset-code   unknown 52.1ms vs wrong 61.0ms  ratio 1.17
```

All three assertions (≤ 1.25 ratio, ≥ 5 ms floors, n=55 a side after discarding 5) are live in
`server/tests/auth-security.test.ts` and enforced by the suite.

## Why

- A7's purpose is that timing must not reveal whether an email has an account. A consistent 27–36%
  gap revealed it on the code endpoints even though the status, body and rate-limit behaviour were
  uniform; closing the gap in the UNKNOWN direction (paying the guard's round-trip) rather than the
  known direction keeps every security-relevant behaviour of the known path untouched.
- A zero-row UPDATE against a random primary-key id is the cheapest honest mirror: one round-trip,
  no lock held after the statement, no write amplification, no schema change, no migration — the
  selftests re-ran green unchanged (db0/db1 owner, app-role DB0=12 DB1=12).
- The known path's guard stays byte-for-byte the A9/C3 atomic statement (one conditional statement,
  not check-then-write); only the failure branches gained a matching no-op.

## Residual risks

- **Jitter inside the band.** The ratios sit at 1.00–1.17 against a 1.25 limit on a warm laptop;
  a noisier machine (GC pauses, CPU frequency scaling, Docker I/O) could push a pair over. That is
  a measurement-environment risk, not a security regression: the floor assertions (both paths ≥ 5 ms)
  are the defect detectors (a missing dummy verify collapses to ~1–3 ms), and the ratio band is the
  parity check. If a future environment trips the band, re-measure before touching code — the ADR's
  escalation ladder (zero-row → decoy-row write) is the reserved next step, never a silent loosening
  of the tolerance.
- **Rate limits are the second defence.** `/auth/signup/verify` and `/auth/forgot/verify` are also
  bounded per-IP and per-email-hash (30/900 s, `code.ip`), so even a residual timing signal is worth
  a bounded number of probes; A7's last sentence — the limit keys behave identically whether or not
  the account exists — means the limit itself cannot be used to enumerate either.
- The unknown branches now perform one extra database statement per probe. The cost is one
  index miss on a primary key (no lock, no WAL), rate-limited in front; negligible next to the
  Argon2id verify that dominates both paths.

## What would change it

A database that can serve the guard's round-trip for free (eliminating the delta entirely) would
make the mirror statements redundant; or a PRD decision to treat code-endpoint timing parity as out
of scope (it is in scope today: rule A7 says "the two paths cost about the same" without limiting
that to sign-in).

## Escalation executed (2026-10-20, same day): zero-row → decoy-row write

The residual risk above arrived the same day. Re-measured first, as the ADR requires: on a quiet
moment the standalone pairs sat at 1.20 / 1.24 (inside the band), but the FULL suite failed
reset-code at 1.28–1.35 — past the strict 1.25 the owner refused to weaken. A decomposition of both
paths against the live database showed the gap was structural, not noise:

- a matched-row UPDATE (WAL + heap) measured ~11–14 ms where the random-id UPDATE matched nothing
  (~3.5 ms) — the write cost this ADR predicted and the zero-row mirror could not equalise;
- reset-code additionally pays the `password_resets` findFirst (~3.5 ms) that the unknown-email
  branch never runs;
- the Argon2id baseline had shrunk from the ~52 ms recorded at gate time to ~40 ms on this machine,
  so the same absolute gap grew from 1.17 to ~1.24 of a smaller base — jitter then crossed the line.

Per the owner's standing instruction (BUILD-PROGRESS, 20 Oct 2026: "escalate to seeded decoy-row
writes only if still >1.25, never weaken silently") the reserved escalation now runs:

- `server/src/auth/timing-decoy.ts` seeds ONE row per guard table — `pending_signups`,
  `password_resets`, and the `users` row the reset row's foreign key requires — lazily on the first
  unknown probe, memoised per process, idempotent (`INSERT … ON CONFLICT (id) DO NOTHING`).
- The three unknown-branch guards (`verifyCode` unknown email; `verifyResetCode` unknown email and
  "no active code") now target those rows: the UPDATE matches and writes, paying the identical
  write cost. The decoy rows hold no personal data; their emails carry no `@`, which the shared
  `emailField` (z.email()) rejects — asserted in `auth-security.test.ts` — so no user flow can name
  them; the guard's `SET attempts = CASE …` cycles 0–4 inside `WHERE attempts < 5`, resetting the
  counter inside the same single statement.
- Fallback: if the seed cannot run, the branch keeps the original random-id mirror. The `countries`
  table ships empty by design and `users`/`pending_signups` require a country — while no country
  exists no REAL row can exist either, so there is no known path to compare against and the signal
  has nothing to reveal.
- Known paths stay byte-for-byte the A9/C3 guard; only the failure branches changed.

Evidence (`npx vitest run tests/auth-security.test.ts --silent=false`, 8/8 tests, exit 0):

```
sign-in      unknown 38.1ms vs wrong 38.8ms  ratio 1.02
verify-code  unknown 49.3ms vs wrong 48.5ms  ratio 1.02
reset-code   unknown 48.3ms vs wrong 52.2ms  ratio 1.08   ← residual = the known path's findFirst
```

Full suite after the escalation: **17 files / 123 tests / 123 passed** (`npm run -w @rowta/server test`,
exit 0), including the new `A7 timing decoys (ADR 0010 escalation)` test that proves the unknown
probes move the decoy counters (a zero-row mirror would leave them untouched).
