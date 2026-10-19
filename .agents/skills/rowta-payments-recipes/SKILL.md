---
name: rowta-payments-recipes
description: "Use when building or changing Rowta billing and payments: plans and seat counting, Flutterwave test-mode checkout, the dev-only provider simulator, the signed webhook, the append-only ledger, rebuildFromLedger, failed renewals, the 7-day grace period and the restricted state."
---

# rowta-payments-recipes

Part of the Rowta method. Scope: PRD 8.6, rules D1 to D3, S13, C4, C10, P7. Library and provider details are [VERIFY].
Code here is a PATTERN: check every library call against current documentation [VERIFY] before using it, and never paste real secrets (rule S1).

## 1. Money
One module `server/src/billing/money.ts`: amounts are integers in minor units with a currency code beside them. Never a float, never a decimal string in arithmetic (D1). "Minor unit" = the currency's smallest unit (cents, kobo, ...); the exponent (0, 2 or 3) comes from the `currencies` table, never from a constant. The billing currency is the paying owner's country currency, locked on the subscription at the first purchase (PRD 5); prices come only from `plan_prices`; there is no fallback currency: a currency that is not enabled with a full price row is not sold, and its country is not offered at sign-up (the country list is read from `countries` joined to sold currencies). Boot fails if the fallback currency has no full price row. ONE function `toProviderAmount(minor, currency)` converts to the provider's unit and has tests (for example 2000 minor becomes "20.00" if the provider takes major units; test a 0-decimal and a 3-decimal currency as well). [VERIFY] the unit: Flutterwave's pages I read do not state it and one third-party guide says major units, so the Phase 7 gate compares the provider's reported amount for a test-mode payment with the expected minor-unit amount and fails on a 100x difference. Receipts are "payment receipts", not tax invoices (`docs/TAX-NOTES.md`). Plans, prices, seats and the 200-seat ceiling live in ONE config file (PRD section 5). Proration is the pure module from `rowta-data-recipes` 3.10; write its 11 test rows first.

## 2. Seat counting
Seat = active NON-OWNER membership (PRD 5). Count inside the same transaction as the invite acceptance or seat change, with a row lock on the subscription row (C3). On Starter, the server also stops issuing invites when active non-owner members plus pending invites reach 5. Never cache seat counts used for limit checks.

## 3. Checkout with Flutterwave (test mode)
- The app never decides whether payment succeeded. It opens the hosted checkout URL the SERVER returns, then refetches.
- Server creates the checkout with an `Idempotency-Key` (9.9) and inserts a pending record first; the redirect back to the app is NOT proof of payment.
- All provider keys stay on the server (S4). Read their NAMES only; never print values (S1).
- [VERIFY in Flutterwave's current docs, cite the page]: the endpoint to create a payment, the currency options in test mode (PRD Q5), how to verify a transaction by ID, whether a reusable authorization (tokenised card) exists for automatic renewal charges (PRD Q6), and the exact webhook signature scheme. Put whatever you verify in `docs/AUDIT-NOTES.md`.
- Every outbound call has a timeout and uses backoff with jitter; never retry a charge without an idempotency key (C5, C10).

## 4. Webhook
Follow recipe 3.11 in `rowta-data-recipes`. The signature scheme is confined to `server/src/billing/webhook-signature.ts` (A4 exception E1), constant-time compare, raw body first (S13). Tests required: forged signature rejected; the same event twice gives one ledger row; out-of-order events; a replayed old event; a payload that disagrees with the provider's own re-verification.

## 5. Development-only simulator (P7, PRD 8.6)
- A small module under `server/src/dev/` loaded ONLY when `PAYMENT_SIMULATOR_ENABLED=true`. At startup: if it is true and `NODE_ENV=production`, throw and exit. A test proves the refusal.
- It fakes the provider, nothing else: a fake hosted-checkout page or endpoint, a fake "verify transaction" answer for the job, and a dev-only trigger that POSTs a signed event to the REAL webhook endpoint. The signing secret is the configured webhook secret; if empty in development, use a random in-memory secret shared by signer and verifier and never log it.
- The simulator must exercise the same handler, dedupe, job and ledger code as production. If you add a bypass that skips them, the simulator proves nothing.
- Scenarios to script: success, duplicate event, forged signature, failed renewal, recovery after grace.
- List it in `docs/SECURITY.md` section 3 (dev-only code). Say in `docs/AUDIT-NOTES.md` that the real test-mode flow is unverified unless the owner added test keys and you ran it.

## 6. Ledger (D3)
- `ledger_entries` is insert-only: a trigger that raises on UPDATE and DELETE, plus revoked UPDATE and DELETE privileges for the application role. Document the sign convention (for example charge positive, credit and refund negative) in `docs/PRORATION.md`.
- Corrections are new rows (`adjustment`). `provider_ref` is UNIQUE where not null; `idempotency_key` guards retries. No personal data in the ledger (PRD 7.2).
- `rebuildFromLedger(teamId)` recomputes subscription state; a test asserts it equals the stored state.
- Test: an attempted UPDATE and an attempted DELETE both fail, run as the application role.

## 7. Failed renewal, grace, restricted
| From | Event | To | Effects |
|---|---|---|---|
| active | renewal charge fails | past_due | grace_ends_at = now + 7 days; notify owner day 0, 3, 6 (no amounts or names on the lock screen) |
| past_due | payment succeeds | active | clear grace; ledger row; activity event |
| past_due | grace ends | restricted | members can still view shifts; NO creating or editing shifts, NO invites, NO swap approvals |
| restricted | payment succeeds | active | restrictions lifted at once |
The renewal cron only enqueues (J2); the job charges using an idempotency key built from team and period so a double run cannot double charge.

## 8. Tracing
Log one structured line per payment step with request ID, team ID, provider reference and result; never card data (it never reaches us) and never keys. `docs/payment-trace.md` shows how to answer "what happened to this user's payment at 3:14pm?" with a real example.

## 9. Mistakes to avoid
Trusting the redirect; caching subscription or seat state; using a float anywhere; letting the simulator skip the real handler; leaving the signature check outside its one file; an UPDATE on the ledger "just to fix a typo".

## Rate limits (S14)
Payment initiation, seat and plan changes, the simulator and the webhook each have a named limit; see `rowta-rate-limiting-recipes` (inventory, webhook rules, Idempotency-Key). Tests for the limits are listed there (section 8) and are required.


## payment_intents flow (added)
1. Create a `payment_intents` row (global DB, status pending, `amount_minor`, `currency`, `tx_ref`) before calling the provider.
2. On the webhook: verify the signature, insert `webhook_events` (duplicate means stop), look up the intent by `tx_ref`, and compare the provider-reported amount converted by `fromProviderAmount` with the intent's `amount_minor` and currency. A mismatch (including a 100x one) fails and writes nothing to the ledger.
3. Write the `ledger_entries` row on the team's shard (unique `provider_ref`), then mark the intent complete. Both steps are safe to repeat.
