---
name: rowta-privacy-recipes
description: "Use when a Rowta feature stores, logs, sends, shows or deletes personal data: data inventory, retention and deletion, log and error-report redaction, notification and email content, third-party processors, and the public privacy page text."
---

# rowta-privacy-recipes

Part of the Rowta method. Scope: Rules D9, D4 to D6, S9, S10, P6, X10; PRD 7, 7.3, 8.7, 8.10, 10. Legal points are [VERIFY]; this is engineering guidance, not legal advice.
Code here is a PATTERN: check every library call against current documentation [VERIFY] before using it, and never paste real secrets (rule S1).

## 1. Principles
Store only what a feature needs (D9). Every personal field has a purpose, a retention rule (PRD 7.3) and a deletion path. The ledger holds no personal data on purpose. Seeds, tests, fixtures and screenshots use fake data only (P6).

## 2. Data inventory (keep `docs/PRIVACY.md` in sync with the real schema)
| Data | Where | Purpose | Retention / deletion |
|---|---|---|---|
| Email | users, invites, pending_signups | sign-in, invites, codes | account purge after 30-day grace; pending rows purged after expiry |
| Password hash, code hashes | users, pending_signups, password_resets | authentication | deleted with the account / 7 days after expiry |
| Push tokens, device id, platform | devices | notifications | deleted at log out of all devices, account purge, invalid-token cleanup |
| Settings (quiet hours, time zone, language, theme) | user_settings | behaviour | account purge |
| Shifts, swaps, activity, memberships | team tables | the product | team purge; shifts 90 days after soft delete |
| Ledger entries | ledger_entries | financial record | never deleted; no personal data inside |
Check this table against the real migrations before marking `docs/PRIVACY.md` written.
DECIDED (owner, 18 Oct 2026): a display name is collected on the sign-up form and stored as `users.display_name` (PRD 7.1, rule V8). Teammates see the name, never the full email. It is personal data: list it in the inventory, delete it with the account, never copy it into activity text, logs, push titles or email subjects (store the user ID and join the name when showing). DECIDED (owner, 18 Oct 2026): the sign-up form also collects the user's country (`users.country`), which sets the payment currency (PRD 5). It is personal data: list it in the inventory, delete it with the account, never log it with an identifier, never derive it from the IP address. Also list `sent_emails` (user ID, kind, reference, time; no body; deleted with the account).

## 3. Logs, errors, reports (S9, S10)
- The logger redacts passwords, codes, tokens, secrets, authorization headers and full auth-route bodies; a test proves it. Log user IDs, not emails; if an email is unavoidable, log a masked form.
- Error-reporting (Sentry): turn off default PII capture, scrub request bodies and headers in the `beforeSend` hook, and test that a thrown error from the sign-in route carries no email or password [VERIFY the SDK options]. The public DSN is not a secret but events can carry data.
- No analytics or tracking SDK is in the PRD: do not add one (P10).

## 4. Messages that leave the system
- Push (8.7): lock-screen text carries no sensitive detail; billing notices show no amounts and no names. Payload carries route and IDs only; the server re-checks permission when the screen opens.
- Email: neutral subjects (no codes, no names in the subject). Codes and links only in the body. The "someone tried to sign up" email to an existing account says nothing about the account.
- Deep links carry single-use short-lived tokens; web token pages are `noindex` and send no referrer (W2).

## 5. Deletion (8.10)
Soft first, purge after the grace period, in the purge job only. Account purge removes the user, devices, settings and memberships and nulls `actor_user_id` on activity events. Team purge removes team data but KEEPS ledger rows and a minimal tombstone team row. Test each row of the lifecycle table.

## 6. Third parties (processors)
List in `docs/SECURITY.md`: which provider receives which data. Expected set: Expo push service (push token, notification text), Flutterwave (the payer's checkout details, entered on the provider's page, not ours), the SMTP provider (recipient email, message), Sentry (scrubbed error events), the hosting providers. Only list what is really integrated.

## 7. Privacy page on /web (PRD 10)
Draft plain-language text from section 2 and 6 only: what is collected, why, who receives it, how long it is kept, how to delete the account (in the app), and a contact placeholder for the owner. Do not claim anything that is not built or verified (for example do not promise a data export: it is not in the PRD). Mark the page "draft for owner and legal review" in `docs/AUDIT-NOTES.md`.

## 8. Legal pointers [VERIFY]
Rowta's first market is Nigeria. The Nigeria Data Protection Act 2023 applies to this kind of processing; one law-firm article reports that a reportable breach must be notified to the Nigeria Data Protection Commission within 72 hours (s. 40(2)). Data-subject rights, lawful bases and privacy-notice contents were NOT checked: the owner should read the Act or ask a lawyer before launch. Put a short incident-response note in `docs/SECURITY.md`: who decides, how to rotate secrets, how to record a breach.

## 9. Per-phase checklist
- [ ] New personal field? Added to the inventory with purpose and retention.
- [ ] New log line or error path? No personal data, redaction test still passes.
- [ ] New notification or email? Text reviewed for lock-screen and subject leaks.
- [ ] New third-party call? Added to the processors list.
- [ ] Delete path tested.
