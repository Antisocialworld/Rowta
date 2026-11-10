// Flutterwave client unit tests (Phase 6 / G6c C7).
// Tests conversion functions, mocked fetch, 15-second timeout abortion, and redacted non-2xx handling.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.ts';
import { koboToDecimalString, parseMajorToMinor } from '../src/billing/money.ts';
import { HttpError } from '../src/middleware/error.ts';

const { mockLog } = vi.hoisted(() => {
  const logObj = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  logObj.child.mockReturnValue(logObj);
  return { mockLog: logObj };
});

vi.mock('../src/lib/logger.ts', () => ({
  logger: {
    child: vi.fn(() => mockLog),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { FlutterwaveClient } from '../src/billing/flutterwave-client.ts';

describe('Flutterwave client amount conversion (C7)', () => {
  it('kobo-to-decimal-string: converts minor units to decimal strings', () => {
    expect(koboToDecimalString(650000)).toBe('6500.00');
    expect(koboToDecimalString(650050)).toBe('6500.50');
    expect(koboToDecimalString(7)).toBe('0.07');
    expect(koboToDecimalString(100)).toBe('1.00');
  });

  it('verified-amount-to-kobo: converts major units to integer kobo without float drift', () => {
    expect(parseMajorToMinor(6500)).toBe(650000);
    expect(parseMajorToMinor(6500.5)).toBe(650050);
    expect(parseMajorToMinor(19.99)).toBe(1999);
    expect(parseMajorToMinor(0.07)).toBe(7);
  });

  it('verified-amount-to-kobo: rejects amounts with more than 2 decimal places', () => {
    expect(() => parseMajorToMinor(19.999)).toThrow(/more than 2 decimal places/);
    expect(() => parseMajorToMinor(6500.123)).toThrow(/more than 2 decimal places/);
  });
});

describe('Flutterwave client API calls with mocked fetch (C7)', () => {
  const originalFetch = globalThis.fetch;
  let client: FlutterwaveClient;
  let originalSecretKey: string;

  beforeEach(() => {
    originalSecretKey = env.FLW_SECRET_KEY;
    (env as { FLW_SECRET_KEY: string }).FLW_SECRET_KEY = 'test-secret-not-real';
    client = new FlutterwaveClient();
  });

  afterEach(() => {
    (env as { FLW_SECRET_KEY: string }).FLW_SECRET_KEY = originalSecretKey;
    globalThis.fetch = originalFetch;
    mockLog.error.mockClear();
    vi.restoreAllMocks();
  });

  it('handles non-2xx without leaking response body in logs or errors', async () => {
    mockLog.error.mockClear();
    const fakeResponseBody = 'secret response text with internal info';

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: fakeResponseBody }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      }),
    );

    let thrownError: unknown;
    try {
      await client.createCheckout({
        amountMinor: 650000,
        currency: 'NGN',
        txRef: 'tx-test-1',
        customerEmail: 'user@example.com',
      });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeInstanceOf(HttpError);
    const httpErr = thrownError as HttpError;
    expect(httpErr.message).not.toContain(fakeResponseBody);

    expect(mockLog.error).toHaveBeenCalled();
    for (const callArgs of mockLog.error.mock.calls) {
      const serialized = JSON.stringify(callArgs);
      expect(serialized).not.toContain(fakeResponseBody);
    }

    const [logMeta] = mockLog.error.mock.calls[0] as [Record<string, unknown>, string];
    expect(logMeta).toEqual({ status: 502, errorCode: 'FLW_CHECKOUT_NON_2XX' });
  });

  it('aborts requests that exceed the 15-second timeout', async () => {
    globalThis.fetch = vi.fn().mockImplementation((_url, init?: RequestInit) => {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('This operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    vi.useFakeTimers();

    const checkoutPromise = client.createCheckout({
      amountMinor: 650000,
      currency: 'NGN',
      txRef: 'tx-test-timeout',
    });

    // Advance past 15 seconds
    vi.advanceTimersByTime(15001);

    await expect(checkoutPromise).rejects.toThrow(HttpError);

    vi.useRealTimers();
  });

  it('createCheckout converts kobo (650000) to provider amount in decimal string (6500.00)', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    globalThis.fetch = vi.fn().mockImplementation((_url, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: 'success',
            data: { link: 'https://checkout.flutterwave.com/v3/hosted/pay/test-tx-1' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    });

    const result = await client.createCheckout({
      amountMinor: 650000,
      currency: 'NGN',
      txRef: 'tx-test-1',
      customerEmail: 'test@example.com',
    });

    expect(result.txRef).toBe('tx-test-1');
    expect(result.checkoutUrl).toBe('https://checkout.flutterwave.com/v3/hosted/pay/test-tx-1');
    expect(capturedBody).not.toBeNull();
    expect((capturedBody as unknown as Record<string, unknown>).amount).toBe('6500.00');
    expect((capturedBody as unknown as Record<string, unknown>).currency).toBe('NGN');
  });

  it('sends customerEmail in tokenized charge request', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    globalThis.fetch = vi.fn().mockImplementation((_url, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            status: 'success',
            data: { status: 'successful' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    });

    const result = await client.chargeAuthorisation({
      authorizationRef: 'flw-token-123',
      amountMinor: 650000,
      currency: 'NGN',
      txRef: 'tx-charge-1',
      customerEmail: 'payer@example.com',
    });

    expect(result.status).toBe('succeeded');
    expect(capturedBody).not.toBeNull();
    expect(capturedBody).toMatchObject({
      token: 'flw-token-123',
      email: 'payer@example.com',
      amount: '6500.00',
      currency: 'NGN',
      tx_ref: 'tx-charge-1',
    });
  });

  it('verifyTransaction returns txRef and parses successful response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'success',
          data: {
            status: 'successful',
            amount: 6500,
            currency: 'NGN',
            tx_ref: 'tx-verify-1',
            flw_ref: 'flw-ref-456',
            card: { token: 'card-token-789' },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await client.verifyTransaction('tx-verify-1');
    expect(result.status).toBe('succeeded');
    expect(result.amountMinor).toBe(6500);
    expect(result.currency).toBe('NGN');
    expect(result.txRef).toBe('tx-verify-1');
    expect(result.authorizationRef).toBe('card-token-789');
  });
});

