// Billing legacy checkout moved test (Task 3).
// Verifies POST /teams/:teamId/billing/checkout returns 410 billing.checkout_moved.
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import type { Hono } from 'hono';
import {
  clearRateKeys,
  createVerifiedUser,
  dataOf,
  errorOf,
  ensureTestCountries,
  post,
  shutdownAuthTest,
  testApp,
  uniqueEmail,
} from './helpers/auth-test.ts';
import { signAccessToken } from '../src/security/access-token.ts';

let app: Hono;

async function createTeamFor(auth: Record<string, string>, name: string): Promise<string> {
  const res = await post(app, '/teams', { name }, { ...auth, 'idempotency-key': uniqueEmail('billing') });
  expect(res.status).toBe(201);
  const data = await dataOf(res);
  return data.id as string;
}

describe('legacy team checkout moved (410)', () => {
  let ownerId: string;
  let ownerAuth: Record<string, string>;
  let teamId: string;

  beforeAll(async () => {
    await clearRateKeys();
    await ensureTestCountries();
    app = testApp('billing-checkout-moved');

    ownerId = await createVerifiedUser(uniqueEmail('checkout-moved-owner'), 'OwnerPass123#');
    ownerAuth = { authorization: `Bearer ${await signAccessToken(ownerId)}` };

    teamId = await createTeamFor(ownerAuth, 'Legacy Checkout Team');
  });

  afterAll(async () => {
    await shutdownAuthTest();
  });

  it('returns 410 billing.checkout_moved when calling legacy team checkout', async () => {
    const res = await post(
      app,
      `/teams/${teamId}/billing/checkout`,
      { plan: 'monthly', interval: 'monthly' },
      { ...ownerAuth, 'idempotency-key': uniqueEmail('billing') },
    );

    expect(res.status).toBe(410);
    const err = await errorOf(res);
    expect(err.code).toBe('billing.checkout_moved');
  });
});

