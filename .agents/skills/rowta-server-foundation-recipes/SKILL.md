---
name: rowta-server-foundation-recipes
description: "Use when setting up or changing the Rowta server foundation: environment validation, the Hono app and middleware order, request IDs and structured logging with redaction, the error envelope, auth middleware and the central policy function, Redis rate limiting, idempotency keys, HTTP hardening, health endpoint and graceful shutdown."
---

# rowta-server-foundation-recipes

Part of the Rowta method. Scope: PRD 9.3, 9.7 to 9.11, Phase 0; rules S5 to S11, A7, C5 to C8, V3, V5. Framework choice is a [DECISION]; library calls are [VERIFY].
Code here is a PATTERN: check every library call against current documentation [VERIFY] before using it, and never paste real secrets (rule S1).

## 1. Environment validation (Phase 0 gate)
One module parses `process.env` with a strict Zod schema and FAILS FAST naming the missing variable NAMES, never values. Group by feature so optional groups (payments keys, SMTP login) stay optional but are required when their feature switch is on. Boot guard: if `PAYMENT_SIMULATOR_ENABLED` is true and `NODE_ENV` is `production`, throw and exit (P7). `.env.example` and the schema list the same names; a test compares them.

## 2. Middleware order
request ID, structured logger, timeout, body-size limit, security headers, CORS allowlist, per-route rate limit, authentication, handler, then ONE error handler last. Put the order in a comment so a new route cannot skip a layer.

## 3. Request ID and logging (S9, PRD 9.10)
Generate or accept a request ID, return it in a response header and in every error body. One structured log line per request: request ID, user ID (not email), route pattern, status, duration. The logger has a redaction list (passwords, codes, tokens, secrets, authorization headers, auth-route bodies) and a test logs a fake secret and asserts it never appears.

## 4. Error envelope (PRD 9.3, S10, V3, V5)
Errors are `{ "error": { "code", "message", "requestId" } }`, success is `{ "data", "meta" }`. Status map: 401 not authenticated, 403 authenticated but not allowed, 404 for cross-team resources, 409 conflict, 422 validation, 429 rate limited with `Retry-After`, 400 malformed. Validation failures return field-level CODES, never raw Zod text. Messages come from the catalog. No stack trace, SQL, file path or library name ever leaves the server; unknown errors become `generic.error`.

## 5. Authentication and the policy function (S5, S6, S8)
The auth middleware verifies the access token (recipe 3.16 in `rowta-auth-recipes`), then loads the user's membership and role from the database on EVERY team request. ONE function `can(user, membership, action, resource)` encodes the PRD section 4 matrix, denies by default, and returns allow, forbidden or not-found (cross-team gives not-found). Routes never contain ad hoc role checks.

## 6. Rate limiting (A7, S14, PRD 9.7)
The full endpoint inventory, values, fail modes and tests are in the skill `rowta-rate-limiting-recipes`; load it. Every route needs a named limit (S14). Summary:
Atomic Redis counter with expiry (increment then set expiry on first hit, or a Lua script) [VERIFY client API], never an in-memory object. Keys use `blake2b512` of the normalised email plus the IP so no raw email sits in Redis. One config file lists each limit and a one-line reason: sign-in, sign-up, code verify, forgot, magic request, resend, invites, payment initiation, search and other expensive routes. The 429 body and `Retry-After` are identical whether or not the account exists. Test: the limit holds across two server instances or across a restart.

## 7. Idempotency (PRD 9.9, D2)
Required `Idempotency-Key` on payment-initiating and swap-request endpoints. Insert (scope, key, `blake2b512` request fingerprint) first; the UNIQUE constraint decides the winner (never check-then-write). Same key and same body returns the stored response; same key and a different body returns 422; a request still in flight returns 409. Purge keys after 48 hours (PRD 7.3).

## 8. Hardening (S11, C5, C8)
CORS from `CORS_ALLOWED_ORIGINS` (no wildcard with credentials), security headers, body limit, request timeout, outbound calls with `AbortController` timeouts. Handlers for unhandled rejections and uncaught exceptions log and exit non-zero. On SIGTERM stop accepting work, finish in-flight requests, close database pools and Redis.

## 9. Health
`GET /health` reports process up, and (separately, not public detail) database and Redis reachability. It returns no versions, paths or secrets.

## 10. Mistakes to avoid
Reading `process.env` outside the env module; a role in the token; a route without the policy call; Zod text shown to users; an in-memory rate limiter; different 429 behaviour for known and unknown accounts; logging a request body on an auth route.
