// Flutterwave v3 API client (Phase 6 / G6b Task B2).
// Official docs: https://developer.flutterwave.com/docs/collecting-payments/standard
// Endpoints:
//   - POST https://api.flutterwave.com/v3/payments (Hosted Checkout)
//   - GET  https://api.flutterwave.com/v3/transactions/verify_by_reference (Verification)
//   - POST https://api.flutterwave.com/v3/tokenized-charges (Authorisation charge)
// Rules:
//   - 15-second timeout on all calls (AbortController)
//   - No retry on checkout creation
//   - Integer math for amount conversion, no floats
//   - Never log secrets, card data, or response bodies; log errorCode and status only
//   - Mask tokens/secrets
import { env } from '../config/env.ts';
import { HttpError } from '../middleware/error.ts';
import { logger } from '../lib/logger.ts';
import { koboToDecimalString } from './money.ts';
import type { PaymentProvider, CheckoutResult, VerifyResult, ChargeResult } from './payment-provider.ts';

const log = logger.child({ module: 'billing-flutterwave' });

const FLW_BASE_URL = 'https://api.flutterwave.com/v3';
const TIMEOUT_MS = 15000;

function koboToFlutterwaveAmount(kobo: number, currency: string): string {
  if (currency === 'NGN') {
    return koboToDecimalString(kobo);
  }
  return `${kobo}`;
}

export class FlutterwaveClient implements PaymentProvider {
  readonly name = 'flutterwave';

  private getSecretKey(): string {
    const key = env.FLW_SECRET_KEY;
    if (!key || key.length === 0) {
      throw new HttpError(500, 'billing.provider_not_configured', 'Flutterwave secret key not configured.');
    }
    return key;
  }

  async createCheckout(params: {
    amountMinor: number;
    currency: string;
    txRef: string;
    customerEmail?: string;
  }): Promise<CheckoutResult> {
    const secretKey = this.getSecretKey();
    const amountStr = koboToFlutterwaveAmount(params.amountMinor, params.currency);
    const redirectUrl = process.env.PUBLIC_WEB_URL
      ? `${process.env.PUBLIC_WEB_URL}/billing/complete`
      : undefined;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${FLW_BASE_URL}/payments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tx_ref: params.txRef,
          amount: amountStr,
          currency: params.currency,
          redirect_url: redirectUrl,
          customer: {
            email: params.customerEmail || 'billing@rowta.app',
          },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        log.error({ status: res.status, errorCode: 'FLW_CHECKOUT_NON_2XX' }, 'flutterwave create checkout non-2xx');
        throw new HttpError(502, 'billing.provider_error', 'Payment provider rejected checkout.');
      }

      const json = (await res.json()) as { status?: string; data?: { link?: string } };
      if (json.status !== 'success' || !json.data?.link) {
        log.error({ status: res.status, errorCode: 'FLW_CHECKOUT_INVALID_RESPONSE' }, 'flutterwave link missing in response');
        throw new HttpError(502, 'billing.provider_error', 'Invalid response from payment provider.');
      }

      return {
        checkoutUrl: json.data.link,
        txRef: params.txRef,
      };
    } catch (err: unknown) {
      if (err instanceof HttpError) throw err;
      const isAbort = (err as { name?: string })?.name === 'AbortError';
      const errorCode = isAbort ? 'FLW_TIMEOUT' : ((err as { code?: string })?.code ?? 'FLW_NETWORK_ERROR');
      log.error({ errorCode }, 'flutterwave create checkout error');
      throw new HttpError(502, 'billing.provider_error', 'Payment provider request failed.');
    } finally {
      clearTimeout(timer);
    }
  }

  async verifyTransaction(txRef: string): Promise<VerifyResult> {
    const secretKey = this.getSecretKey();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const url = `${FLW_BASE_URL}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        log.error({ status: res.status, errorCode: 'FLW_VERIFY_NON_2XX' }, 'flutterwave verify non-2xx');
        return { status: 'failed', amountMinor: 0, currency: '' };
      }

      const json = (await res.json()) as {
        status?: string;
        data?: {
          status?: string;
          amount?: number;
          currency?: string;
          tx_ref?: string;
          flw_ref?: string;
          card?: { token?: string };
        };
      };

      if (json.status !== 'success' || !json.data) {
        log.error({ status: res.status, errorCode: 'FLW_VERIFY_INVALID_RESPONSE' }, 'flutterwave verify failed response');
        return { status: 'failed', amountMinor: 0, currency: '' };
      }

      const d = json.data;
      if (d.status !== 'successful' || d.tx_ref !== txRef) {
        return {
          status: 'failed',
          amountMinor: d.amount ?? 0,
          currency: d.currency ?? '',
        };
      }

      const authorizationRef = d.card?.token || d.flw_ref;

      return {
        status: 'succeeded',
        amountMinor: d.amount ?? 0, // provider unit (Naira), converted to kobo by fromProviderAmount in webhook job
        currency: d.currency ?? '',
        txRef: d.tx_ref,
        authorizationRef,
      };
    } catch (err: unknown) {
      const isAbort = (err as { name?: string })?.name === 'AbortError';
      const errorCode = isAbort ? 'FLW_TIMEOUT' : ((err as { code?: string })?.code ?? 'FLW_NETWORK_ERROR');
      log.error({ errorCode }, 'flutterwave verify error');
      return { status: 'failed', amountMinor: 0, currency: '', txRef };
    } finally {
      clearTimeout(timer);
    }
  }

  async chargeAuthorisation(params: {
    authorizationRef: string;
    amountMinor: number;
    currency: string;
    txRef: string;
    customerEmail?: string;
  }): Promise<ChargeResult> {
    const secretKey = this.getSecretKey();
    const amountStr = koboToFlutterwaveAmount(params.amountMinor, params.currency);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${FLW_BASE_URL}/tokenized-charges`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: params.authorizationRef,
          currency: params.currency,
          amount: amountStr,
          tx_ref: params.txRef,
          email: params.customerEmail,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        log.error({ status: res.status, errorCode: 'FLW_CHARGE_AUTH_NON_2XX' }, 'flutterwave charge authorisation non-2xx');
        return { status: 'failed', txRef: params.txRef };
      }

      const json = (await res.json()) as { status?: string; data?: { status?: string } };
      const status = json.status === 'success' && json.data?.status === 'successful' ? 'succeeded' : 'failed';
      return { status, txRef: params.txRef, authorizationRef: params.authorizationRef };
    } catch (err: unknown) {
      const isAbort = (err as { name?: string })?.name === 'AbortError';
      const errorCode = isAbort ? 'FLW_TIMEOUT' : ((err as { code?: string })?.code ?? 'FLW_CHARGE_AUTH_ERROR');
      log.error({ errorCode }, 'flutterwave charge authorisation error');
      return { status: 'failed', txRef: params.txRef };
    } finally {
      clearTimeout(timer);
    }
  }

  async checkoutUrlFor(txRef: string): Promise<string> {
    return `https://checkout.flutterwave.com/v3/hosted/pay/${encodeURIComponent(txRef)}`;
  }

  async createAuthorisation(_params: {
    currency: string;
    txRef: string;
  }): Promise<{ authorizationRef: string }> {
    throw new Error('createAuthorisation not supported on live provider; tokenized from checkout card token');
  }
}

export const flutterwaveProvider = new FlutterwaveClient();

