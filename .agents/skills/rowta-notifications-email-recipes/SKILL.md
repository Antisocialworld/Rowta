---
name: rowta-notifications-email-recipes
description: "Use when building Rowta push notifications or email: Expo push registration and sending, receipts and invalid-token cleanup, notification deep links, notification content rules, and sending email with nodemailer over SMTP from background jobs (codes, magic links, invites)."
---

# rowta-notifications-email-recipes

Part of the Rowta method. Scope: PRD 8.7, 8.1, 8.8, 8.11; rules A9, A13, C2, C10, J1, J4, X10. Library calls are [VERIFY].
Code here is a PATTERN: check every library call against current documentation [VERIFY] before using it, and never paste real secrets (rule S1).

## 1. Push registration (app)
After sign-in, ask permission, get the Expo push token, send it to the server with a stable device id. The server upserts on (user, device) so re-registering updates, never duplicates (D2). Handle "permission denied" with a designed state and a visible explanation: the app still works, in-app text covers the gap (X10). [VERIFY expo-notifications calls and Android channel setup in current docs.]

## 2. Sending (server, never in a request: C2)
- A `push` BullMQ job receives { userId, type, route, ids }, loads the user's devices and settings, applies type toggles and quiet hours (recipe 3.14, delayed job: J4), then calls the Expo push API in batches with a timeout and backoff [VERIFY batch limits].
- Payload: short visible title and body, a vibration pattern, and data { route, ids } only. No amounts, no names of other people, no secrets. Billing notices are generic.
- Job payloads hold IDs, never secrets (J3). Jobs are idempotent: a `jobId` built from event and recipient collapses duplicates.

## 3. Receipts and cleanup
The `check-push-receipts` cron (PRD 8.11) enqueues a job that reads receipts and deletes tokens the service reports as invalid [VERIFY exact receipt fields]. Log counts, not tokens.

## 4. Tap handling (app)
Validate the route and IDs from the notification against an allowlist of known routes before navigating. The screen then loads through the normal API, which re-checks permission (S5). Unknown payloads open the Dashboard.

## 5. Email with nodemailer (server, job only)
- One module `server/src/mail/transport.ts` builds the transporter from env NAMES (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`). Empty user and password is valid in development (Mailpit). Set connection and send timeouts [VERIFY option names].
- All email goes through an `email` BullMQ queue: 5 attempts, exponential backoff (J1). A request only enqueues (C2). The job payload carries the template name, recipient and the minimum data, never a stored raw secret: for codes and links the job generates the code or token, hashes it (A2, A3), stores the hash, and sends the raw value only in the message.
- Templates: plain-text and HTML parts, neutral subjects, no secrets in logs. Templates needed: sign-up code, existing-account notice ("someone tried to sign up", changes nothing), reset code, magic link, invite, billing notices.
- Uniform behaviour (A6): the request path takes the same time and returns the same answer whether or not an email is sent; the job decides.
- Development: Mailpit catches everything. A test sends a message through the real transporter and reads it back from the catcher's HTTP API [VERIFY Mailpit API path] to prove delivery without printing the message body in logs.

## 6. Mistakes to avoid
Sending inside the request; a token in a log line or job payload; different response timing for known and unknown emails; a notification that exposes billing amounts; navigating to a route taken straight from the payload.

## 7. Email texts (final wording; edit only with the owner)
Rules for every email: plain-text part first, HTML part carries the same words; neutral subjects that NEVER contain a code, token or amount; code shown as plain digits with no spaces; never ask the reader to share a code or password; no tracking pixels; no secret in any log line; the greeting line is `{{greeting}}` = "Hi <displayName>," when the sign-up form gave a name and "Hi," when it did not; the name is plain text with line breaks removed, HTML-escaped in the HTML part, and NEVER in a subject (rule V8). Footer on all: "This is an automated message. Please do not reply." Links are https links built from `PUBLIC_WEB_URL`; a custom-scheme link such as `rowta://` is not reliably tappable in email apps, so every email links to a web page that opens the app (`/` landing, `/invite/<token>`), see `rowta-web-metadata`. Values in {{braces}} are filled by the job; minutes come from the shared constants.

### 7.1 Sign-up verification code
Subject: Your Rowta verification code
```
{{greeting}}

Your Rowta verification code is:

{{code}}

This code expires in 5 minutes. Enter it in the app to finish creating your account.

You can ask for a new code after 60 seconds if this one runs out.

If you did not try to create a Rowta account, you can ignore this email. No account will be created.

Rowta will never ask you for this code or your password by phone, chat or email. Do not share it with anyone.

The Rowta team
```
### 7.2 Password reset code
Subject: Your Rowta password reset code
```
{{greeting}}

Use this code to reset your Rowta password:

{{code}}

This code expires in 5 minutes. You can ask for a new code after 60 seconds.

If you did not ask to reset your password, you can ignore this email. Your password has not changed.

Rowta will never ask you for this code or your password by phone, chat or email.

The Rowta team
```
### 7.3 Welcome (sent ONCE, after the account is created)
Subject: Welcome to Rowta
```
{{greeting}}

Welcome to Rowta. Your account is ready.

To get started:
1. Create your team, or accept an invitation if someone invited you.
2. Add your shifts to the calendar.
3. Turn on notifications so you hear about shift changes and swap requests.

Open Rowta: {{webLink}}

Good to know:
- Sign in with your email and password, or ask for a sign-in link by email.
- If you forget your password, choose "Forgot password" on the sign-in screen. We will send a 6-digit code to this address. It expires in 5 minutes.
- Rowta will never ask for your password or a code by phone, chat or email.

If you did not create this account, open the app and choose "Forgot password" to take control of it.

The Rowta team
```
Send-once guard (C4) [DECISION, accepted by the owner; record in an ADR]: the table `sent_emails` (PRD 7.1) with UNIQUE (user_id, kind, ref), `ref` an empty string for the welcome email and the ledger entry ID for receipts; the job inserts first and sends only if the insert won. A job ID alone is not enough, because an ID can be reused after its job is removed.
### 7.4 Someone tried to sign up with an existing account's email (changes nothing)
Subject: A sign-up was attempted with your email
```
{{greeting}}

Someone tried to create a Rowta account with this email address, but an account already exists.

If it was you, sign in, or choose "Forgot password" on the sign-in screen if you cannot remember your password.

If it was not you, you can ignore this email. Nothing has changed.

The Rowta team
```
### 7.5 Magic sign-in link
Subject: Your Rowta sign-in link
```
{{greeting}}

Use this link to sign in to Rowta. Open it, then press the "Sign in" button:

{{magicLink}}

The link expires in 15 minutes and works once. If you did not ask for it, you can ignore this email.

Rowta will never ask you for your password or a code by phone, chat or email. Do not forward this email: anyone who has the link can sign in as you until it expires or is used.

The Rowta team
```
`{{magicLink}}` = `PUBLIC_WEB_URL` + `/magic#` + the token (owner decision: https link, token in the fragment, see `rowta-auth-recipes` 3.20). Never use `rowta://` in the email. The link only opens a page with a "Sign in" button; it does not sign anyone in by itself.
### 7.6 Team invitation
Subject: You have been invited to a team on Rowta
```
{{greeting}}

You have been invited to join a team on Rowta as {{role}}.

Accept the invitation: {{inviteLink}}

The invitation expires in 7 days and can be used once. If you were not expecting it, you can ignore this email.

The Rowta team
```
(The team name appears only if the PRD allows it; do not add the inviter's email or any other personal data.)
### 7.7 Billing notices (to the team Owner only; no amounts, no card details)
Payment failed, day 0. Subject: Your Rowta payment did not go through
```
{{greeting}}

We could not take the latest payment for your team's Rowta plan.

You have 7 days to fix it. Until then everything keeps working. Open Billing in the app to update your payment and try again.

If nothing changes, your team will switch to view-only after 7 days.

The Rowta team
```
Reminder, days 3 and 6. Subject: Your Rowta payment still needs attention
```
{{greeting}}

Your team's Rowta payment has still not gone through. {{daysLeft}} days are left before your team switches to view-only.

Open Billing in the app to fix it.

The Rowta team
```
Restricted. Subject: Your Rowta team is now view-only
```
{{greeting}}

Your team's payment did not go through in time, so your team is now view-only. Members can still see shifts. Creating or editing shifts, sending invitations and approving swaps are paused.

Open Billing in the app to pay. Everything is restored as soon as the payment succeeds.

The Rowta team
```
Recovered. Subject: Your Rowta payment went through
```
{{greeting}}

Thank you. Your team's payment went through and everything is working again.

The Rowta team
```
### 7.7b Subscription notices (to the team Owner only)
Needed because money moves or will move. Receipts show an amount (it is the owner's own bill, in their own inbox); the failure and grace notices above do not. Amounts are integers in the currency's smallest unit (cents, kobo, ...) and are formatted for display by one helper using the currency code stored with the ledger entry or subscription, in the user's language. Never include a card number, a provider reference in full (mask all but the last 4 characters) or a payment link that signs anyone in. Title them "payment receipt" and NEVER "invoice" or "tax invoice"; the receipt carries the line "This is a payment receipt, not a tax invoice." Tax rules are not verified and are collected in `docs/TAX-NOTES.md`; a Nigerian tax adviser must confirm them before real money is taken. Each is sent by a job once per ledger event (UNIQUE on user, kind and ledger row, same guard as 7.3).
Payment received (after a renewal, upgrade or added seats). Subject: Your Rowta payment receipt
```
{{greeting}}

Thank you. We received your payment for your team's Rowta plan.

Plan: {{plan}}
Seats: {{seats}}
Amount paid: {{amount}}
Date: {{date}}
Reference: {{maskedReference}}
Your plan renews on {{renewalDate}}.

This is a payment receipt, not a tax invoice.

You can see all payments in Billing in the app.

The Rowta team
```
Plan or seats changed, effective now (upgrade or added seats). Subject: Your Rowta plan was updated
```
{{greeting}}

Your team's plan was updated.

Plan: {{plan}}
Seats: {{seats}}
Charged today: {{chargeToday}} (the part of this billing period that is left)
From your next renewal on {{renewalDate}}: {{newRecurringAmount}}

The Rowta team
```
Downgrade or fewer seats, scheduled for the end of the period. Subject: Your Rowta plan change is scheduled
```
{{greeting}}

Your team's plan change is scheduled. Nothing changes until {{renewalDate}}.

Now: {{plan}}, {{seats}} seats
From {{renewalDate}}: {{newPlan}}, {{newSeats}} seats ({{newRecurringAmount}} per period)

You can cancel this change in Billing before that date.

The Rowta team
```
Team deletion scheduled (subscription ends at the period end, PRD 8.10). Subject: Your Rowta team will be deleted
```
{{greeting}}

You asked to delete your team. Members have lost access. Your subscription ends on {{periodEnd}} and you will not be charged again.

Your team data is kept until {{purgeDate}}. To keep your team, open the app before then and restore it.

If you did not ask for this, restore the team now and change your password.

The Rowta team
```
Upcoming renewal reminder: NOT drafted on purpose. Send it only if the owner chooses renewal method (b) in PRD Q6 (a pay link by email); with automatic charging (a) it is not needed.
### 7.8 Tests for emails (add to the email job tests)
Each template: the subject contains no digits from the code; the body contains the expiry minutes taken from the shared constant; the plain-text part exists; no raw secret appears in the logs; the welcome email is sent once even if the job runs twice (UNIQUE guard); the existing-account notice is sent only to the address that tried to sign up and the HTTP response is identical to a normal sign-up (A6).
### 7.9 Sending domain (owner action)
With a real SMTP provider the sending domain needs SPF, DKIM and DMARC records or the messages may land in spam [VERIFY the provider's current instructions]. The agent cannot set these; they go on `docs/OWNER-CHECKLIST.md`. Mailpit (development) does not need them.
