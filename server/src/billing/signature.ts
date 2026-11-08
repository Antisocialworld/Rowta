// Webhook signature verification (PRD 8.6, Task 4; rule S13).
//
// Flutterwave webhooks carry the secret hash in the `verif-hash` header.
// The receiver compares the header value to the configured secret hash
// (FLW_WEBHOOK_SECRET_HASH) using constant-time equality. No HMAC, no
// hashing — a straight equal-length buffer comparison. Missing/mismatch = reject.
//
// [VERIFY] The exact comparison (plain hash equality vs HMAC) must be
// confirmed once in the Flutterwave sandbox before real provider keys are used.

import { timingSafeEqual } from 'node:crypto';

/**
 * Verify a webhook signature header against the configured secret hash
 * using constant-time comparison. Returns false (without leaking timing
 * info) when the signature is missing or invalid.
 * The `rawBody` parameter is kept for API compatibility but is not used:
 * Flutterwave sends the secret hash itself, not an HMAC over the body.
 */
export function verifySignature(_rawBody: string | Buffer, signature: string | null | undefined, secret: string): boolean {
  if (signature === null || signature === undefined || signature.length === 0) return false;
  if (secret.length === 0) return false;
  const expectedBuf = Buffer.from(secret, 'utf8');
  const actualBuf = Buffer.from(signature, 'utf8');
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
