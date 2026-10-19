---
name: rowta-rate-limiting-recipes
description: "Use when adding or changing any route, form, job trigger or payment endpoint in Rowta: the rate-limit inventory for every endpoint (authentication forms, codes, links, invites, payments, webhook, search, reads, writes), the Redis counter, the limits config file, fail modes, trusted proxy IP, the 429 response and app behaviour, and the tests that prove it."
---

# rowta-rate-limiting-recipes

Part of the Rowta method. Scope: rule S14 (rate limiting everywhere), A7, A9, C5, S13; PRD 9.7 and 8.1. The numbers below are proposals [DECISION]: the owner can change them in ONE file. Library calls are [VERIFY] against current documentation. Never paste real secrets (S1).

## 1. The design in one paragraph
One config file, `server/src/security/limits.ts`, is an array of `{ id, key, max, windowSec, failMode, reason }`. Routes are registered through a helper that REQUIRES a limit id, so a route without a limit does not compile; a test also walks the real route table and fails on any route without one. A middleware `limit(id)` runs first on the route (before authentication, before body parsing for large bodies, before Argon2id, before the database). The counter is one atomic Redis step (a small Lua script that increments, sets the expiry on the first hit, and returns the count and remaining time) [VERIFY the client's script API]. Fixed windows allow up to double the limit across a window edge; that is accepted and noted in `docs/SECURITY.md`.

## 2. Keys (never raw values)
`ip` = the client address (see 5). `emailHash` = `blake2b512` of the NFKC, lower-cased email. `user` = user ID. `team` = team ID. `selector` = the public part of a token. `device` = the device record ID. Key text: `rl:<limitId>:<blake2b512 of the key value>`. Several limits may apply to one request (for example per IP AND per emailHash); the request is refused if ANY is exceeded, and every one is incremented.

## 3. Inventory: every endpoint group and its limit
Route names are by purpose; use the PRD's real paths. Fail mode C = fail closed (generic 503 when Redis is down), O = fail open with a logged warning.

| Group | Endpoint(s) | Keys and limit | Fail | Reason |
|---|---|---|---|---|
| Sign-in | sign in | ip 30 per 15 min; emailHash 10 per 15 min; ip+emailHash 5 per 15 min | C | stop guessing without locking the account |
| Sign-up | sign up, resend sign-up code | ip 10 per hour; emailHash 5 per hour; resend cooldown 60 s per emailHash | C | stop mass signup and email bombing |
| Code check | sign-up code, reset code, magic code | per target: the 5 attempts stored with the code (A9); ip 30 per 15 min | C | 6-digit codes are guessable without it |
| Forgot | forgot, reset code request, resend | emailHash 5 per hour; ip 20 per hour; cooldown 60 s per emailHash (A9) | C | email bombing, enumeration |
| Reset | set new password (needs grant) | ip 20 per hour; grant 5 tries | C | grant guessing |
| Magic link | request link | emailHash 5 per hour; ip 20 per hour | C | email bombing |
| Magic link | consume link | ip 30 per 15 min; selector 10 per hour | C | token guessing |
| Session | refresh | device 30 per min; ip 120 per min | C | stolen-token abuse, client loops |
| Session | log out, log out of all | user 10 per min | O | cheap, low risk |
| Invites | create invite | user 20 per hour; team 50 per day | C | email abuse, seat gaming |
| Invites | accept invite, open invite page | ip 20 per 15 min; selector 10 per hour; page ip 60 per min | C | token guessing |
| Teams | create team, change role, remove member | user 20 per hour | O | abuse, accidents |
| Payments | start checkout / change plan / change seats | user 5 per min; team 20 per hour; Idempotency-Key required (PRD 9.9) | C | double charge, card testing |
| Payments | dev simulator endpoints | same as checkout; refuse in production (P7) | C | still a payment path |
| Payments | provider webhook | signature check first (S13) with an early cheap reject; ip 600 per min (generous, provider retries); never limited per user | C | forged floods without blocking real events |
| Payments | billing reads, payment history | user 60 per min | O | reads |
| Shifts | create, edit, delete | user 60 per min | O | scripts and accidents |
| Swaps | request swap | user 20 per hour; Idempotency-Key required | O | spam |
| Swaps | decide swap | user 60 per min | O | accidents |
| Search | full-text search | user 30 per min | O | expensive query |
| Reads | feed, calendar, roster, dashboard | user 120 per min | O | cheap reads, scraping |
| Settings | read, write | user 30 per min | O | sync loops |
| Devices | register push token | user 10 per hour | O | token churn |
| Account | request deletion, restore | user 3 per day, 5 per hour | C | abuse |
| Privacy | data export, if built | user 3 per day | C | heavy |
| Anything else | default | unauthenticated ip 120 per min; authenticated user 300 per min | O | catch-all |
| Health | health check | exempt, returns no detail | - | probes |

Any new route that does not fit a row gets a new row in the same change.

## 4. The 429 response
Status 429, header `Retry-After` (seconds), the standard error envelope, catalog code `rate.limited`, message "Too many attempts. Try again in a few minutes." Status, body and timing are IDENTICAL whether or not the account, email or token exists (A7). Never say which limit fired or how many tries remain. Log a structured line (route id, limit id, hashed key prefix, never raw email or IP) and count it for the monitor.

## 5. Client address
Take the IP only from the trusted-proxy setting `TRUST_PROXY_HOPS` (number of proxies in front; 0 locally). Never read `X-Forwarded-For` directly. Group IPv6 addresses by their /64 prefix [VERIFY]. Test: sending a fake `X-Forwarded-For` does not change the key or reset the counter.

## 6. Redis down
Fail mode C routes answer a generic 503 (no detail) and are logged; fail mode O routes continue and log a warning. An emergency in-process cap on a fail-open route is optional and documented. Test both modes by stopping Redis in the test environment.

## 7. The app side (U, X rules)
Show the catalog message in the form. Disable the submit control until `Retry-After` passes and show the time in text, not colour alone. Announce the message politely to screen readers, keep focus on the form heading. The refresh logic stays single-flight and never retries a 429 in a loop; background fetches back off.

## 8. Tests (all required)
1. Route walk: every registered route has a limit id (fails on a new route without one).
2. Each inventory row: request number max+1 returns 429 with `Retry-After`; after the window it works again.
3. Known and unknown email/token give an identical status, body and similar timing (extend the A7 measurement).
4. The limit holds across two server instances (and a restart), because the counter is in Redis.
5. The limiter runs before hashing: a flooded sign-in does not raise Argon2id queue length beyond the cap.
6. Spoofed `X-Forwarded-For` has no effect.
7. Redis stopped: fail-closed routes give 503; fail-open routes work.
8. Webhook: bad signature is rejected cheaply; a valid signed event passes while a user is rate limited.
9. Idempotency-Key replay on payment and swap routes returns the stored response without a second charge.

## 9. Mistakes to avoid
A limit only on the sign-in form; a limit keyed by raw email; a different message for unknown accounts; locking the account instead of slowing the attacker; trusting `X-Forwarded-For`; limiting the webhook per user; an in-memory counter; running the limiter after hashing; a route added without a row in the inventory.
