// Receipt email (Task 6, PRD 8.6).
// Insert into sent_emails (kind 'receipt', ref = ledger entry id, UNIQUE) FIRST, send only if
// the insert won; nodemailer SMTP, dev mail catcher; no body stored.
// Receipts show the amount in the paid currency and are not tax invoices (docs/TAX-NOTES.md).

import { globalDb } from '../db/clients.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { logger } from '../lib/logger.ts';
import { sendEmail } from '../mail/transport.ts';

const log = logger.child({ module: 'billing-receipt' });

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Send a receipt email for a successful ledger charge.
 * Claims the sent_emails row first (UNIQUE user_id + kind + ref); sends only if the claim won.
 * Returns true if the receipt was sent, false if it was already sent (duplicate).
 */
export async function sendReceiptEmail(params: {
  userId: string;
  email: string;
  displayName: string | null;
  amountMinor: number;
  currency: string;
  ledgerEntryId: string;
  webLink: string;
}): Promise<{ sent: boolean }> {
  const db = globalDb();

  // Claim first (C4). If the claim is lost the receipt was already sent once — skip.
  try {
    await db.sent_emails.create({
      data: {
        user_id: params.userId,
        kind: 'receipt',
        ref: params.ledgerEntryId,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { sent: false };
    throw err;
  }

  const user = await globalDb().users.findUnique({ where: { id: params.userId } });
  if (!user) return { sent: false };

  // Format the amount for the currency (Intl, en-NG, NGN).
  const decimals = params.currency === 'NGN' ? 2 : 2; // [VERIFY] from currencies.minor_unit
  const major = params.amountMinor / Math.pow(10, decimals);
  const formatted = new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: params.currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(major);

  const text = `Hi ${params.displayName ?? ''},\n\nYour payment of ${formatted} (${params.currency}) has been received.\nTransaction: ${params.ledgerEntryId}\n\nThank you,\nRowta`;

  try {
    await sendEmail({
      kind: 'receipt',
      to: params.email,
      subject: `Rowta payment receipt — ${formatted}`,
      text,
      html: `<p>${escapeHtml(text).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`,
    });
  } catch (err) {
    // The send failed: release the claim so the retry (J1) can claim and send again.
    await db.sent_emails
      .deleteMany({ where: { user_id: params.userId, kind: 'receipt', ref: params.ledgerEntryId } })
      .catch(() => undefined);
    log.warn({ err, ledgerEntryId: params.ledgerEntryId }, 'receipt send failed; claim released');
    throw err;
  }

  return { sent: true };
}
