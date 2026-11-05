> **DRAFT — not legal advice.** Review by a qualified lawyer before launch.

# Owner inputs and open owner decisions (Phase 11 web surface)

Everything below is recorded, never invented. Items are listed as what they are: inputs the owner gave on
20 Oct 2026, decisions still open, and placeholders that appear verbatim in the public pages. Nothing on this
page may be pasted into a public page as a statement.

## Owner inputs given on 20 Oct 2026 (applied as given)

1. Operator: no registered company; Rowta is operated by an individual. The legal name line stays
   "[OWNER: full legal name or 'an individual operator']" until the owner decides. No personal name appears in
   any legal page.
2. Contact email for privacy, deletion, legal and security requests: rowtareply@gmail.com — the only contact
   channel, used on /contact, /privacy, /terms, /delete-account and security.txt.
3. Address: none — "use email only" everywhere; no postal address added. **Note for a later owner check: some
   laws may expect a postal contact address for certain regions.**
4. Governing law: Nigeria; courts of [OWNER: city to be chosen]; with the standard note that mandatory consumer
   and data-protection rights of users in their own countries are not reduced.
5. Minimum age: 16 — stated in the Terms and the privacy policy; no marketing to children.
6. Breach handling: internal incident note written in docs/legal (see incident-response.md). The 72-hour
   breach-notification expectation under Nigerian law is recorded as reported by commentary and is
   NOT VERIFIED against the NDPC text.
7. Magic-link lifetime mismatch: the PRD and rule A13 say the link expires in **15 minutes**; the owner wants
   **5 minutes**. The PRD was NOT edited. The web copy (data-retention table) uses the owner's **5 minutes**,
   status PLANNED in CLAIMS-EVIDENCE.md. Resolution of the mismatch is an owner decision touching the PRD —
   do not change the PRD silently.
8. Platform wording: "the Rowta app" everywhere except the download button ("Get the Android app") and factual
   Android references.

## Owner to-dos (NONE claimed as done)

1. **Check the NDPC website** for the current rules under the Nigeria Data Protection Act 2023 and the NDPC 2025
   directive (GAID): major-importance criteria and tiers, registration and fees, data protection officer duties,
   and compliance returns. Status: thresholds, fees and any small-operator exemption are **NOT VERIFIED**.
2. **Decide whether a company will be registered later.**
3. **Use a dedicated support email instead of a personal Gmail address before launch.**
4. **Lawyer review before real paying customers.**

## Placeholders that appear verbatim in the public pages (L3)

There are 25 `[OWNER: ...]` markers across docs/legal; the public pages render them under the DRAFT banner.
The main ones:

- [OWNER: full legal name or 'an individual operator'] — Terms, Contact.
- [OWNER: city to be chosen] — governing courts, Terms.
- [OWNER: in-app notice method — not built yet] — change notices in Privacy and Terms.
- [OWNER DECISION: confirm this acceptance rule with your lawyer] — Terms acceptance.
- [OWNER: hosting location(s), not decided until the backend host is chosen] — Privacy international transfers
  (one per region section).
- [OWNER: add the authority name per launch market ...], [OWNER: confirm the current NDPC complaint and contact
  process before launch], [OWNER: confirm per launch state], [OWNER: confirm per launch market] — complaint
  routes in the four region notices.
- [OWNER: response-time promise — not set; do not promise one until you can keep it] — Contact, Delete account.
- [OWNER: choose before launch] — SMTP provider (Subprocessors).
- [OWNER DECISION: set it] — payment-record retention (Data retention, Delete account).
- [OWNER DECISION: refund policy ...] — Billing terms.
- [OWNER: confirm whether your launch sells through the stores or on the web] — Billing terms.
- [OWNER DECISION: confirm the cap wording with a lawyer ...] — Terms liability limit.
- [OWNER DECISION: define with your lawyer] — suspension/termination terms.
- [OWNER: decide whether to state a WCAG level after an audit] — Accessibility.
- [OWNER: add a public link to it once the repository is hosted] — Data retention (CLAIMS-EVIDENCE link).

Cosmetic decision recorded (no owner input needed, flagged for review): Open Graph locale is `en_US`;
change it if the launch market prefers another locale.

## Environment names the owner sets (values never written by the agent)

- `PUBLIC_WEB_URL` — required; the public address used for canonical URLs, og:url, sitemap and robots.
- `PUBLIC_ANDROID_DOWNLOAD_URL` — optional; the build link behind "Get the Android app". Empty hides the
  button and shows "Download link coming soon".
- `WEB_DRAFT_BANNER` — default **off**: the owner removed the DRAFT banner from the public pages (decision of
  20 Oct 2026). Set to `on` only to show it again. The files in `docs/legal/` keep their banner line (L1); lawyer
  review before real paying customers remains an open to-do below.
- security.txt `Expires` is set to 2027-10-20 at build time; refresh it at least yearly.

## Later tasks recorded in this task (not built now)

- Server task: record which terms version each user accepted and when (terms-acceptance table — Phase 2+).
- Web task: drive which region notice is shown from the country chosen at sign-up (structure prepared with
  `data-region` attributes; not built).
- Web task: `/.well-known/assetlinks.json` (needs the EAS signing fingerprint) and the matching
  `apple-app-site-association` file for iOS — placeholders noted in docs/DEPLOY.md; no fake identifiers created.
- Owner decision: resolve the 15-minute vs 5-minute magic-link mismatch in one place (PRD or owner input).
