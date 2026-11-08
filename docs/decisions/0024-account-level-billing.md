# ADR 0024 — Account-level billing and subscription system

Date: 6 Nov 2026
Status: Accepted
Supersedes: ADR 0023 (per-team billing holder and hand-over) — see below for conflicts.

## Context

PRD section 5 originally treated "Owner" as the role that manages billing per team. The owner has decided that
billing follows the OWNER ACCOUNT (the user who created the team), not the team role or a per-team billing holder.
Only owners pay. Staff and managers never pay and get their team's owner's plan. One subscription per owner account,
not per team.

## Decisions

**A1 — One subscription per owner account.** Billing is account-level, not team-level. The owner_accounts table
(db0, global) holds one row per paying user: plan, status, period, currency, authorization ref. Teams are linked to
accounts via owner_team_registry (db0). A team's coverage is cached on the teams row (coverage_status, is_extra,
extra_people) and refreshed by applyCoverage() on billing events.

**A2 — Plan data is data-driven.** plan_entitlements table (db0) stores prices and limits: monthly 650000 kobo /
2 free teams; yearly 7800000 kobo / 3 free teams; extra team 200000 kobo/month; extra person 20000 kobo/month;
15 people per team included on paid plans (10 on trial); caps: 20 teams/account, 50 people/team;
trial: 14 days, 1 team, 10 people, one trial per user (DB unique);
minimum add-on charge 50000 kobo; charges rounded to whole naira.

**A3 — Trial is automatic.** The first team created by a user with no account starts a 14-day trial automatically.
Existing teams are backfilled with a trial. Trial limits apply only to new teams/people; existing teams are
grandfathered for 14 days.

**A4 — Capacity is enforced under lock.** Team creation reserves a slot inside a db0 transaction holding
SELECT FOR UPDATE on the owner's owner_accounts row. If the shard write fails, the slot is released. A team beyond
the free allowance is created as 'pending_payment' until the webhook confirms the charge.

**A5 — Account-level charging.** New endpoints: GET /billing/account, POST /billing/account/quote,
POST /billing/account/checkout (Idempotency-Key required), POST /billing/account/cancel. Activation happens only in
the webhook job after provider re-verification (amount AND currency must match). Reuses proration.ts; prorated add-ons
rounded to whole naira; amounts below 50000 kobo roll into the next renewal.

**A6 — Renewal, grace, read-only.** One renewal per owner account. Monthly failure: 7-day grace (notices day 0/3/6),
then read-only for all teams. Yearly: reminders 14/7/3 days before renewal. Trial end/cancel/lapse: read-only 30 days.
Read-only means shifts viewable but no create/edit/invite/swap.

**A7 — Move billing.** Moving a team's billing to another account is a separate action: only the current paying owner
starts it; receiver must be the team's current Admin with an active account and capacity; atomic; one open move per
team; 7-day lazy expiry. Routes under /teams/:teamId/billing/move/*. Idempotency key counts as replay only for same
purpose and team.

**A8 — Ownership transfer never moves billing.** transfer_ownership changes only the owner role; billing stays on the
creating owner's account (decision D2 from ADR 0023, preserved).

## Conflicts with ADR 0023

ADR 0023 is superseded where it conflicts:
- D1 (billing holder per team) → replaced by A1 (account-level billing). `subscriptions.billing_user_id` is legacy.
- D3 (hand over billing to a member) → replaced by A7 (move billing to another account). Hand-over routes retired;
  move routes under /teams/:teamId/billing/move/* are the new path.
- Per-team subscription model → replaced by account-level model. `subscriptions` table remains as legacy, unused by
  new code.

## Related

- PRD section 5 (pricing), section 8.6 (billing)
- ADR 0002 (Prisma two-database), ADR 0018 (team delete and transfer)
- server/prisma/sql/075-085 (new SQL), server/src/billing/entitlements.ts, account-service.ts, move-service.ts,
  account-renewal-processor.ts

---

## Addendum — Move billing decisions (7 Nov 2026)

**M1 — Receiver with no billing account gets automatic 14-day trial on accept.** The receiver does not need a billing
account to receive a move request. On accept, if they have no `owner_accounts` row, one is created as a normal 14-day
trial (monthly, trialing, trial_used = true). One trial per user is enforced by `owner_accounts_one_trial_idx`.

**M2 — No refund or credit to the old payer for the period already paid.** The old payer keeps paying until the move is
accepted; nothing is refunded.

**M3 — From move accept, the previous payer is never billed for that team.** On accept, any open `'pending'`
`payment_intents` from the previous payer for that team are marked `'expired'`. The legacy per-team renewal processor
skips teams whose `owner_team_registry.owner_user_id` differs from `subscriptions.billing_user_id`. Renewals use the
current account's `provider_authorization_ref`; a moved team never renews through the previous payer's authorisation.

**M4 — Accepting always completes the move.** If the receiver's plan does not cover the team yet, the team becomes
`pending_payment` (read-only for everyone) until the receiver pays via add_team/subscribe. The move itself is not blocked.

**M5 — No "also hand billing" switch on the transfer screen.** `transfer_ownership` changes only the Admin role; it does
not touch billing. A `transfer_still_paying` notice (email + push) is sent to the payer only when the payer is not the
new Admin.

**M6 — `payment_intents` markers removed for account-level moves.** `requestMove` and `acceptMove` no longer insert
`payment_intents` rows with `purpose`/`kind` = `'account_move'` (which violated the CHECK constraints). Idempotency is
via move state only: `requestMove` returns the existing open move for the same caller→receiver pair; `acceptMove`
returns `{accepted: true}` if already accepted to this receiver.

**M7 — RequestMove authorisation.** Caller must be an active team member AND the team's current payer
(`owner_team_registry.owner_user_id === caller`), with registry status not `cancelled`/`read_only`, otherwise
`403 billing.not_payer`. Receiver must be the current Admin and not the caller. Receiver must have a working user
account (not deleted/disabled) but needs no billing account.

**M8 — 8 move notice categories.** `billing.transfer_still_paying`, `billing.move_requested`, `billing.move_accepted`,
`billing.move_declined`, `billing.move_cancelled`, `billing.move_expired`, `billing.move_payment_needed`,
`billing.move_trial_started`. Templates in `server/src/mail/templates.ts`; push content in
`server/src/notifications/outbox.ts`; enqueue calls in `server/src/billing/move-service.ts` and
`server/src/teams/service.ts`.

