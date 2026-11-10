> **DRAFT — not legal advice.** Review by a qualified lawyer before launch.

# Subprocessors

Draft written 20 October 2026. Rowta is not launched yet. This page lists the outside companies that touch user data — or will — each with its status: **active** means it runs in the code today, **planned** means the code names it but the feature has not shipped. No company receives user data from Rowta today except what happens during local testing on the operator's own machine.

## Current and planned subprocessors

| Subprocessor | Purpose | Data it sees | Status |
|---|---|---|---|
| Vercel | Hosting this static website | The pages you request (no accounts, no forms on this site) | Planned — the owner will deploy the site there; not deployed yet |
| Flutterwave (payment provider) | Card checkout and payment webhooks | Payment details are typed on their checkout page; Rowta keeps plan, seats, amount, currency and a payment reference | Planned — the environment names it (`PAYMENT_PROVIDER=flutterwave`) in test mode; the integration ships in a later phase |
| SMTP provider (chosen by the owner) | Sending sign-in codes, links, invites and notices | Your email address and the message we send | Active in code (nodemailer in `server/package.json`); the provider itself is [OWNER: choose before launch]; development uses a local mail catcher that sends nothing |
| Expo push service | Delivering push notifications | Push token, notification text and routing data | Planned — the app includes push registration; sending ships in a later phase |
| PostgreSQL and Redis hosts | Storing product data, queues and rate-limit counters | All Rowta product data | Active on the operator's own machine (local containers); the production host is undecided |
| Sentry (error tracking) | Not in use — no error-tracking software is installed; adding it is an owner decision before launch | Not applicable |

## What Rowta does not use

No advertising networks, no analytics services, no session recording, no social media widgets, no font or script CDNs. The website loads only its own files. This list is checked against the repository's dependency lists, not from memory.

## Changes to this list

If Rowta starts using a new outside company for user data, this page is updated before or at the same time as the change.

## Questions

Email [rowtareply@gmail.com](mailto:rowtareply@gmail.com).
