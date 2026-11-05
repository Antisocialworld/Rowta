# 0009. Verification codes and magic tokens are generated in the email job, not the request handler

Date: 2026-10-20. Status: accepted. Phase 2 (rules A9, A13, J3; skill rowta-notifications-email-recipes).

## Context

Every auth flow that emails a secret (sign-up code, forgot-password code, magic link) needs two
things at once: a uniform, fast HTTP response and a secret that only the email path ever sees. Two
placements of the secret generation were possible:

1. **In the request handler**: the handler generates the code/token, hashes it, enqueues the email
   with the secret in the job payload, and answers. The secret then exists in two processes' memory
   and in the Redis job payload — every extra place is an extra place a log line or a crash dump
   could leak it.
2. **In the email job**: the handler writes only a placeholder hash (for sign-up, so the request can
   still pay the same two-Argon2id timing cost as a known address — A7) or nothing at all; the worker
   generates the real code/token when it runs, hashes it, stores only the hash, and sends the mail.

## Decision

Option 2. `server/src/jobs/email/processor.ts` is the only place `generateCode()` and
`createTokenParts()` are called. The job payload carries the job kind, the user/recipient identity
and the locale — never a code, verifier or token string (`types.ts` states this and the queue tests
rely on it). The job writes `code_hash` / the `magic_tokens` row with an Argon2id PHC string and the
TTL from the shared constants, then sends. Job IDs are content-free
(`email-<kind>-<fingerprint16>-<epochSecond>`), so a duplicate enqueue within the same second dedups
instead of double-sending.

## Why

- The secret never enters the HTTP process, the Redis payload, or any log line (S1, S9, J3): the
  shortest possible path from "random bytes" to "hash in the database + message in the mailbox".
- One sender owns generation and delivery, so "the code that was emailed" and "the code the database
  accepts" cannot drift apart.
- The request handler stays uniform and cheap: it answers the same bytes whether or not the account
  exists (A6) and never touches a secret it would have to redact.
- The placeholder-hash trick on sign-up preserves A7 timing parity without ever generating a real
  second code: the request does its two honest Argon2id hashes, the job overwrites the placeholder.
- Evidence: `server/tests/auth-security.test.ts` (no secret in logs or plaintext in any table),
  `server/tests/auth-flows.test.ts` (welcome email send-once via a second `processEmailJob` run),
  `server/tests/auth-limits-validation.test.ts` (dedup/cooldown behaviour).

## What would change it

A PRD requirement to deliver codes over a channel other than the background email queue (e.g. SMS in
the request path), or a decision to accept secrets in job payloads with a documented Redis-at-rest
encryption story. Neither exists today.
