# Play (Google Play) data-safety — working notes for the owner's submission

Status: **DRAFT — the owner fills and submits the Play Console forms.** Every answer below is derived from the
PRD and the repository, marked with its source. Nothing here is a claim to the store until the owner verifies it
against the current Play data-safety form and the Google Play Data disclosure (requirements change; check the
console at submission time). The agent never submits anything (P1).

## 1. What Rowta collects and processes (per PRD — Phase 2+ features are PLANNED)

| Data | Play category (working) | Purpose | Collected / processed | Shared | Status |
|---|---|---|---|---|---|
| Email address | Personal info → Email | Sign in, account, notices | Collected, sent to server | Processed by the email provider (nodemailer over SMTP) | PLANNED (auth, Phase 2) |
| Name (display name) | Personal info → Name | Shown to teammates instead of email | Collected, stored | No | PLANNED (PRD 7.1, owner decision 18 Oct 2026) |
| Account credentials (password) | Account info | Sign in | Collected; stored only as Argon2id hash | No (never readable) | PLANNED (rule A1) |
| Team, role, membership | Account info | Roles and permissions | Collected, stored | No | PLANNED |
| Shifts, swap requests, activity (roster content) | App functionality | The product itself | Collected, stored | No | PLANNED |
| Push notification token | Device IDs (other) | Send shift/swap notifications | Collected (Expo push) | Processed by the push provider | PLANNED |
| Payment details (card etc.) | Financial info | Paid plans | Processed by Flutterwave; the app is designed to store no card data (PRD 8.6) | Third-party payment provider | PLANNED (Phase 7) |
| IP address / country chosen at sign-up | — | Country only ever from the sign-up answer, never from IP (owner decision 18 Oct 2026) | No location data collected | No | design rule |
| Website analytics / ads | — | **None.** No analytics, no ads, no third-party scripts (PRD 10, `web/dist` link test) | Not collected | Not shared | ACTIVE for the website |

Device permissions: notification permission only (PRD 8.7). No location, contacts, camera, microphone or photos
in the PRD — re-check at submission against the built app.

## 2. Deletion (Play asks for an account-deletion path)

- App: Settings → delete account → confirmation → 30-day grace → hard delete by the purge job (PRD 7.3, 8.10;
  PLANNED — not built yet).
- Web: `/delete-account/` states the same flow and the email route (rowtareply@gmail.com).
- At submission, give Play the public deletion URL (the deployed `/delete-account/` page) and verify the in-app
  path works end to end.

## 3. Encryption statements (Play has checkboxes — do not tick blindly)

- In transit: production hosting is undecided (PRD 15 Q8); HTTPS comes from the final host. **NOT VERIFIED —
  tick only after the production URL serves TLS.**
- At rest: the databases run with the defaults of the chosen host. **NOT VERIFIED.**

## 4. Before submitting (owner checklist)

1. Verify every PLANNED row above against what actually ships (re-run this comparison at Phase 12).
2. Check current Play data-safety requirements and the account-deletion policy text.
3. Tick encryption boxes only with evidence from the production environment.
4. Publish the privacy policy URL (deployed `/privacy/`, after lawyer review removes the DRAFT banner).
5. Account for every app permission actually requested in the final manifest (notifications).
