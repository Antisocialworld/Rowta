> **DRAFT — not legal advice.** Review by a qualified lawyer before launch.

# Delete Your Account and Data

Draft written 20 October 2026. This page is the public account-deletion address that app stores ask for.

## The two ways to delete

### 1. In the Rowta app

1. Open **Settings** and choose **Delete account**.
2. Confirm with your password.
3. Your account status becomes **pending deletion**: every session is signed out and your email address stays reserved.
4. Changed your mind? Sign in again within **30 days** and choose **Restore account**.
5. If you own a team, Rowta asks you to transfer or delete that team first — deleting a team is available to its owner, and a deleted team can be restored for 30 days too.

After 30 days a scheduled job permanently deletes your account.

### 2. By email

Email [rowtareply@gmail.com](mailto:rowtareply@gmail.com) from the address on the account and say you want your account deleted. We will reply to that address and ask you to confirm it is you before anything is removed. How long the confirmation takes is [OWNER: response-time promise — not set; do not promise one until you can keep it].

## What is deleted after the grace period

- Your account row: email, display name, country, password hash.
- Your devices and their push tokens.
- Your settings: quiet hours, time zone, language, theme.
- Your memberships in teams.
- Activity entries no longer point at you: your user reference is cleared, so the team history keeps the event but not your name.
- Records of emails we sent you.

## What is kept, and why

- **Financial ledger entries** are kept forever. They record what was paid, and they contain no personal details — no email, no name, no card.
- **A minimal tombstone team record** (an identifier and a deletion date) if you owned a team, so the ledger still has a valid team to point at. It contains no personal data.
- **Payment intent records** are kept until a tax adviser sets the period: [OWNER DECISION: retention period for payment records — open, see the internal tax notes]. They are not deleted automatically today.

## How deletion works behind the words

Deletion is two steps on purpose: your request first marks the account for deletion (that is when the 30-day window and the sign-in offer of restore start), and a scheduled job hard-deletes the data when the window closes. The job runs in batches, is tested dry-run first, and writes a log. Short-lived leftovers — sign-in codes and links — are purged 7 days after they expire. Our [Data retention page](/data-retention/) has the full table.

## Deleting a team instead

The team owner can delete the team: members lose access at once, the subscription ends at the period with no refund, and the owner can restore for 30 days. After that the scheduled job removes the team's shifts, swaps, activity, memberships, invites and webhook events — while keeping the financial ledger and the anonymised tombstone described above.

## If you cannot sign in

Email [rowtareply@gmail.com](mailto:rowtareply@gmail.com) from the address you remember. We will help you prove the account is yours before deleting it.

## Questions

See the [Privacy policy](/privacy/) or the [Contact page](/contact/).
