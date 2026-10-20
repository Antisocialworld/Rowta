> **DRAFT — not legal advice.** Review by a qualified lawyer before launch.

# Privacy Policy

Draft written 20 October 2026. This policy is a draft until a qualified lawyer reviews it.

## In short

<div class="summary-block">

- **We collect only what the app needs** — your email, your display name, your country, and the team data you create. [Read what we collect](#what-we-collect).
- **We do not sell your data, run ads, or load tracking scripts.** [Read who receives your data](#who-receives-your-data).
- **You can delete your account** in the app or by email, and we finish the job after a 30-day grace period. [Read how deletion works](#deleting-your-account).
- **Notifications respect your quiet hours**, and we store a push token only to deliver them. [Read about notifications](#notifications).
- **Questions?** Email [rowtareply@gmail.com](mailto:rowtareply@gmail.com). [Read how to reach us](#contact-and-questions).

</div>

## Who runs Rowta

Rowta is operated by an individual. The legal name line appears in our [Terms of Service](/terms/). The only contact channel is email: [rowtareply@gmail.com](mailto:rowtareply@gmail.com). There is no postal address.

## What we collect

Rowta is a shift-scheduling app. We collect only what the service needs:

- **Email address** — to sign you in, send sign-in codes and links, and deliver team invites.
- **Display name** — your teammates see this name instead of your email. It is shown on shifts and activity.
- **Country** — chosen by you at sign-up. It decides the currency you pay in. We never guess it from your IP address.
- **Password** — only if you choose password sign-in. It is stored as a one-way hash (Argon2id), never as readable text.
- **Your team's content** — teams, memberships, shifts, swaps, settings and activity entries you and your team create.
- **Notification settings** — quiet hours, time zone, language and theme, so notifications behave the way you set them.
- **Push token, device and platform** — to send push notifications to your devices. You can sign out of all devices, which removes them.
- **Payment records** — plan, seats, amount, currency and a payment reference. Card details are typed on the payment provider's own page and never reach Rowta. The financial ledger contains no personal details.
- **Records of emails we sent you** — who received which kind of message and when. We do not keep the message body in that record.

## What this website collects

Nothing. This website sets no cookies, stores nothing in your browser (no localStorage), loads no third-party scripts, and has no analytics or advertising. We do not need a cookie banner because there is nothing to consent to. The one small script on this site only announces the page title to screen readers; it stores nothing.

## Why we use your data

- To run the service: sign-in, teams, shifts, swaps and settings.
- To send what you asked for: sign-in codes, invites, and notifications you enabled.
- To take payments and keep a financial record.
- To keep the service safe and fix problems: we redact passwords, codes and tokens from our logs.

## Who receives your data

We do not sell, rent or share your data for money, and we run no ads. The outside companies that handle data for us are listed on our [Subprocessors page](/subprocessors/) with what each one does. Teammates inside your team see your display name and the shifts you share with them — not your email address.

## How long we keep it

Each kind of data has its own rule: account data lives until you delete the account plus a 30-day grace period, soft-deleted shifts are purged after 90 days, sign-in codes and links are purged 7 days after they expire, and financial ledger entries are never deleted because they contain no personal data. The full table is on our [Data retention page](/data-retention/).

## Deleting your account

You can delete your account in the app or by email. Deletion is not instant: your account enters a 30-day grace period, during which signing in offers to restore it. After 30 days a scheduled job hard-deletes your data. Full details are on our [Delete your account page](/delete-account/).

## Notifications

If you enable push notifications, we store a push token for each device to deliver them. Notification text is kept short and carries no sensitive detail; billing messages show no amounts and no names on your lock screen. Quiet hours delay messages until your morning. Invalid tokens are removed automatically.

## Security

No system is perfect, and we say so plainly: we redact passwords, codes and tokens from logs (code: `server/src/lib/logger.ts`, test: `server/tests/redaction.test.ts`), accounts use one-way password hashing (Argon2id) when the sign-in service ships, and web pages never contain secrets. Transmission security depends on the hosting the owner chooses, which is not decided yet. If you find a problem, email [rowtareply@gmail.com](mailto:rowtareply@gmail.com) and we will respond.

## If you are under 16

Rowta is for people aged 16 or older. We do not market to children and this website collects no age information. If you believe a child under 16 has an account, email us and we will delete it.

## Your rights and region notes

Data-protection law depends on where you live. The notes below are plain-language summaries of the laws by name — they are not quotes and they are not legal advice. Each claim is tagged **verify current text** because the exact wording must be checked before launch. To exercise any right, email [rowtareply@gmail.com](mailto:rowtareply@gmail.com) — email is the only channel.

<section class="region-note" data-region="eu">

### European Union and the United Kingdom — verify current text

- **Laws by name:** the General Data Protection Regulation (GDPR) and the UK GDPR.
- **Rights you may have:** see a copy of your data; fix it; delete it; limit how it is used; receive it in a portable form; object to some uses; withdraw consent where processing is based on consent.
- **Lawful bases we rely on:** performing our contract with you (running the service); legitimate interests (keeping the service safe, understanding failures from scrubbed error reports); your consent (push notifications, which your device also asks for); legal obligation (financial records we must keep).
- **How to exercise them:** email [rowtareply@gmail.com](mailto:rowtareply@gmail.com). We reply in the same channel.
- **International transfers:** Rowta is run from Nigeria. Where your data is stored is [OWNER: hosting location(s), not decided until the backend host is chosen] — verify current text on transfer rules before launch.
- **Complaint route:** you can complain to your local supervisory authority. [OWNER: add the authority name per launch market, for example the Irish Data Protection Commission for EU users or the UK Information Commissioner's Office]

</section>

<section class="region-note" data-region="ng">

### Nigeria — verify current text

- **Law by name:** the Nigeria Data Protection Act 2023 (NDPA), enforced by the Nigeria Data Protection Commission (NDPC).
- **Rights you may have:** access your data; correct it; delete it; object to some processing; receive your data in a portable form.
- **Lawful basis:** we process your data to run the service you signed up for, to send what you asked for, and to keep financial records.
- **How to exercise them:** email [rowtareply@gmail.com](mailto:rowtareply@gmail.com).
- **International transfers:** data is processed from Nigeria; storage locations are [OWNER: hosting location(s), not decided] — verify current text before launch.
- **Complaint route:** the Nigeria Data Protection Commission. [OWNER: confirm the current NDPC complaint and contact process before launch]

</section>

<section class="region-note" data-region="us">

### United States — verify current text

- **Laws by name:** state privacy laws such as the California Consumer Privacy Act as amended by the CPRA, and similar laws in other states.
- **Rights you may have:** know what personal information is collected; delete it; correct it; opt out of any "sale" or "sharing" — Rowta does not sell or share personal information for money and runs no ads, so there is nothing to opt out of today.
- **How to exercise them:** email [rowtareply@gmail.com](mailto:rowtareply@gmail.com). We will not discriminate against you for making a request.
- **International transfers:** storage locations are [OWNER: hosting location(s), not decided] — verify current text before launch.
- **Complaint route:** your state attorney general's office. [OWNER: confirm per launch state]

</section>

<section class="region-note" data-region="other">

### Everywhere else — verify current text

- **Your local law** may give you rights to access, correct, delete or export your data.
- **How to exercise them:** email [rowtareply@gmail.com](mailto:rowtareply@gmail.com).
- **Complaint route:** your local data-protection authority. [OWNER: confirm per launch market]

</section>

The country you choose at sign-up could later decide which notice is shown to you. That is a planned improvement, not a feature today.

## Changes to this policy

When we change this policy we update this page and the draft date at the top. How we will alert users in the app to a material change is [OWNER: in-app notice method — not built yet]. This page is a draft until a lawyer reviews it.

## Contact and questions

Email is the only contact channel: [rowtareply@gmail.com](mailto:rowtareply@gmail.com). Use it for privacy questions, data-deletion requests, legal notices and security reports. See also the [Contact page](/contact/).
