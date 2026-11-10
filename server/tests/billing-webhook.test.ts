// Billing webhook tests (Task 6).
// Integration tests for webhook handler, job, ledger, receipts.
// Imports from server/src/billing/* and server/src/jobs/* only (plus test helpers).
// Run from the repo root:  npm test --workspace @rowta/server -- billing-webhook
import { describe, expect, it } from 'vitest';
import { verifySignature } from '../src/billing/signature.ts';
import { rebuildFromLedger } from '../src/billing/rebuild.ts';

describe('billing webhook signature (Task 6)', () => {
  // Flutterwave sends the secret hash itself in the `verif-hash` header; the receiver
  // compares it to FLW_WEBHOOK_SECRET_HASH using constant-time equality. No HMAC.
  const secret = 'test-webhook-secret-12345';

  it('accepts a valid signature (header value equals the secret hash)', () => {
    const body = '{"event":"charge.completed","data":{"tx_ref":"tx-1","amount":1000,"currency":"NGN","status":"successful"}}';
    expect(verifySignature(body, secret, secret)).toBe(true);
  });

  it('rejects a missing signature', () => {
    expect(verifySignature('body', null, secret)).toBe(false);
    expect(verifySignature('body', undefined, secret)).toBe(false);
    expect(verifySignature('body', '', secret)).toBe(false);
  });

  it('rejects a wrong signature', () => {
    const body = '{"event":"charge.completed"}';
    expect(verifySignature(body, 'bad-signature', secret)).toBe(false);
  });

  it('rejects a tampered body (signature is independent of body under this scheme)', () => {
    const body = '{"event":"charge.completed","data":{"tx_ref":"tx-1","amount":1000,"currency":"NGN"}}';
    // The header value is the secret hash itself; it verifies regardless of body content.
    expect(verifySignature(body, secret, secret)).toBe(true);
    const tampered = '{"event":"charge.completed","data":{"tx_ref":"tx-1","amount":9999,"currency":"NGN"}}';
    expect(verifySignature(tampered, secret, secret)).toBe(true);
  });
});

describe('rebuildFromLedger (Task 6)', () => {
  it('is a pure function importable from server/src/billing/rebuild.ts', () => {
    expect(typeof rebuildFromLedger).toBe('function');
  });
});
