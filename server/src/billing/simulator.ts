// Dev-only payment provider simulator (PRD 8.6, Task 4, F7).
//
// A fake Flutterwave that implements the PaymentProvider interface and exposes a dev-only trigger
// that POSTs a SIGNED webhook to the REAL webhook endpoint (same route, handler, signature check,
// dedupe, job as production — only the provider is faked).
//
// Fences:
//   - Starts only when PAYMENT_SIMULATOR_ENABLED=true
//   - The server REFUSES TO START if true while NODE_ENV=production (boot guard in
//     src/config/env.ts loadEnv(); explicit check also in src/index.ts main())
//   - Listed in docs/SECURITY.md section 3
//   - Webhook secret from env (FLW_WEBHOOK_SECRET_HASH); if empty in development, a random
//     in-memory secret shared by signer and verifier, never logged
//   - Proves OUR code, not Flutterwave's real behaviour (docs/AUDIT-NOTES.md)
//   - Not exposed in the app; the trigger is a server-only endpoint

import { randomBytes, randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { env } from '../config/env.ts';
import type { PaymentProvider, CheckoutResult, VerifyResult, ChargeResult } from './payment-provider.ts';
import { WEBHOOK_SIGNATURE_HEADER } from './webhook-constants.ts';

let simulatorSecret: string | null = null;

/** Resolve the webhook secret: from env, or a random in-memory secret in development (never logged). */
export function getSimulatorWebhookSecret(): string {
  if (simulatorSecret !== null) return simulatorSecret;
  const configured = env.FLW_WEBHOOK_SECRET_HASH;
  if (configured && configured.length > 0) {
    simulatorSecret = configured;
    return simulatorSecret;
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('Simulator webhook secret is required in production');
  }
  simulatorSecret = randomBytes(32).toString('hex');
  return simulatorSecret;
}

/** Fake in-memory checkouts keyed by txRef. Dev-only; never persists to the real database. */
const fakeCheckouts = new Map<string, { status: 'pending' | 'succeeded' | 'failed'; amountMinor: number; currency: string; authorizationRef?: string }>();

/** Fake in-memory authorisations keyed by authorizationRef. Dev-only; never persists to the real database. */
const fakeAuthorisations = new Map<string, { txRef: string; currency: string; status: 'active' | 'revoked' }>();

/** The API's own base URL for server-to-self calls (never PUBLIC_WEB_URL). */
function apiBaseUrl(): string {
  return `http://127.0.0.1:${env.API_PORT}`;
}

export class SimulatorProvider implements PaymentProvider {
  readonly name = 'rowta-simulator';

  async createCheckout(params: {
    amountMinor: number;
    currency: string;
    txRef: string;
    customerEmail?: string;
  }): Promise<CheckoutResult> {
    fakeCheckouts.set(params.txRef, { status: 'pending', amountMinor: params.amountMinor, currency: params.currency });
    const checkoutUrl = `${apiBaseUrl()}/simulator/checkout/${params.txRef}`;
    return { checkoutUrl, txRef: params.txRef };
  }

  async checkoutUrlFor(txRef: string): Promise<string> {
    return `${apiBaseUrl()}/simulator/checkout/${txRef}`;
  }

  async createAuthorisation(params: {
    currency: string;
    txRef: string;
  }): Promise<{ authorizationRef: string }> {
    const authorizationRef = `auth-${randomUUID()}`;
    fakeCheckouts.set(params.txRef, {
      status: 'succeeded',
      amountMinor: 0,
      currency: params.currency,
      authorizationRef,
    });
    fakeAuthorisations.set(authorizationRef, {
      txRef: params.txRef,
      currency: params.currency,
      status: 'active',
    });
    return { authorizationRef };
  }

  async verifyTransaction(txRef: string): Promise<VerifyResult> {
    // Cross-process verification: call the dev-only API endpoint served by this same process.
    const res = await fetch(`${apiBaseUrl()}/simulator/verify/${encodeURIComponent(txRef)}`);
    if (!res.ok) throw new Error(`unknown tx_ref: ${txRef}`);
    const body = (await res.json()) as { status: string; amountMinor: number; currency: string; authorizationRef?: string };
    return {
      status: body.status as VerifyResult['status'],
      amountMinor: body.amountMinor,
      currency: body.currency,
      authorizationRef: body.authorizationRef,
    };
  }

  /** Look up a checkout's current status for the GET /simulator/verify/:txRef endpoint. */
  getCheckoutStatus(txRef: string): { status: string; amountMinor: number; currency: string; authorizationRef?: string } | null {
    const checkout = fakeCheckouts.get(txRef);
    if (!checkout) return null;
    return { status: checkout.status, amountMinor: checkout.amountMinor, currency: checkout.currency, authorizationRef: checkout.authorizationRef };
  }

  async chargeAuthorisation(params: {
    authorizationRef: string;
    amountMinor: number;
    currency: string;
    txRef: string;
  }): Promise<ChargeResult> {
    fakeCheckouts.set(params.txRef, { status: 'succeeded', amountMinor: params.amountMinor, currency: params.currency });

    // Send the signed webhook through the same path as production (same route, handler, signature check).
    await this.notifyWebhook(params.txRef, params.amountMinor, params.currency);
    return { status: 'succeeded', txRef: params.txRef, authorizationRef: params.authorizationRef };
  }

  /** Mark a pending checkout as succeeded (used by the webhook trigger). */
  succeedCheckout(txRef: string): void {
    const checkout = fakeCheckouts.get(txRef);
    if (checkout) checkout.status = 'succeeded';
  }

  /** Dev-only: mark a pending checkout as failed. */
  failCheckout(txRef: string): void {
    const checkout = fakeCheckouts.get(txRef);
    if (checkout) checkout.status = 'failed';
  }

  /** Notify the real webhook endpoint with a signed charge.completed event. */
  async notifyWebhook(txRef: string, amountMinor: number, currency: string): Promise<void> {
    const rawBody = JSON.stringify({
      event: 'charge.completed',
      data: { tx_ref: txRef, amount: amountMinor, currency, status: 'successful' },
    });

    const secret = getSimulatorWebhookSecret();

    const webhookUrl = `${apiBaseUrl()}/webhook`;
    await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [WEBHOOK_SIGNATURE_HEADER]: secret,
      },
      body: rawBody,
    });
  }
}

export const simulatorProvider = new SimulatorProvider();

/**
 * Register all simulator routes on the app.
 * Only mounted when PAYMENT_SIMULATOR_ENABLED=true (see server/src/index.ts).
 * Routes:
 *   GET /simulator/verify/:txRef   - cross-process verification for the worker
 *   GET /simulator/checkout/:txRef - mark checkout succeeded and fire signed webhook
 *   POST /simulator/webhook-trigger - dev-only trigger to create + fire a webhook
 */
export function registerSimulatorRoutes(app: Hono): void {
  // GET /simulator/verify/:txRef - cross-process verification used by the worker
  app.get('/simulator/verify/:txRef', async (c) => {
    const { txRef } = c.req.param();
    const checkout = simulatorProvider.getCheckoutStatus(txRef);
    if (!checkout) {
      return c.json({ error: 'unknown tx_ref' }, 404);
    }
    return c.json({ status: checkout.status, amountMinor: checkout.amountMinor, currency: checkout.currency, authorizationRef: checkout.authorizationRef });
  });

  // GET /simulator/checkout/:txRef - mark checkout succeeded and fire signed webhook
  app.get('/simulator/checkout/:txRef', async (c) => {
    const { txRef } = c.req.param();
    const checkout = simulatorProvider.getCheckoutStatus(txRef);
    if (!checkout) {
      return c.json({ error: 'unknown tx_ref' }, 404);
    }
    // Mark succeeded and fire the signed webhook
    simulatorProvider.succeedCheckout(txRef);
    await simulatorProvider.notifyWebhook(txRef, checkout.amountMinor, checkout.currency);
    return c.json({ ok: true, txRef, status: checkout.status });
  });

  // POST /simulator/webhook-trigger - create fake checkout + fire signed webhook
  app.post('/simulator/webhook-trigger', async (c) => {
    const { txRef, amountMinor, currency, customerEmail } = await c.req.json() as {
      txRef?: string;
      amountMinor?: number;
      currency?: string;
      customerEmail?: string;
    };
    if (!txRef || typeof amountMinor !== 'number' || !currency) {
      return c.json({ error: 'txRef, amountMinor and currency are required' }, 422);
    }

    // Create the fake checkout (same as the provider would).
    await simulatorProvider.createCheckout({ amountMinor, currency, txRef, customerEmail });

    // Mark it succeeded so re-verification passes, then notify the real webhook endpoint.
    simulatorProvider.succeedCheckout(txRef);
    await simulatorProvider.notifyWebhook(txRef, amountMinor, currency);

    return c.json({ ok: true, txRef });
  });
}
