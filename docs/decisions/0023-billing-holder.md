# ADR 0023 — Billing holder and hand-over (SUPERSEDED by ADR 0024)

Date: 6 Nov 2026
Status: Superseded by ADR 0024 (account-level billing).
Supersedes: none (new topic). PRD section 8.6 ("Billing holder and hand-over") and section 4 matrix updated accordingly.
Build status: D1, D2, D3 built per owner instruction, 6 Nov 2026. Superseded by account-level billing model.

## Summary of supersession

ADR 0024 replaces the per-team billing holder model with an account-level billing model:
- Billing follows the owner account (user who created the team), not a per-team billing holder.
- One subscription per owner account, not per team.
- Hand-over routes retired in favour of account-level move billing (/teams/:teamId/billing/move/*).
- `subscriptions.billing_user_id` is legacy; `owner_accounts` is the source of truth.

## Context

PRD section 5 originally treated "Owner" as the role that "manages billing". The owner has decided that billing access
should instead follow the user who made the team's first purchase (the billing holder), independent of team role.
Ownership transfer must never move billing. A voluntary "hand over billing" flow lets the holder move billing to a
nominated member who accepts and adds their own payment method.

## Decisions (owner, 6 Nov 2026)

**D1 — Billing holder, not role.** Billing access follows the billing holder (the user who made the team's first
purchase). A new Admin who is not the holder sees plan name, seats used out of the limit, and the restricted / past-due
status, with NO amounts and NO payment details. Manager and Staff see nothing about billing. **BUILT** —
`server/src/billing/holder.ts`, `server/src/security/policy.ts` (view_billing/manage_billing checkResource checks
`billing_user_id === userId`), `server/src/billing/service.ts` (getStatus owner/holder only).

**D2 — Ownership transfer never moves billing.** `transfer_ownership` changes only the owner role; it does not touch
`subscriptions` or any billing column and does not change the billing holder. **BUILT** — verified in
`server/src/teams/service.ts:905-984` (transferTeam changes only roles + activity event; no billing columns touched).

**D3 — "Hand over billing".** The holder picks one active member; that person must accept and add their OWN payment
method; only then billing moves. Both parties are informed and must acknowledge. The giver gets a thorough warning with
a checklist to remove their saved card and any other sensitive details at the payment provider. Nothing changes until the
recipient accepts AND the new payment method is authorised; the subscription keeps renewing under the current holder
meanwhile. **BUILT** — `server/src/billing/handover.ts` (request/accept/decline/cancel),
`server/src/billing/handover-routes.ts`, `server/src/billing/holder.ts` (takeOverBilling shared code path),
`server/src/billing/webhook.ts` (billing notification category), app screens `app/src/screens/billing/`.

## Proposals (owner to confirm)

- The recipient of a hand-over must be the current Admin. Any other member would contradict the PRD matrix (Manager:
  NO billing). Delegation to Managers is OFF. **BUILT** — `server/src/billing/handover.ts:requestHandover` finds the
  owner-member as the recipient.
- A request expires after 7 days with LAZY expiry (expires when read; no background job). **BUILT** —
  `server/src/billing/handover.ts:getHandover` computes expiry on read.
- The holder may cancel and the recipient may decline. **BUILT** —
  `server/src/billing/handover.ts:declineHandover`, `cancelHandover`.
- One open handover per subscription, enforced by a partial UNIQUE index in the database. **BUILT** —
  `server/prisma/sql/070-billing-holder.sql:47-49` (`billing_handovers_one_open_idx`).
- Handover events go in the append-only ledger without card data and NOT in the team activity feed. **BUILT** —
  `server/src/billing/handover.ts` writes ledger via `takeOverBilling`; activity event uses audience `managers` (owner
  decision: use most restrictive existing audience).
- A holder cannot delete their account while their payment method will still be charged (auto-renew on). After they
  cancel (access continues to period end, no further charge) or hand billing over, deletion is allowed. The holder may
  cancel at any time and may transfer team ownership at any time. Ownership transfer never touches billing. **NOT BUILT** —
  account deletion endpoint not yet implemented; [needs owner decision].
- If the holder is removed from the team, auto-renew stops at period end, the Admin is notified and may subscribe as the
  new holder; the currency stays locked, and if the recipient cannot pay in it the add-payment step fails and nothing
  moves. **NOT BUILT** — holder removal from team not yet integrated with billing stop.
- No money moves at hand-over; the current period continues and the next renewal charges the new holder. **BUILT** —
  `server/src/billing/handover.ts` does not create payment intents; `server/src/billing/renewal-processor.ts` charges the
  new holder's authorisation.
- Hand-over is blocked while the subscription is past_due, restricted or cancelled; in those states the Admin may TAKE
  OVER billing by adding their own payment method, the old holder is notified and loses access. **BUILT** —
  `server/src/billing/holder.ts:takeOverBilling` checks status; `server/src/billing/renewal-processor.ts` handles takeover.

## Handover state machine

`requested -> accepted | declined | cancelled | expired`. A request whose `expires_at` is in the past counts as expired
when read (lazy expiry). On acceptance the old holder's payment reference is deleted from the subscription and the
renewal job must only ever use the current holder's authorisation. Phase 7 gate test: after a hand-over no renewal uses
the old authorisation. **BUILT** — `server/src/billing/handover.ts:acceptHandover`,
`server/src/billing/renewal-processor.ts`.

## Data impact

- `subscriptions` needs a `billing_user_id` column (user id of the holder; nullable until first purchase; FK-checked to
  `users` on DB0 since subscriptions live on shards — see ADR 0002 / sharding constraints). **BUILT** —
  `server/prisma/sql/070-billing-holder.sql:10`, `server/prisma/db0/schema.prisma:331`, `server/prisma/db1/schema.prisma:331`.
- One open handover per subscription: partial UNIQUE index on `billing_handovers` where status = 'requested'. **BUILT** —
  `server/prisma/sql/070-billing-holder.sql:47-49`.
- No card data is ever stored; `provider_authorization_ref` is secret-like (never logged, never returned by the API).
- Rowta stores only a provider reference (`provider_customer_ref` on `subscriptions`), never card numbers, PIN or OTP.
  **BUILT** — `server/prisma/db0/schema.prisma:330-331`, `server/prisma/sql/020-team.sql:131-134` define only
  `provider_customer_ref` and `provider_authorization_ref`; no card-holder columns.

## Provider behaviour [VERIFY]

Whether the payment provider allows deleting a saved authorisation, and how, is not yet confirmed. Never invent provider
behaviour. Confirm before implementing hand-over acceptance.

## Related

- PRD section 2 (Owner role), section 4 matrix ("View or change billing"), section 8.6 ("Billing holder and hand-over")
- ADR 0002 (Prisma query client, two databases), ADR 0018 (team delete and transfer)
