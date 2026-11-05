> **DRAFT — not legal advice.** Review by a qualified lawyer before launch.

# Data Retention

Draft written 20 October 2026. This table is Rowta's written plan. Rowta is not launched yet: rows marked **planned** are rules the software will enforce when that part ships, and rows marked **active** are already true. The repository's `docs/legal/CLAIMS-EVIDENCE.md` records the evidence behind each row. [OWNER: add a public link to it once the repository is hosted]

## The table

| Data | Purpose | How long | Deletion trigger | Status |
|---|---|---|---|---|
| Account: email, display name, country, settings | Sign-in and preferences | Kept until deletion, then a 30-day grace period, then hard delete | Delete request + scheduled purge job | Planned |
| Password hash | Sign-in (when password sign-in ships) | Deleted with the account | Account purge | Planned |
| Sign-in codes and links (including magic links) | Signing in | Links expire after 5 minutes (owner decision); purged 7 days after expiry | Used, expired + purge job | Planned |
| Push tokens and devices | Delivering notifications | Until you sign out of all devices, an invalid-token cleanup, or account purge | Logout-all, cleanup job, account purge | Planned |
| Notification log and push tickets | Delivery records | 30 days (proposed in the product plan, not final) | Scheduled purge | Planned |
| Shifts | Your schedule | Kept for 90 days after being soft-deleted, then hard deleted | Scheduled purge | Planned |
| Teams | Your team | After team deletion: 30 days to restore, then hard delete (ledger kept) | Scheduled purge | Planned |
| Memberships | Team membership | Soft-removed and kept with the team until the team is purged | Team purge | Planned |
| Activity events | Team history | Kept with the team; your user reference is cleared when your account is purged | Account purge / team purge | Planned |
| Financial ledger entries | Financial record of what was paid | Never deleted | None — append-only, and it contains no personal data | Active schema in the repository; no payments taken yet |
| Idempotency keys | Stopping duplicate payments | 48 hours | Scheduled purge | Planned |
| Payment intents | Payment records | Until a tax adviser sets the period ([OWNER DECISION: set it]) | Not purged automatically today | Planned; retention open |
| Records of emails we sent | Showing what we told you | Deleted with your account | Account purge | Planned |
| This website | Serving pages | Stores nothing about you: no cookies, no browser storage, no analytics | Nothing to delete | Active — verified by the site's own build and tests |

## How deletion happens

Deletion is soft first, hard later. A request marks data for deletion right away (sessions end, access stops), and a scheduled job hard-deletes it after the grace period, in batches, with a dry run first and a purge log. This two-step design is in the product plan; the scheduled jobs ship in a later phase.

## Questions

Email [rowtareply@gmail.com](mailto:rowtareply@gmail.com). See the [Privacy policy](/privacy/) and [Delete your account](/delete-account/).
