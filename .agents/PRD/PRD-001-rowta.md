# PRD-001 — Rowta (Mobile Task A: shift scheduling app)

Source of truth: "Final Graduation Task", Part 2 (2.1 shared rules, 2.2 backend standard, 2.3 Rowta, 2.5
positioning). Rules live in `.agents/rules/*.md` (cited here as rule IDs such as A5 or D4). How to work
lives in the skills in `.agents/skills/`. This file says WHAT to build.
Markers: [DECISION] a choice made here the owner can change. [VERIFY] check against current official docs.
[OPEN] waiting for the owner (section 15); nothing that depends on an [OPEN] item may be built yet.

---------------------------------------------------------------------------------------------------

## 1. Product summary

Rowta is a shift scheduling app for small teams (restaurants, clinics, retail). An owner creates a team, invites
staff and publishes shifts. Staff see their shifts, request swaps and get notified about changes. Businesses pay a
monthly subscription priced per seat. Target platform: an Android development build (Expo, built in
Antigravity). The backend is a Node.js service with PostgreSQL (two databases for the sharding simulation), Redis,
BullMQ jobs and node-cron schedules.

## 2. Users and roles

- **Owner**: creates the team, manages billing, full control. Exactly one owner per team (database-enforced).
- **Manager**: creates and edits shifts, approves swaps.
- **Staff**: views shifts, requests swaps, sets their own settings.

## 3. Required features

### 3.1 From the brief (numbering as in the brief)
1. Sign up, log in, log out, invite members by email or link.
2. Role-based permissions for Owner, Manager, Staff.
3. Shift calendar and a paginated activity feed (new shifts, swaps, changes).
4. Shift swap requests with manager approval.
5. Subscription plans with seat-based pricing; upgrades, downgrades, adding or removing seats mid-cycle, with proration.
6. Push notifications for shift changes, swap requests and approvals.
7. User settings synced across devices and respected by the server.
8. Offline viewing of the user's upcoming shifts.

### 3.2 Added by the owner (all binding)
a. Argon2id for every password and short-code hash; SHA-256 banned (A1 to A4).
b. Auth messages never reveal which detail was wrong; uniform responses (A5, A6, section 11).
c. Zod validation for every form, on the client and on the server, schemas shared (V1 to V8).
d. Authentication as conditionally rendered views, not pages; single-page style (U1, U2).
e. Zero-reload state: no action needs a manual reload (U3).
f. Auto focus, accessible names (`aria-label`), state exposed to assistive technology (U7, X1, X2).
g. Accessibility for blind, deaf and hard of hearing, and speech-impaired users, NVDA and TalkBack (X1 to X14).
h. Beautiful, responsive UI on all phone sizes (U5, U6, U9, section 6).
i. Forgot-password flow that guides users back in (A10, section 8.1).
j. Minimum password length 8 (A8).
k. Soft delete, hard delete, grace periods (D4 to D6, section 8.10).
l. node-cron schedules where needed (J2, section 8.11).
m. Correct synchronous and asynchronous behaviour (C1 to C11).
n. SEO, Open Graph, page title, description, keywords, favicon, dynamic title (W1 to W6, section 10). Decided: yes (Q1).
o. Semantic text search (section 8.4). Decided: normal full-text search (Q2).

## 4. Permission matrix (server enforced; every cell needs a test)

| Action | Owner | Manager | Staff |
|---|---|---|---|
| View team shifts and roster | yes | yes | yes (own team only) |
| Create, edit, delete shift | yes | yes | NO (403) |
| Request a swap on own shift | yes | yes | yes |
| Approve or reject a swap | yes | yes | NO (403) |
| Invite members | yes | yes (staff only) [DECISION] | NO (403) |
| Change a member's role | yes | NO | NO |
| Remove a member | yes | staff only [DECISION] | NO |
| View or change billing | yes | NO | NO |
| Delete or restore the team | yes | NO | NO |
| Change own settings | yes | yes | yes |
| Log out of all devices (own account) | yes | yes | yes |
| Request deletion of own account | yes (see 8.10 rule) | yes | yes |

A user from another team gets 404 on any team resource (S7).

## 5. Plans and seats

Prices are exact and stored as integers in the currency's smallest unit (cents, kobo, ...; the exponent is per currency). The table below is the USD price list from the brief; other currencies use the owner's fixed price table (Currency, below).

| Plan | Price | Seats included | Extra seat |
|---|---|---|---|
| Starter | 2000 per month | up to 5 | not available (hard cap 5) |
| Team | 5000 per month | up to 15 | 300 per month |
| Business | 12000 per month | up to 40 | 200 per month |

`monthly(plan, seats) = base + extraSeatPrice * max(0, seats - included)` (integer minor units).
Starter with more than 5 seats is rejected by the server. Team and Business have no stated maximum in the brief;
set a configurable sanity ceiling (default 200 seats) and document it [DECISION].
A **seat** = an active NON-OWNER membership (managers and staff count; the owner does not) [DECIDED Q3]. So a Starter
team holds the owner plus up to 5 other members, which makes the brief's "5 staff on Starter" example hold literally.
A pending invite does not count as a seat until accepted, but on Starter the server stops issuing invites when
`active non-owner members + pending invites >= 5`. Seat counts in the proration tests mean billable (non-owner) seats.
On Team and Business, accepting an invite beyond the included seats creates a billable extra seat (8.6).
Currency [DECISION, owner, 18 Oct 2026]: **a payment is in the currency of the country the paying user is in.**
- The country is CHOSEN at sign-up (a required list, pre-filled from the phone's region, never guessed from the IP address)
  and can be changed on the account screen. It is stored as `users.country` (ISO 3166-1 alpha-2). A country maps to its
  local currency through the `countries` table; the supported currencies are rows of `currencies`.
- The team's billing currency is the paying owner's country currency AT THE FIRST PURCHASE and is then locked on the
  subscription (`subscriptions.currency`) for its life. Changing the country later affects only a NEW subscription.
  [DECISION, proposed: confirm with the owner if a mid-subscription change should be allowed.]
- Scope: every currency the payment provider supports [VERIFY on the provider's current docs, cite the page, and in test
  mode]. A currency is SOLD only if it is `enabled` in `currencies`, the provider supports it, AND `plan_prices` has a row
  for every plan. There is NO fallback currency [DECISION, owner, 19 Oct 2026: "whatever country the user is"]. The sign-up country
  list offers ONLY countries whose currency is sold; a country whose currency has no price row, or the provider does not
  support, is not listed until it does. A user is never billed in a currency other than their own country's.
- Prices are a FIXED TABLE per plan per currency, supplied by the owner (`plan_prices`: base and extra-seat price in minor
  units). There is NO run-time exchange rate and no conversion. The agent never invents a price [OPEN Q12].
- The number of decimals differs by currency (0, 2 or 3): it is `currencies.minor_unit`, and `money.ts` uses it for
  display and for `toProviderAmount(minor, currency)` / `fromProviderAmount`. The provider may expect the amount in MAJOR
  units, possibly differently per currency [VERIFY: the provider's official pages I read do not state the unit; one
  third-party guide says major units]. The Phase 7 gate compares the amount the provider reports for a test-mode
  transaction, per currency, with the expected minor-unit amount; a mismatch fails the gate.
- Amounts shown to the user are formatted for their currency and language (Intl). Receipts show the amount in the paid
  currency. Tax per country is NOT decided here (`docs/TAX-NOTES.md`; prices are treated as what the user pays).
- Seeding: the build fills `currencies` and `countries` from cited public sources (ISO 4217 and CLDR, or the provider's
  list) and records the sources in `docs/PAYMENTS-CURRENCIES.md`; none of it comes from memory.

## 6. Screens, views and UI requirements

### 6.1 Views and screens
**Signed out: one screen, `AuthGate`, with these views (U1)**: Sign in; Create account; Enter the 6-digit code
(email verification); Forgot password; Enter reset code; Set a new password; Sign in by email link (request and
"check your email"); Accept invite. Every view has its own title, heading, first-input focus and live-region
announcements. Verified https links set the view: `<PUBLIC_WEB_URL>/invite/<token>` and `<PUBLIC_WEB_URL>/magic#<token>`; the custom-scheme forms `rowta://invite/<token>` and `rowta://magic/<token>` are only a fallback.
**Signed in**: Dashboard (the home screen: your next shift, this week, pending swap requests for managers, recent activity, and for the owner a seat and billing summary with the failed-payment banner); team create and switch; shift calendar; shift detail; create or edit shift (Owner, Manager); swap
request and swap approvals; activity feed (infinite scroll); roster (with search); notification
settings; settings (quiet hours, time zone, language, theme); billing (Owner only: plan, seats, upgrade, downgrade,
payment history and receipts from the ledger (receipts are not tax invoices, see docs/TAX-NOTES.md), failed-payment banner); account (edit your name, log out, log out of all devices, delete account);
team danger zone (Owner: delete or restore team).
Every list has loading, empty, end-of-list and error states. Offline shows a visible "last updated" time.

### 6.2 Visual design requirements (owner: "a proper beautiful UI")
- **Design system** [DECISION, owner, 18 Oct 2026; U11]: the owner's existing design system (`design-system/`:
  Material-3 style roles, Poppins, light colour set, spacing, shadows) is the source of every value. Colours are never
  changed. The web surface uses `design-variables.css` directly; the app gets a generated `tokens.ts`. It has no dark
  colour set, so dark mode is [OPEN Q9]; until the owner decides, v1 ships light only and the theme setting keeps its
  `system | light | dark` values with dark falling back to light.
- Phase 1 delivers: design tokens (colour, type scale, spacing, radii, shadows, motion
  durations) taken from the design system; the light theme (dark when Q9 is decided); a small component kit used by every screen: Button (variants,
  loading), Text, Input (label, hint, error, show/hide for passwords), Card, ShiftCard, Avatar, Chip, Badge, Toast,
  Skeleton, EmptyState, BottomSheet, ConfirmDialog. Each has documented variants, states and props.
- A design-direction ADR is presented to the owner for approval before screens are built. The agent proposes; it does
  not impose.
- Skeletons for lists, designed empty and error states, tasteful Reanimated motion that honours reduce-motion, haptics
  on key actions (publish shift, request swap, confirm payment) [VERIFY libraries].
- Strings from the catalog only (U8). Text contrast and target sizes per X5 and X6.

### 6.3 Size matrix (U9). Every screen is checked at:
| Case | Size (dp) | Notes |
|---|---|---|
| Very small | 320 x 568 | smallest supported |
| Small | 360 x 640 | common budget Android |
| Medium | 390 x 844 | |
| Large | 412 x 915 | |
| Tablet / unfolded foldable | 600 x 960 and wider | layout must not stretch awkwardly |
| Landscape | 844 x 390 | scrolls; nothing unreachable |
| Text scale | 1.0, 1.3, 2.0 | no clipping or overlap |
| Display size | default and largest | |
Screenshots saved to `docs/ui-matrix/<screen>-<case>.png` [VERIFY emulator setup].

## 7. Data model

Names are guidance; the constraints are not optional. Every timestamp is `timestamptz` in UTC (C9). Every team-scoped
row carries `team_id` (S7).

### 7.1 Global database (also shard 0 [DECISION, default yes])
- `users`: id, email (UNIQUE, lowercased), display_name (1 to 60 characters, shown to teammates, see 8.1), country (NOT NULL, references `countries`), password_hash (PHC string, Argon2id), email_verified_at,
  status (`active` | `pending_deletion`), deletion_requested_at, deleted_at, created_at, updated_at.
- `pending_signups`: id, email, display_name, country, password_hash, code_hash (Argon2id), attempts, expires_at. A real `users` row is
  created only after the code is verified, which keeps sign-up responses uniform (A6).
- `sent_emails`: id, user_id, kind, ref (text, NOT NULL, empty string for one-time kinds such as the welcome email, the
  ledger entry ID for receipts), sent_at; UNIQUE (user_id, kind, ref). A job inserts first and sends only if the insert
  won, so a one-time email is sent once even if its job runs twice (C4). No email body is stored. [DECISION, accepted by
  the owner on 18 Oct 2026; record in an ADR.]
- `refresh_tokens`: selector (UNIQUE), verifier_hash (Argon2id), family_id, parent_id, user_id, device_id, used_at,
  revoked_at, expires_at, created_at.
- `password_resets`: id, user_id, code_hash (Argon2id), attempts, expires_at, consumed_at, grant_selector (UNIQUE),
  grant_verifier_hash, grant_expires_at.
- `magic_tokens`: selector (UNIQUE), verifier_hash, user_id, expires_at, consumed_at.
- `devices`: id, user_id, device_id (UNIQUE per user), push_token, platform, last_seen_at.
- `user_settings`: user_id (PK), quiet_start, quiet_end, time_zone (IANA), notify_shift_changes, notify_swaps,
  notify_billing, language, theme, updated_at (server-set).
- `team_directory`: team_id, shard, override_shard (nullable; for moving a very large team).
- `user_team_index`: user_id, team_id only. NO role column (S8).
- `push_tickets`: id, device_id, ticket_ref, created_at, checked_at (receipt checks for push notifications).
- `notification_log`: id, user_id, team_id, kind, ref, created_at; UNIQUE (user_id, kind, ref) so a notice is sent once.
- `currencies` (GLOBAL reference): code (ISO 4217, PK), name, minor_unit (0 to 3), provider_supported, enabled (cannot be true unless provider_supported).
- `countries` (GLOBAL reference): code (ISO 3166-1 alpha-2, PK), name, currency (references `currencies`).
- `plan_prices` (GLOBAL reference): (plan, currency) PK, base_minor, extra_seat_minor (NULL for Starter only). The owner supplies the rows (Q12).
- `payment_intents` (GLOBAL, so a webhook can find the team without knowing its shard): id, team_id, tx_ref (UNIQUE),
  purpose, amount_minor, currency, status, idempotency_key, provider_ref, created_by, created_at, completed_at. The
  expected amount is stored here and compared with what the provider reports (see "Money in the database").
- `webhook_events` (GLOBAL): provider, provider_event_id (PK together), event_type, tx_ref, received_at, processed_at,
  status. No payload is stored.
- `purge_log`: id, job, table_name, row_count, dry_run, ran_at (no personal data).

### Money in the database
Every money column is `bigint` in the currency's smallest unit (cents, kobo, ...), next to a `currency`
text column (plain text, not a custom type, so Prisma reads it as a String). In DB0 it references `currencies(code)`; on a shard it is checked to the shape `^[A-Z]{3}$` because a shard cannot reference DB0, and the server accepts only enabled currencies that have prices. No `numeric`, `real`, `double precision` or `money` column exists
anywhere; `server/prisma/sql/selftest.sql` fails if one appears. This holds whatever the payment provider uses. The
conversion to the provider's unit happens only in `toProviderAmount` / `fromProviderAmount`. [VERIFY Flutterwave's unit]

### Schema source of truth
The reference DDL is `server/prisma/sql/000-common.sql`, `010-global.sql` (DB0 only), `020-team.sql` (DB0 and DB1) and `030-app-role.sql` (DB0 and DB1, last: the non-owner `rowta_app` role the app uses, with no update, delete or truncate on the ledger; proved by `selftest-app.sql` run as that role).
`docs/DATABASE.md` is generated from a real database loaded with them. Prisma is not used for migrations (it does not
manage two databases well); apply the SQL files as the baseline migration on both databases. Constraints that must
exist (each is tested in `selftest.sql`): lowercase email; Argon2id PHC format on every hash column; name length and no
control characters; one active owner per team; one open invite per team and email; composite FKs that stop cross-team
assignment and swaps; `ends_at > starts_at`; one pending swap per shift; starter plan at most 5 seats; `past_due` needs a
grace date; ledger append-only (UPDATE, DELETE, TRUNCATE raise) with no foreign keys and a sign CHECK; unique
`provider_ref` and idempotency keys; one webhook event processed once; one welcome email per user.

### 7.2 Team tables (live on the team's shard)
- `teams`: id, name, created_at, deleted_at, deletion_requested_at.
- `memberships`: id, team_id, user_id, role, removed_at, created_at; UNIQUE (team_id, user_id); partial UNIQUE
  index on (team_id) WHERE role='owner' AND removed_at IS NULL. Removing a member sets `removed_at` (soft delete);
  re-adding clears it.
- `invites`: id, team_id, email, role, selector (UNIQUE), verifier_hash, invited_by, expires_at, accepted_at,
  revoked_at.
- `shifts`: id, team_id, assigned_user_id, starts_at, ends_at, label, notes, created_by, deleted_at, deleted_by,
  created_at, updated_at; CHECK ends_at > starts_at; composite FK (team_id, assigned_user_id) to
  memberships (team_id, user_id) so a cross-team assignment is impossible; code (inside the transaction) also
  rejects assigning to a removed member.
- `swap_requests`: id, team_id, shift_id, requested_by, target_user_id (nullable), status
  (`pending|approved|rejected|cancelled`), decided_by, decided_at; partial UNIQUE (shift_id) WHERE status='pending'.
- `activity_events`: id, team_id, kind, actor_user_id (nullable), subject_id, data (JSON), created_at; index
  (team_id, created_at DESC, id DESC).
- `subscriptions`: id, team_id (UNIQUE), plan, seats, status (`active|past_due|restricted|cancelled`),
  currency, period_start, period_end, scheduled_plan, scheduled_seats, grace_ends_at, provider_customer_ref,
  provider_authorization_ref [OPEN Q6: only if renewals are automatic; protect it], created_at, updated_at.
- `ledger_entries`: append-only (D3). Columns: id, team_id, kind (`charge|credit|refund|adjustment`), amount_minor
  (integer in minor units; sign convention documented), currency, reason, subscription_id, provider_ref (UNIQUE where not null),
  idempotency_key, period_start, period_end, created_at. Contains no personal data on purpose.
- (`webhook_events` is global; see 7.1.)
- `idempotency_keys`: scope, key (PK together), request_fingerprint (`blake2b512`), state, status_code, response, created_at.
- `purge_log`: as above.

### 7.3 Data-lifecycle table (D4 to D6; one config file)
| Data | Delete type | Grace / retention | Hard-delete by |
|---|---|---|---|
| Shift | soft (`deleted_at`) | kept 90 days | purge-soft-deleted |
| Membership | soft (`removed_at`) | kept with the team | team purge |
| Account | soft (`pending_deletion`) | 30 days to cancel by signing in | purge-soft-deleted |
| Team | soft (`deleted_at`) | 30 days to restore | purge-soft-deleted |
| Used or expired tokens, codes | hard | 7 days after expiry | purge-tokens |
| Idempotency keys | hard | 48 hours | purge-idempotency |
| Sent-email records | hard | with the account | purge-soft-deleted (account purge) |
| Push tickets, notification log | hard | 30 days [DECISION: proposed, not agreed] | purge-tokens |
| Payment intents | hard | kept until a tax adviser sets the period [DECISION, VERIFY]; not purged yet | purge-tokens |
| Ledger entries | NEVER deleted | forever | none |
| Activity events | follow their team | with the team | team purge |

## 8. Domain flows

### 8.1 Authentication (Requirement 3; rules A, V, U1, U7, X)
- **Methods**: email plus password, and magic link [DECISION: magic link needs no Google OAuth setup].
- **Create account**: view `signUp` (name, email, country, password, confirm). The country is a required list (pre-selected from the phone's region, changeable) and decides the payment currency (Currency, section 5); the server checks it against `countries`. Zod on both sides (password 8 to 128 characters). The name is
  `displayName`: trimmed, 1 to 60 characters, no control characters (V8). It is kept on `pending_signups`, copied to `users`
  after the code is verified, shown to teammates (roster, shifts, swaps, activity, search), used in the greeting of emails
  ("Hi <name>,"; "Hi," when there is none) and editable on the account screen.
  Server stores a `pending_signups` row with the Argon2id password hash and an Argon2id-hashed 6-digit code, and
  enqueues the email job. Response is ALWAYS the uniform message (11). If the email already has an account, the
  email says someone tried to sign up and nothing changes. View `verifyCode` takes the code (A9). On success the
  `users` row is created and the user is signed in.
- **Buttons that wait** [DECISION, owner, 18 Oct 2026; X14]: Create account, Sign in, Reset password (every step) and
  Verify do nothing until the form is valid, and the screen says why in plain words under the button. They are
  dimmed and marked not ready for assistive technology but stay focusable (never the native `disabled`); pressing one
  sends nothing, moves focus to the first problem and announces the reason. Reasons describe format only and never say
  whether an account exists (A6). Every button has pressed, focus, busy and result feedback; icon-only buttons have
  names (X1). The server validates again.
- **Sign in**: view `signIn`; the form checks only email format and non-empty password (V7). The handler normalises
  the email, loads the user, ALWAYS runs one Argon2id verify (a dummy hash if the user does not exist), and
  returns the same failure for every cause: "Invalid email or password." (A5, A7). A correct password on an
  unverified email returns the "check your email" prompt and re-sends a code. Successful sign-in issues the access
  token (HS512, 15 minutes, no role claim) and a rotating refresh token (selector.verifier, 30 days) and stores
  both in `expo-secure-store`.
- **Refresh with reuse detection**: each refresh marks the old token used and issues a new one in the same family.
  Presenting a used token revokes the whole family and forces re-login. A test replays an old token.
- **Log out**: revoke this device's token family. **Log out of all devices**: revoke all of the user's refresh
  tokens and delete their devices (push tokens). Access tokens already issued work for up to 15 minutes; document it
  (interview question 3). Optional upgrade: `token_version` in the token, checked per request, at the cost of a
  database or Redis read per request.
- **Forgot password (guided)**: view `forgot` (email) with the uniform message; view `resetCode` (6-digit code,
  expires in 5 minutes, 5 attempts, resend after 60 seconds with a visible countdown); view `resetNewPassword` with a live checklist ("At least 8 characters",
  "Matches the confirmation"), show/hide toggle and autofill hint `new-password`. The server verifies the code and
  returns a 10-minute grant; the new password is accepted only with a valid grant, hashed with Argon2id, all the
  user's refresh tokens are revoked, and the app returns to `signIn` with the email prefilled and the message
  "Password updated. Sign in with your new password." The old password is never shown or recoverable (A10).
- **Magic link**: view `magicRequest` then `magicSent`; the email carries the verified https link `<PUBLIC_WEB_URL>/magic#<selector.verifier>`. The token sits in the URL fragment,
  which browsers do not send to servers and which email scanners that only fetch the URL do not see. Opening the link shows
  the view `magicConfirm` (in the app through App Links, or on the web page) with ONE button, "Sign in"; only that button's
  POST consumes the token, so a scanner that merely opens the link cannot use it up. The link expires in 15 minutes and is
  single use. Unknown emails get a uniform response. [VERIFY with `adb` that the app receives the fragment; if it does not,
  use the path form `/magic/<selector.verifier>` with the same button rule.] `rowta://magic/<token>` stays only as a fallback
  behind the page's "Open in the app" button.
- **Invite**: see 8.2.
- **Rate limits** (Redis, per IP and per hashed email): sign-in, sign-up, code verify, forgot, magic request,
  resend, invites, payment initiation. Values and one-line reasons live in one config file (A7, 9.7).
- **Focus and announcements** per view: U7, X3. The window title or screen title changes per view (W3 on web).

### 8.2 Teams, roles, invites, seats
- Create team (the creator becomes Owner), switch team, role matrix (4), invite create and accept.
- Invite token is `selector.verifier` (A3), 7 days [DECISION], single use, delivered by email or a shareable link
  https link `<PUBLIC_WEB_URL>/invite/<token>` (an App Link that opens the app, or the web fallback page on the Vercel-hosted site; `rowta://invite/<token>` is only a fallback). Accepting creates the membership atomically with
  the seat check in one transaction (C3) and lands the user in the right team. If the person has no account the app
  shows `signUp` first and resumes the invite afterwards.
- Starter cannot invite a sixth seat (owner not counted, Q3). Demotion takes effect on the next request (S8).
- Custom-scheme links (`rowta://`) can be claimed by another app on the same phone. Prefer verified Android App Links (https) for invite and magic links where possible; they need a hosted domain, which the Vercel-hosted web surface can provide (serve `/.well-known/assetlinks.json` over https) [VERIFY]. Tokens are single use and short-lived either way.

### 8.3 Shifts, calendar, activity feed (Requirement 1)
- Calendar endpoint: shifts for a date range, maximum range enforced.
- **Cursor pagination** for the feed, order `(created_at DESC, id DESC)`. The cursor is an opaque string encoding
  the last item's `(created_at, id)`. Query uses a row comparison:
  `WHERE (created_at, id) < ($cursorTime, $cursorId)`. Test: 5 events with one identical timestamp straddling a
  page boundary produce no skip and no duplicate.
- Index `activity_events (team_id, created_at DESC, id DESC)`. Capture `EXPLAIN (ANALYZE, BUFFERS)` before and
  after adding it on 10,000+ seeded rows (repeatable seed, fake data), save both in `docs/`.
- App: FlashList infinite scroll, pull to refresh, loading, empty, end-of-list and error states, no duplicate
  requests on fast scrolling (guard on the fetching flag plus the query library's de-duplication; show it in the
  request log).
- Every shift change writes an `activity_events` row in the same transaction. Deleting a shift is a soft delete.

### 8.4 Search (owner item "semantic text search"); decided Q2: normal text search
PostgreSQL full-text search (`tsvector` with a GIN index), always
team-scoped, over roster names, shift labels and notes, and activity events, with typo-tolerant ranking
[VERIFY approach]. Vector (embedding) search is NOT built, because it adds an embedding provider,
cost, and a second index to keep consistent. Search results obey permissions and team isolation like any query.

### 8.5 Swaps (feature 4)
States `pending -> approved | rejected | cancelled`. Made by the shift's assignee for their own shift, optionally
naming a colleague. Only Owner or Manager decides. Approval reassigns the shift and writes activity and enqueues
notifications in one transaction. One pending swap per shift (partial unique index). The request endpoint is
idempotent (`Idempotency-Key`). App: optimistic update ("Swap requested", button busy and disabled for assistive
technology as well as visually), rollback with an error message on failure (C7).

### 8.6 Billing and proration (Requirement 5)
**Period and day counting [DECISION].** `P` = days in the billing period (30 in every test). `elapsed =
floor((now - period_start) / 1 day)`; `R = P - elapsed` days remaining. First day gives `R = P`; last day gives
`R = 1`. All UTC.

```
credit       = floor(monthly(oldPlan, oldSeats) * R / P)
charge       = floor(monthly(newPlan, newSeats) * R / P)
chargeToday  = charge - credit         // integer minor units, round DOWN each term (brief rule)
```
Integer arithmetic only: multiply first, then integer-divide. `floor(a) - floor(b)` can differ by 1 cent from
`floor(a - b)`; this system uses the former. The formula and rounding rule are written in `docs/PRORATION.md`.

**Direction rules (brief):** upgrade (higher plan or more seats) charges `chargeToday` now and the full new price at
the next renewal. Downgrade applies at the END of the period (charge 0 now; a scheduled change is stored). Adding
seats is prorated now (within included seats the charge is 0). Removing seats [DECISION] takes effect at period end
(charge 0 now). A downgrade or seat removal that would leave more members than the new plan allows is rejected
until the owner removes members.

**Required unit tests (at least 8 cases; the values below were recomputed and must be asserted exactly)**

| # | Case (P = 30) | R | Credit | Charge | Charge today |
|---|---|---|---|---|---|
| 1 | Upgrade Starter (5 seats) -> Team (9 seats), 11th of period | 20 | 1333 | 3333 | 2000 |
| 2 | Upgrade Team (15) -> Business (15) | 10 | 1666 | 4000 | 2334 |
| 3 | Add 3 seats, Team 15 -> 18 (extra seats billable) | 12 | 2000 | 2360 | 360 |
| 4 | Add 3 seats, Team 10 -> 13 (all within included) | 12 | 2000 | 2000 | 0 |
| 5 | Change on the first day, Starter -> Team | 30 | 2000 | 5000 | 3000 |
| 6 | Change in the final day, Starter -> Team | 1 | 66 | 166 | 100 |
| 7 | Two changes: (a) Starter -> Team at R=20, then (b) Team -> Business at R=10 | 20 / 10 | 1333 / 1666 | 3333 / 4000 | 2000 then 2334 (period total with the initial Starter: 6334) |
| 8 | Team 20 seats -> Business 20 seats | 15 | 3250 | 6000 | 2750 |
| 9 | Business 40 -> 45 seats (5 extra) | 7 | 2800 | 3033 | 233 |
| 10 | Downgrade Team -> Starter | any | n/a | n/a | 0 now; 2000 at next renewal |
| 11 | Remove seats Team 18 -> 15 | any | n/a | n/a | 0 now; 5000 at next renewal |

(Row 3: monthly(Team,15) = 5000, so credit = floor(5000*12/30) = 2000; monthly(Team,18) = 5900, so charge =
floor(5900*12/30) = 2360.) Also test: Starter cannot exceed 5 seats; downgrade is rejected when members exceed the
new limit.

**Interview question 4 trap** ("A Team customer adds 3 seats with 12 days left in a 30-day period"): only seats
above the 15 included are billable. Billable new seats = `max(0, after - 15) - max(0, before - 15)`. At 15 or more
seats before the change all 3 are billable: `floor(300*3*12/30)` = **360 cents**. At 12 or fewer seats before:
**0**. At 13 or 14 seats before: 1 billable seat = **120 cents**, 2 = **240 cents**. Be ready to say which case
applies and why.

**Payment flow.** Checkout through the provider in test mode [OPEN Q4]. The app never decides if payment succeeded.
The server creates the checkout with an idempotency key and a pending record; the owner pays in the hosted
checkout; the provider sends a webhook.
- **Webhook handler**: verify the signature over the RAW body before parsing (S13, exception E1, scheme from the
  provider's current docs [VERIFY]); insert the provider event ID into `webhook_events` (UNIQUE) in the same
  transaction as the job enqueue; return 200 quickly; a duplicate event ID is acknowledged and skipped.
- **Job**: re-verify the transaction with the provider's API (do not trust the payload alone), then in one
  transaction insert the ledger row, update subscription state, write an activity event and enqueue a notification.
  `rebuildFromLedger` rebuilds subscription state; a test proves it equals the stored state.
- **Failed renewal**: the renewal cron enqueues the charge attempt [OPEN Q6]. On failure status becomes `past_due`,
  grace 7 days [DECISION]; notify the owner on day 0, 3 and 6; then status `restricted` (members can still view
  shifts; no creating or editing shifts, no invites, no swap approvals) until paid.
- **Development-only provider simulator (P7).** Purpose: prove the whole payment flow (checkout, signed webhook,
  duplicate event, job re-verification, ledger, failed renewal, grace) on the owner's computer without real keys.
  It is a fake Flutterwave: a local endpoint that creates a fake checkout, and a dev-only trigger (not exposed in
  the app) that makes it POST a webhook to the REAL webhook endpoint, signed with the same scheme and the configured
  webhook secret (if that is empty in development, use a random in-memory secret shared by signer and verifier,
  never logged). It must call the same handler, signature check, deduplication and job as production, so only the
  provider is faked. It also answers the job's re-verification call. Fences: it starts only when
  `PAYMENT_SIMULATOR_ENABLED=true`; the server refuses to start if that is true while `NODE_ENV=production`; it is
  listed in `docs/SECURITY.md`; a test proves the refusal. It proves OUR code, not Flutterwave's real behaviour, so
  `docs/AUDIT-NOTES.md` must say the real test-mode flow is unverified until the owner adds test keys and runs it.
- **Never cache**: active subscription, payment status, credit balances, webhook idempotency records, seat counts
  used for limit checks.

### 8.7 Push notifications (Requirement 6)
- After sign-in the app registers its Expo push token; stored in `devices` linked to user and device. One user, many
  devices; re-registering the same device updates, never duplicates.
- Sent from a background job, never in the request (C2). Delete tokens the push service reports invalid (receipts
  handled by the `check-push-receipts` cron [VERIFY exact names in current Expo push docs]).
- Tapping a notification opens the exact screen (deep link payload with route and IDs; validate on the client; the
  server re-checks permission when the screen loads).
- Types grouped: `shift_changes`, `swaps`, `billing`; each can be turned off in settings.
- Quiet hours and time zone are enforced by the server job (8.8). Every notification also carries visible text and a
  vibration pattern (X10). Lock-screen text carries no sensitive detail: billing notices show no amounts and no names.

### 8.8 Settings (Requirement 7)
- Stored on the server in `user_settings`: quiet hours, IANA time zone, notification type toggles, language, theme.
  The server is the single source of truth.
- Each change carries a server-set `updated_at`; the most recent change wins ("write" means the moment the server
  receives it). Weakness to document (interview question 6): a user changes quiet hours on device A while offline,
  then on device B, then A reconnects; A's older edit reaches the server last, gets the newer `updated_at`, and
  overwrites B's newer choice. A fix would use per-edit version numbers or client timestamps, at the cost of
  trusting device clocks.
- Devices refetch on app open and when returning to the foreground; real-time updates are optional.
- Optimistic update with rollback (C7).
- Notification job: compute "now" in the user's time zone; inside quiet hours a non-urgent notification is DELAYED
  (BullMQ delayed job) until quiet hours end. Urgent types [DECISION]: none, except billing restriction notices.
  Tests: 02:00 user-local with quiet hours 22:00 to 06:00 is delayed to 06:00; a midnight-crossing case; the same
  server time in two different time zones.

### 8.9 Offline (feature 8)
Persist the user's upcoming shifts (query-cache persister) so they display with no network, with a visible "last
updated" time. NEVER persist tokens, billing data or other users' data beyond what the user may see. Clear the
persisted cache on log out. Query cache times are chosen and explained in `STATE.md`.

### 8.10 Lifecycle: soft delete, grace period, hard delete (D4 to D6)
- **Delete a shift**: soft; appears in the feed as removed; hard-deleted after 90 days.
- **Remove a member**: soft; seat freed at once; access ends on the next request.
- **Delete account**: user confirms with their password; status `pending_deletion`; all sessions revoked; the user
  can cancel by signing in within 30 days (the sign-in works and offers "Restore account"). The email stays reserved while the grace period runs. After 30 days the
  purge job hard-deletes the user, devices, settings and memberships, and nulls `actor_user_id` on activity events.
  An Owner cannot delete their account while owning a team: the server answers "Transfer or delete your team
  first." (ownership transfer itself is NOT in scope; deleting the team is).
- **Delete team** (Owner only): soft; members lose access at once; the subscription is cancelled at period end with
  no refund; the Owner can restore within 30 days. After 30 days the purge hard-deletes shifts, swaps, activity,
  memberships, invites and webhook events for that team, and KEEPS `ledger_entries` (append-only, financial record)
  plus a minimal anonymised `teams` tombstone (id, deleted_at) so the ledger still has a valid reference.
- Every purge is dry-run first, batched, logged to `purge_log`, and runs only from the cron job (D5).

### 8.11 Scheduled work (node-cron enqueues; BullMQ does the work; Redis lock; J2)
| Name | Schedule (UTC) | Does | Lock key |
|---|---|---|---|
| renewals-due | `0 * * * *` | enqueue a renewal job per subscription whose period has ended | `cron:renewals-due` |
| grace-reminders | `0 9 * * *` | owner notifications on day 3 and 6; set `restricted` at day 7 | `cron:grace-reminders` |
| expire-invites | `5 * * * *` | mark invites past expiry | `cron:expire-invites` |
| check-push-receipts | `*/15 * * * *` | read push receipts; delete invalid tokens [VERIFY] | `cron:push-receipts` |
| purge-tokens | `30 2 * * *` | hard-delete used or expired tokens and codes (7 days after expiry) | `cron:purge-tokens` |
| purge-idempotency | `45 2 * * *` | hard-delete idempotency keys older than 48 hours | `cron:purge-idem` |
| purge-soft-deleted | `0 3 * * *` | hard-delete past-grace accounts, teams, shifts (8.10) | `cron:purge-soft` |
| repair-user-team-index | `30 3 * * *` | find and fix mismatches between `user_team_index` and memberships | `cron:repair-index` |
Each schedule is idempotent, takes its lock with a TTL, and is listed in `docs/cron-registry.md`.

## 9. Backend standard (brief 2.2)

9.1 **Stack**: React Native + Expo; TanStack Query; Zustand; FlashList; expo-secure-store; expo-notifications;
expo-linking; Reanimated. Backend: Node.js with Hono [DECISION; Express acceptable]; Zod; PostgreSQL; Redis; BullMQ;
node-cron; nodemailer over SMTP for email (decided by the owner); Prisma [DECISION, as in earlier projects] as the query client only: one config and one generated client per database
(DB0 and DB1 have different tables), each model produced by `prisma db pull` from a database built from the SQL files in
`server/prisma/sql/`; Prisma migrations are NOT used (see 7) [VERIFY this two-client pattern in the installed version
before building on it]. BullMQ polls
Redis constantly: test on local Docker Redis first and measure command usage before relying on a hosted free tier
[VERIFY free-tier limits; OPEN Q8].
9.2 **Connection pooling**: pooled connection string or PgBouncer; explicit pool size justified with arithmetic
(instances x pool size stays under the database connection limit minus a reserve); recorded in ARCHITECTURE.md.
9.3 **Error envelope**: `{ "error": { "code": "STRING", "message": "human text", "requestId": "..." } }` and
`{ "data": ..., "meta": ... }`. 401 not authenticated, 403 authenticated but not allowed, 404 for cross-team
resources, 409 conflict, 422 validation, 429 rate limited with `Retry-After`. Messages come from the catalog.
9.4 **Read/write routing with read-your-own-writes**: `readDb` and `writeDb` per shard; after a user's write set
Redis key `ryw:<userId>` with a 5 second TTL; while it exists that user reads from the primary. Without a real
replica both URLs point to one database; say so and document what changes in production. A test proves the
routing decision.
9.5 **Sharding simulation**: two separate PostgreSQL databases; `shard = hash(team_id) mod 2` with a stable
deterministic hash defined in one place (`blake2b512`, A4); all of a team's data on one shard; global tables in the
global database; no query or transaction spans two databases. `SHARDING.md` covers: the shard key and why; how a
very large team is handled (move it to a dedicated shard via `team_directory.override_shard`); which queries became
harder (cross-team admin reports, "my teams", any join across users and teams); the cross-database foreign-key
cost (D7); the repair job and the failure mode when `user_team_index` diverges.
9.6 **Caching (cache-aside)**: cache team rosters and shift calendar ranges in Redis, TTL 60 seconds [DECISION],
explicit invalidation on any shift or membership change; cache the first page of the activity feed per team for 15
seconds with invalidation on new activity. Every cache is switchable off with one flag (`CACHE_ENABLED`) so the
"before" load test can run uncached. A "what we cache / what we never cache" table goes in ARCHITECTURE.md.
9.7 **Rate limiting**: Redis atomic increment with expiry (or a Lua script), per user and per IP, never an
in-memory object. Strict limits on sign-in, sign-up, code verification, forgot password, magic link, resend,
invites, payment initiation and any expensive endpoint. A test shows the limit holds across two server instances or
across a restart. EVERY route has a named limit (rule S14); the endpoint inventory and values are in the skill
`rowta-rate-limiting-recipes`, and the code reads them from one config file.
9.8 **Jobs**: BullMQ queues for push, webhooks, email, renewals, purges; 5 attempts with exponential backoff, then
the failed list; idempotent; every attempt logged; a small admin-only script lists failed jobs.
9.9 **Idempotency**: `Idempotency-Key` required on payment-initiating and swap-request endpoints; stored with the
result; the same key returns the stored result; the same key with a different body returns 422.
9.10 **Observability**: one structured log line per request (request ID, user ID, route, status, duration) and one per
job attempt; request ID returned in a response header; Sentry on server and app (DSN as env var);
`docs/payment-trace.md` shows how to answer "what happened to this user's payment at 3:14pm?" from logs and ledger
with a real example.
9.11 **Security (Requirement 4)**: team isolation, permissions, Zod everywhere, Redis rate limits, no secrets in the
bundle (S, A, V rules). `SECURITY.md` lists 8 threats (14).
9.12 **App-store billing note**: a README section explaining how Apple's and Google's in-app purchase rules would
affect Rowta in production (it sells a digital subscription for using the app) and what a production approach would
be. The agent MUST read the current Apple App Store Review Guidelines and Google Play payments policy and cite them
[VERIFY]; do not write it from memory. Rowta is not published to the stores for this task.

## 10. Web surface (decided Q1: yes, hosted on a Vercel link)

Why it exists: the app is a native Android app, so page titles, Open Graph tags, favicons, SEO and NVDA apply to a web
surface, not to the app itself. Build a small single-page web surface in `/web`:
- Pages: landing page (what Rowta is, a download link, privacy summary), an invite fallback page
  `/invite/:token` (opens the app or shows the build link; `noindex`), a magic-link page `/magic` (`noindex`; reads the
  token from the URL fragment and consumes it only when the user presses the button), and a privacy page.
- It is a single-page app whose public pages are pre-rendered or static so search crawlers see real content
  [VERIFY approach: static HTML with a small script versus Expo web static export].
- Requirements: W1 to W6 (title, description, keywords, canonical, Open Graph, Twitter card, favicon set, JSON-LD,
  dynamic title, sitemap, robots, semantic HTML, performance), plus all X rules, tested with NVDA.
- **Logo and icons**: the owner will supply a logo later. Until then generate ONE plain placeholder mark
  (`web/public/brand/logo.svg`, not imitating any existing brand) and build every icon from it with one script:
  favicon (ICO and SVG), Apple touch icon, 192 and 512 PNG for the web manifest, `og:image` 1200 by 630, and the
  Expo app icon and Android adaptive icon. Replacing `logo.svg` and re-running the script updates everything.
  `docs/BRANDING.md` explains how.
- **Hosting**: the owner deploys `/web` to Vercel and gets an address of the form `<project>.vercel.app`; the agent
  NEVER deploys (P1). The public address is read from one env name (for example `PUBLIC_WEB_URL`) and used for the
  canonical URL, `og:url`, sitemap and App Links file, so nothing is hard-coded.
- **Limit**: Vercel hosts the web surface. It is not suited to the API worker and cron, which need a long-running
  process (BullMQ and node-cron) [VERIFY Vercel's limits]. Backend hosting is still open (Q8).
- Interpretation note: the owner's answer to Q1 was "uses vercel link"; this section reads that as "yes, build the web
  surface and host it on a Vercel address". Correct this if it was meant differently.

## 11. Message catalog (fixed wording; keys in `app/src/i18n/en.ts`)

| Key | Text |
|---|---|
| auth.signIn.failed | Invalid email or password. |
| auth.signUp.submitted | Check your email for a code to finish creating your account. |
| auth.code.invalid | Invalid or expired code. |
| auth.forgot.submitted | If that email is registered, we have sent instructions to it. |
| auth.magic.submitted | If that email is registered, we have sent a sign-in link to it. |
| auth.link.invalid | This link is invalid or has expired. Request a new one. |
| auth.rateLimited | Too many attempts. Try again in a few minutes. |
| auth.code.hint | Enter the 6-digit code we sent to {email}. |
| auth.code.expiresIn | The code expires in 5 minutes. |
| auth.code.expired | This code has expired. Send a new code. |
| auth.code.resendIn | Send a new code in {time} |
| auth.code.resend | Send a new code |
| auth.code.resendWait | You can ask for a new code in 60 seconds. (announced once) |
| auth.ready.signUp | Enter your name, a valid email, choose your country, a password that meets the rules, and the same password again. |
| auth.ready.signIn | Enter your email and your password. |
| auth.ready.forgot | Enter a valid email address. |
| auth.ready.resetNew | Choose a password that meets the rules and enter it again to match. |
| auth.ready.code | Enter all 6 digits of the code. |
| auth.code.resendReady | You can now send a new code. (announced once) |
| auth.reset.done | Password updated. Sign in with your new password. |
| auth.password.tooShort | Use at least 8 characters. |
| auth.password.tooLong | Use 128 characters or fewer. |
| auth.password.mismatch | The two passwords do not match. |
| auth.email.invalid | Enter a valid email address. |
| auth.name.required | Enter your name. |
| auth.name.tooLong | Use 60 characters or fewer. |
| auth.magic.confirm | Sign in to Rowta |
| auth.magic.button | Sign in |
| auth.field.required | This field is required. |
| auth.deleteOwner.blocked | Transfer or delete your team first. |
| generic.error | Something went wrong. Try again. |
Never add a string that confirms or denies that an email or account exists (A5, A6).

## 12. Phases and acceptance gates (P2: full-build mode, gates in order)

A gate lists the evidence the agent must show (real command output, a real row, a real HTTP response). After each
gate: save the evidence in `docs/gates/phase-<n>.md`, draft the LEARNING-LOG entry and any ADR, update
`docs/BUILD-PROGRESS.md`, then continue to the next phase. Stop only on the stop conditions in rule P2.

- **Phase 0 Foundations.** The scaffold already exists (folders, `.env.example`, empty `.env`, `docker-compose.yml`,
  `scripts/setup-env.mjs`, README, docs skeleton); verify it and extend it, do not recreate it. Monorepo (`/app`, `/server`, `/shared`, `/docs`, `/load-tests`). `docker-compose.yml` has
  two PostgreSQL containers (global/shard 0 and shard 1, ports from `.env`), Redis and a local mail catcher; prove
  they start (the owner runs `node scripts/setup-env.mjs` first; if `.env` has empty local secrets, stop and ask the owner to run it). A BullMQ queue plus a separate worker process skeleton (one test job runs end to end), because Phase 2 sends
  emails from a job. Env validation with Zod that fails fast on missing names. Health endpoint. Request-ID middleware,
  structured logger with redaction. Shard routing function and the data-access layer skeleton with the required
  `teamId`. Migrations on both databases. Lint with floating-promise rules. Gate: health check works; the mail catcher receives a test email sent with nodemailer; `node scripts/setup-env.mjs --check` and `--audit-example` pass; both
  migrations applied; the same team ID always maps to the same shard and both shards receive teams in a seed of 1,000
  fake IDs (report the split); `.env.example` complete; no secrets; the test job runs through the worker.
- **Phase 1 Design system and app shell.** Design-system ADR (owner approves), tokens generated from `design-system/`, light theme (dark after Q9),
  component kit (6.2), i18n catalog, `AuthGate` with the view state machine and stub views, root conditional render
  with splash, size-matrix harness, accessibility lint. A placeholder logo and the icon script. Gate: component gallery screenshots in light (and dark once Q9 is decided); icons generated from the placeholder; the
  state machine moves between all views with focus moving to the heading or first input; screenshots at the
  size-matrix cases; token script reports zero stray values.
- **Phase 2 Auth (server, then views).** Sign-up with code, sign-in, refresh rotation with reuse detection, log out,
  log out of all devices, forgot and reset, magic link, rate limits, dummy-hash timing, all Zod schemas in `/shared`.
  Gate: curl or test evidence per flow; replayed refresh token revokes the family; single-use and expiry tests for
  codes and links; 429 shown; DB rows show Argon2id PHC strings and hashed tokens (mask them in the report); every
  failure message equals the catalog (grep gate); the unknown-email and wrong-password responses are byte-identical
  apart from the request ID; timing measurement recorded; invalid data sent straight to the server is rejected for
  every form; TalkBack walkthrough checklist for the auth views.
- **Phase 3 Teams, roles, invites, seat skeleton.** Gate: the permission matrix tests pass; a raw HTTP call as Staff
  to a forbidden endpoint returns 403; team isolation tests pass for every route that exists; Starter cannot invite a
  sixth seat (owner not counted, Q3); invite deep link lands in the right team.
- **Phase 4 Shifts, calendar, activity feed (and full-text search).** Gate: same-timestamp pagination test; EXPLAIN
  before and after saved; the app shows all four list states; fast scrolling produces no duplicate requests (show
  the request log); soft-deleted shifts hidden by default.
- **Phase 5 Swaps.** Gate: state-machine tests; one-pending-swap constraint test; optimistic update with a forced
  failure showing rollback and an announced error.
- **Phase 6 Jobs, cron, push, settings.** Push job on the Phase 0 worker, registration, invalid-token cleanup,
  settings API, quiet hours with time zones, toggles, the cron registry (8.11) with locks. Gate: quiet-hours tests;
  a job that fails then succeeds with growing backoff delays in the log; a job that exhausts attempts lands in the
  failed list; two worker instances run each cron once (lock proof); notification tap opens the right screen.
- **Phase 7 Billing.** Plans, proration module and all tests (8.6), checkout, webhook (signature, dedupe, job),
  ledger (an attempted UPDATE fails), seat enforcement, failed renewal and grace. Gate: all proration tests pass with
  the exact values; a duplicate webhook sent twice shows one ledger row; a forged signature is rejected;
  `rebuildFromLedger` equals stored state.
- **Phase 8 Offline and Dashboard.** Persisted upcoming shifts with a visible "last updated" time, and the Dashboard home
  screen (6.1) built from existing queries with its own loading, empty and error states. Gate: airplane-mode screenshot;
  log out clears the cache; the Dashboard shows the right data for an Owner, a Manager and a Staff user and passes
  the accessibility checklist.
- **Phase 9 Lifecycle.** Soft delete, restore, grace periods, purge job with dry run, account and team deletion
  flows. Gate: tests for each row of 7.3; a purge dry run reports counts without deleting; a real purge deletes only
  past-grace rows; ledger rows survive a team purge; account restore within grace works.
- **Phase 10 System design layers.** Pool config with justification, read/write routing and read-your-own-writes,
  Redis caches with invalidation and the `CACHE_ENABLED` flag, sharding docs. Gate: invalidation tests; routing test;
  a created team lands on the expected shard.
- **Phase 11 Web surface** (hosted by the owner on a Vercel link; the agent never deploys). Gate: Lighthouse result saved; metadata checklist (W1) passes on
  every page; NVDA walkthrough checklist; axe run clean or findings listed.
- **Phase 12 Load tests, docs, build, deploy, demo.** k6 scripts in `load-tests/`: 200 virtual users loading the
  activity feed, before and after caching, with p50, p95, p99 and error rate in a written report. Deliverables (14).
  Android development build via EAS Build [VERIFY current free-tier limits]. The owner runs the deploy.

Reality check for the owner (not an agent rule): this is a large build. Finish and verify phases in order; do not leave
later phases half-built. A smaller verified Rowta is better than a larger broken one, and `SUBMISSION.md` must say
honestly what is done.

## 13. Tests required (names the owner can point at)

permissions (every matrix row); team isolation (every route); proration (11 rows plus 2 limit tests); refresh
rotation and reuse detection; reset code single use and expiry; verification code attempts and expiry; magic link
single use and expiry; invite single use and expiry; uniform auth responses (sign-in failure bodies identical for
unknown email and wrong password; sign-up, forgot and magic identical for existing and unknown emails); no banned
phrase in app or server strings; seat limits (Starter cap, downgrade blocked); webhook signature, duplicate and
out-of-order; idempotency (same key same result, same key different body 422); cursor pagination (same-timestamp
straddle); quiet hours (midnight crossing, time zones); rate limit (across two instances or a restart); ledger
immutability (UPDATE and DELETE rejected); `rebuildFromLedger`; shard routing determinism; cache invalidation;
read-your-own-writes routing; server-side Zod rejection for every form; soft delete hidden by default; purge only
after grace; ledger survives team purge; cron lock (second instance does nothing); no floating promises (lint run);
logger redaction; accessibility checklist per screen (manual, saved in `docs/a11y/`).

## 14. Deliverables and SECURITY.md threats

Public GitHub repo (or app and backend repos linked to each other); Android development build link; deployed
backend; README (first screen: one-line description, GIF, download link, demo video link); `docs/ARCHITECTURE.md`
(with diagram), `docs/PRORATION.md`, `docs/STATE.md`, `docs/SECURITY.md`, `docs/SHARDING.md`,
`docs/LEARNING-LOG.md`, `docs/decisions/` ADRs, `docs/cron-registry.md`, `docs/ui-matrix/`, `docs/a11y/`, test
results, load-test report, a 3-minute demo video with captions and a transcript (product first, then one deep
dive), written answers to the 8 interview questions in the LEARNING-LOG, a LinkedIn post about one decision (no "excited to announce"), and a portfolio case study (problem,
constraints, architecture, three hardest decisions, results with load-test numbers, what next).
**SECURITY.md lists 8 threats and how each is handled.** Starting list: 1) stolen access token; 2) stolen or replayed
refresh token; 3) cross-team data access (IDOR); 4) privilege escalation by Staff calling Manager or Owner
endpoints; 5) forged or replayed payment webhook; 6) duplicate charge from a retried request; 7) brute force and
account enumeration on sign-in, reset and invite; 8) secrets extracted from the app bundle. Also considered:
invite-link abuse to bypass seat limits, deep-link interception, notification content on a lock screen, purge job deleting too much.

## 15. Decisions

Decided by the owner on 18 Oct 2026 (nothing blocks Phase 0 now):
- **Q1.** Web surface: yes, hosted on a Vercel link (reading explained in section 10).
- **Q2.** Search: normal text search (PostgreSQL full-text), not vector search.
- **Q3.** Seats: the owner does NOT count as a seat.
Still open or defaulted; each is needed only when its phase starts:
- **Q4** DECIDED by the owner (18 Oct 2026): Flutterwave in test mode.
- **Q5** SUPERSEDED (18 Oct 2026): the currency is the paying user's country currency (section 5). What remains is verification: which currencies the provider supports in test mode and each currency's amount unit.
- **Q12** (Phase 7) the owner supplies the price table: base and extra-seat price in minor units for each plan in each currency to be sold. Until a currency has all its prices it is not sold and its country is not offered at sign-up (no fallback currency). The agent never invents a price.
- **Q6** (Phase 7) renewal mechanism: (a) charge a saved reusable authorization automatically, or (b) email a
  renewal pay link; (a) fits "failed renewal" best if the provider supports it.
- **Q7** DECIDED by the owner (18 Oct 2026): nodemailer over SMTP. The owner supplies the SMTP login by hand in `.env`; development uses the local mail catcher.
- **Q9** (Phase 1) dark mode: the design system has no dark colour set. Options: (a) light only for v1; (b) the owner supplies dark roles; (c) the owner approves a dark mapping built only from existing colour ramps. The agent invents nothing.
- **Q10** DECIDED by the owner (18 Oct 2026): the four tokens the CSS lacked are added by a converter fix; the design system is completed from Google Material 3 (warning, success, missing roles, shape, state). Done; the agent only runs `node design-system/verifyTokens.js`.
- **Q11** (Phase 1) the owner confirms the warning and success source colours: Google Material palette Amber 500 `#ffc107` and Green 500 `#4caf50`, or supplies their own hex. Until then the generated warning and success values are used as they are in `design-system/`.
- **Q8** (Phase 12) hosting for the backend, worker and Redis. The web surface goes on Vercel, but the API worker and
  cron need a host that can run a long-lived process.
Defaults used for the single-run build, so Q4 to Q8 do not stop the agent (change by editing this list): Q4 Flutterwave
test mode (the owner has used it before); Q5 only the currencies with an owner-supplied price row are sold (Q12), the rest stay disabled and their countries are not offered; Q6 try an automatic charge on a saved authorization if the test mode supports it, otherwise an
emailed pay link; Q7 development emails go to a local mail catcher container (for example Mailpit [VERIFY image]),
real SMTP settings are env names the owner fills in later; Q8 the agent does NOT deploy: it writes `docs/DEPLOY.md`
with the options and exact steps for the owner. A development-only provider simulator (fenced by `NODE_ENV`, rule P7)
proves the payment and webhook flow locally unless the owner has put real test keys in `.env`.
Defaults already chosen (change any you disagree with): magic link as the second sign-in method; Manager invite
and remove rights limited to staff; 15-minute access token and 30-day refresh token; 7-day payment grace; cache
TTLs; shard 0 doubles as the global database; Android only; 30-day deletion grace; 90-day shift retention;
Hono and Prisma stack; `/shared` folder for Zod schemas.

## Appendix A. Owner checklist traceability (where each request is enforced)

| Owner request | Where |
|---|---|
| Argon2 for passwords and verification codes | A1, A2, A3, 7.1, 8.1 |
| Never SHA-256 | A4, skill rowta-gate-checks (grep gate) |
| "Invalid email or password", no hints | A5, A6, 8.1, 11 |
| Form validation: Zod, client and server, server-side functions | V1 to V8, 8.1, 13 |
| Sync and async handled properly | C1 to C11 |
| Beautiful UI | U5, U6, 6.2 |
| Semantic text search | 8.4 (decided: full-text) |
| SEO, OG tags, page title, description, keywords, favicon, dynamic title | W1 to W6, 10 (decided: yes) |
| NVDA, accessibility for blind, deaf, speech-impaired | X1 to X14 |
| Single-page architecture; auth as a view | U1, U2, 10 |
| Auto focus | U7 |
| Mobile responsiveness on all screens | U9, 6.3 |
| aria-label, state management and ARIA state | X1, X2, U4 |
| Zero reload state | U3 |
| Forgot password helps the user back in | A10, 8.1 |
| node-cron where needed | J2, 8.11 |
| Soft delete, hard delete, grace period | D4 to D6, 7.3, 8.10 |
| Password minimum eight | A8, 11 |
