// Phase 6 Stage 3 unit tests: Expo push client with injected fake fetch (PRD 8.7).
// Verifies batching at 100 and 1000, ticket & receipt parsing, retries on 429/5xx,
// 4xx non-retry, timeout via AbortController, DeviceNotRegistered removal, and token masking.
import { describe, expect, it, vi } from 'vitest';
import {
  EXPO_RECEIPTS_BATCH_LIMIT,
  EXPO_SEND_BATCH_LIMIT,
  getPushReceipts,
  getUnregisteredTokensFromReceipts,
  getUnregisteredTokensFromTickets,
  maskPushToken,
  removeInvalidDevices,
  sendPushMessages,
  type ExpoPushMessage,
} from '../src/push/client.ts';

function createMockFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return vi.fn(handler) as unknown as typeof fetch;
}

function jsonResponse(data: unknown, status = 200, statusText = 'OK'): Response {
  return new Response(JSON.stringify(data), {
    status,
    statusText,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Phase 6 Stage 3 Expo push client', () => {
  // 1. Exact batching at 100
  it(`splits sendPushMessages into exact batches of at most ${EXPO_SEND_BATCH_LIMIT}`, async () => {
    const totalMessages = 250;
    const messages: ExpoPushMessage[] = Array.from({ length: totalMessages }, (_, i) => ({
      to: `ExponentPushToken[batch_test_${i}]`,
      body: `Message ${i}`,
    }));

    const batchSizes: number[] = [];
    const mockFetch = createMockFetch(async (_url, init) => {
      const body = JSON.parse(init?.body as string) as ExpoPushMessage[];
      batchSizes.push(body.length);
      const tickets = body.map((_, i) => ({ status: 'ok', id: `ticket-${batchSizes.length}-${i}` }));
      return jsonResponse({ data: tickets });
    });

    const results = await sendPushMessages(messages, {
      fetchFn: mockFetch,
      timeoutMs: 1_000,
      initialBackoffMs: 10,
    });

    expect(batchSizes).toEqual([100, 100, 50]);
    expect(results.length).toBe(totalMessages);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    for (let i = 0; i < totalMessages; i += 1) {
      expect(results[i]!.token).toBe(messages[i]!.to);
      expect(results[i]!.ticket.status).toBe('ok');
    }
  });

  // 2. Exact batching at 1000 for receipts
  it(`splits getPushReceipts into exact batches of at most ${EXPO_RECEIPTS_BATCH_LIMIT}`, async () => {
    const totalTickets = 2_500;
    const ticketIds: string[] = Array.from({ length: totalTickets }, (_, i) => `ticket-id-${i}`);

    const batchSizes: number[] = [];
    const mockFetch = createMockFetch(async (_url, init) => {
      const body = JSON.parse(init?.body as string) as { ids: string[] };
      batchSizes.push(body.ids.length);
      const data: Record<string, { status: string }> = {};
      for (const id of body.ids) {
        data[id] = { status: 'ok' };
      }
      return jsonResponse({ data });
    });

    const receiptsMap = await getPushReceipts(ticketIds, {
      fetchFn: mockFetch,
      timeoutMs: 1_000,
      initialBackoffMs: 10,
    });

    expect(batchSizes).toEqual([1000, 1000, 500]);
    expect(receiptsMap.size).toBe(totalTickets);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    for (const id of ticketIds) {
      expect(receiptsMap.get(id)?.status).toBe('ok');
    }
  });

  // 3. Ticket parsing & mixed ok/error in one batch in exact input order
  it('parses mixed ok and error tickets in a single batch in exact input order', async () => {
    const messages: ExpoPushMessage[] = [
      { to: 'ExponentPushToken[ok_1]', title: 'Notice 1' },
      { to: 'ExponentPushToken[err_not_reg]', title: 'Notice 2' },
      { to: 'ExponentPushToken[ok_2]', title: 'Notice 3' },
      { to: 'ExponentPushToken[err_rate]', title: 'Notice 4' },
    ];

    const mockFetch = createMockFetch(async () =>
      jsonResponse({
        data: [
          { status: 'ok', id: 'ticket-1' },
          {
            status: 'error',
            message: 'Device not registered',
            details: { error: 'DeviceNotRegistered' },
          },
          { status: 'ok', id: 'ticket-3' },
          {
            status: 'error',
            message: 'Rate limit exceeded',
            details: { error: 'MessageRateExceeded' },
          },
        ],
      }),
    );

    const results = await sendPushMessages(messages, {
      fetchFn: mockFetch,
      timeoutMs: 1_000,
      initialBackoffMs: 10,
    });

    expect(results.length).toBe(4);

    expect(results[0]!.token).toBe('ExponentPushToken[ok_1]');
    expect(results[0]!.ticket).toEqual({ status: 'ok', ticketId: 'ticket-1' });

    expect(results[1]!.token).toBe('ExponentPushToken[err_not_reg]');
    expect(results[1]!.ticket).toEqual({
      status: 'error',
      message: 'Device not registered',
      code: 'DeviceNotRegistered',
      details: { error: 'DeviceNotRegistered' },
    });

    expect(results[2]!.token).toBe('ExponentPushToken[ok_2]');
    expect(results[2]!.ticket).toEqual({ status: 'ok', ticketId: 'ticket-3' });

    expect(results[3]!.token).toBe('ExponentPushToken[err_rate]');
    expect(results[3]!.ticket).toEqual({
      status: 'error',
      message: 'Rate limit exceeded',
      code: 'MessageRateExceeded',
      details: { error: 'MessageRateExceeded' },
    });
  });

  // 4. Retry on 429 and 5xx then success
  it('retries on HTTP 429 and 5xx with backoff and succeeds on subsequent attempt', async () => {
    let callCount = 0;
    const mockFetch = createMockFetch(async () => {
      callCount += 1;
      if (callCount === 1) {
        return jsonResponse({ error: 'rate limit' }, 429, 'Too Many Requests');
      }
      if (callCount === 2) {
        return jsonResponse({ error: 'gateway' }, 503, 'Service Unavailable');
      }
      return jsonResponse({
        data: [{ status: 'ok', id: 'ticket-after-retry' }],
      });
    });

    const results = await sendPushMessages(
      [{ to: 'ExponentPushToken[retry_success]', body: 'Retry body' }],
      {
        fetchFn: mockFetch,
        timeoutMs: 1_000,
        initialBackoffMs: 5,
        maxRetries: 3,
      },
    );

    expect(callCount).toBe(3);
    expect(results[0]!.ticket).toEqual({ status: 'ok', ticketId: 'ticket-after-retry' });
  });

  // 5. Retry exhaustion on persistent 5xx
  it('exhausts retries on persistent 500 and returns retryable failed ticket', async () => {
    let callCount = 0;
    const mockFetch = createMockFetch(async () => {
      callCount += 1;
      return jsonResponse({ error: 'internal error' }, 500, 'Internal Server Error');
    });

    const maxRetries = 2;
    const results = await sendPushMessages(
      [{ to: 'ExponentPushToken[exhaust_test]', body: 'Exhaust body' }],
      {
        fetchFn: mockFetch,
        timeoutMs: 1_000,
        initialBackoffMs: 5,
        maxRetries,
      },
    );

    // Initial attempt + maxRetries = 3 calls
    expect(callCount).toBe(maxRetries + 1);
    expect(results[0]!.ticket).toEqual({
      status: 'failed',
      error: 'Expo push service temporarily unavailable (HTTP 500)',
      retryable: true,
    });
  });

  // 6. Non-retryable 4xx (e.g. 400 Bad Request)
  it('does NOT retry 4xx errors other than 429 (e.g. 400 Bad Request)', async () => {
    let callCount = 0;
    const mockFetch = createMockFetch(async () => {
      callCount += 1;
      return jsonResponse({ error: 'bad request' }, 400, 'Bad Request');
    });

    const results = await sendPushMessages(
      [{ to: 'ExponentPushToken[bad_req]', body: 'Bad request' }],
      {
        fetchFn: mockFetch,
        timeoutMs: 1_000,
        initialBackoffMs: 5,
        maxRetries: 3,
      },
    );

    expect(callCount).toBe(1); // Exactly 1 call, no retries
    expect(results[0]!.ticket).toEqual({
      status: 'failed',
      error: 'Expo push request rejected (HTTP 400)',
      retryable: false,
    });
  });

  // 7. Timeout handling via AbortController
  it('handles timeout via AbortController signal and marks failure as retryable', async () => {
    const mockFetch = createMockFetch(async (_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const results = await sendPushMessages(
      [{ to: 'ExponentPushToken[timeout_test]', body: 'Timeout body' }],
      {
        fetchFn: mockFetch,
        timeoutMs: 20, // fast timeout for test
        initialBackoffMs: 5,
        maxRetries: 1,
      },
    );

    expect(results[0]!.ticket).toEqual({
      status: 'failed',
      error: 'Expo push request timed out',
      retryable: true,
    });
  });

  // 8. Missing receipt IDs stay 'unknown'
  it('marks receipt IDs missing from response data as unknown', async () => {
    const mockFetch = createMockFetch(async () =>
      jsonResponse({
        data: {
          'ticket-present-1': { status: 'ok' },
          'ticket-present-2': {
            status: 'error',
            message: 'Device not registered',
            details: { error: 'DeviceNotRegistered' },
          },
        },
      }),
    );

    const receiptsMap = await getPushReceipts(['ticket-present-1', 'ticket-missing-99', 'ticket-present-2'], {
      fetchFn: mockFetch,
    });

    expect(receiptsMap.get('ticket-present-1')).toEqual({ status: 'ok' });
    expect(receiptsMap.get('ticket-missing-99')).toEqual({ status: 'unknown' });
    expect(receiptsMap.get('ticket-present-2')).toEqual({
      status: 'error',
      message: 'Device not registered',
      code: 'DeviceNotRegistered',
      details: { error: 'DeviceNotRegistered' },
    });
  });

  // 9. removeInvalidDevices deletes only DeviceNotRegistered tokens
  it('removeInvalidDevices hard-deletes tokens reported as DeviceNotRegistered and nothing else', async () => {
    const deletedTokens: string[] = [];
    const mockDb = {
      devices: {
        deleteMany: vi.fn(async (args: { where: { push_token: { in: string[] } } }) => {
          deletedTokens.push(...args.where.push_token.in);
          return { count: args.where.push_token.in.length };
        }),
      },
    };

    const invalidTokens = ['ExponentPushToken[unreg_1]', 'ExponentPushToken[unreg_2]'];
    const count = await removeInvalidDevices(invalidTokens, mockDb);

    expect(count).toBe(2);
    expect(mockDb.devices.deleteMany).toHaveBeenCalledWith({
      where: { push_token: { in: invalidTokens } },
    });
    expect(deletedTokens).toEqual(invalidTokens);

    // Empty tokens list does nothing
    const zeroCount = await removeInvalidDevices([], mockDb);
    expect(zeroCount).toBe(0);
  });

  // 9b. Non-DeviceNotRegistered ticket errors (MessageTooBig, MessageRateExceeded, InvalidCredentials) remove NO device
  it('MessageTooBig, MessageRateExceeded and InvalidCredentials ticket errors remove NO device; only DeviceNotRegistered removes matching device', async () => {
    const mockDb = {
      devices: {
        deleteMany: vi.fn(async (args: { where: { push_token: { in: string[] } } }) => {
          return { count: args.where.push_token.in.length };
        }),
      },
    };

    const tickets = [
      {
        token: 'ExponentPushToken[too_big]',
        ticket: { status: 'error' as const, message: 'Message too big', code: 'MessageTooBig' },
      },
      {
        token: 'ExponentPushToken[rate_limit]',
        ticket: { status: 'error' as const, message: 'Rate exceeded', code: 'MessageRateExceeded' },
      },
      {
        token: 'ExponentPushToken[invalid_cred]',
        ticket: { status: 'error' as const, message: 'Invalid credentials', code: 'InvalidCredentials' },
      },
      {
        token: 'ExponentPushToken[ok_token]',
        ticket: { status: 'ok' as const, ticketId: 'ticket-ok' },
      },
      {
        token: 'ExponentPushToken[unreg_device]',
        ticket: { status: 'error' as const, message: 'Device not registered', code: 'DeviceNotRegistered' },
      },
    ];

    const tokensToRemove = getUnregisteredTokensFromTickets(tickets);
    // Only the DeviceNotRegistered token is selected for removal
    expect(tokensToRemove).toEqual(['ExponentPushToken[unreg_device]']);

    const removedCount = await removeInvalidDevices(tokensToRemove, mockDb);
    expect(removedCount).toBe(1);
    expect(mockDb.devices.deleteMany).toHaveBeenCalledWith({
      where: { push_token: { in: ['ExponentPushToken[unreg_device]'] } },
    });
  });

  // 9c. Non-DeviceNotRegistered receipt errors (MessageTooBig, MessageRateExceeded, InvalidCredentials) remove NO device
  it('MessageTooBig, MessageRateExceeded and InvalidCredentials receipt errors remove NO device; only DeviceNotRegistered removes matching device', async () => {
    const mockDb = {
      devices: {
        deleteMany: vi.fn(async (args: { where: { push_token: { in: string[] } } }) => {
          return { count: args.where.push_token.in.length };
        }),
      },
    };

    const receipts = new Map([
      ['t-1', { status: 'error' as const, message: 'Message too big', code: 'MessageTooBig' }],
      ['t-2', { status: 'error' as const, message: 'Rate limit', code: 'MessageRateExceeded' }],
      ['t-3', { status: 'error' as const, message: 'Invalid credentials', code: 'InvalidCredentials' }],
      ['t-4', { status: 'ok' as const }],
      ['t-5', { status: 'error' as const, message: 'Device not registered', code: 'DeviceNotRegistered' }],
    ]);

    const ticketToTokenMap = new Map([
      ['t-1', 'ExponentPushToken[too_big]'],
      ['t-2', 'ExponentPushToken[rate_limit]'],
      ['t-3', 'ExponentPushToken[invalid_cred]'],
      ['t-4', 'ExponentPushToken[ok_token]'],
      ['t-5', 'ExponentPushToken[unreg_device]'],
    ]);

    const tokensToRemove = getUnregisteredTokensFromReceipts(receipts, ticketToTokenMap);
    // Only the DeviceNotRegistered receipt token is selected for removal
    expect(tokensToRemove).toEqual(['ExponentPushToken[unreg_device]']);

    const removedCount = await removeInvalidDevices(tokensToRemove, mockDb);
    expect(removedCount).toBe(1);
    expect(mockDb.devices.deleteMany).toHaveBeenCalledWith({
      where: { push_token: { in: ['ExponentPushToken[unreg_device]'] } },
    });
  });

  // 9d. Real sendPushMessages entry point removes NO device on MessageTooBig, MessageRateExceeded, InvalidCredentials; only DeviceNotRegistered
  it('real sendPushMessages removes NO device on non-registration errors and removes only DeviceNotRegistered tokens', async () => {
    const deletedTokens: string[] = [];
    const mockDb = {
      devices: {
        deleteMany: vi.fn(async (args: { where: { push_token: { in: string[] } } }) => {
          deletedTokens.push(...args.where.push_token.in);
          return { count: args.where.push_token.in.length };
        }),
      },
    };

    const mockFetch = createMockFetch(async () =>
      jsonResponse({
        data: [
          { status: 'error', message: 'Message too big', details: { error: 'MessageTooBig' } },
          { status: 'error', message: 'Rate exceeded', details: { error: 'MessageRateExceeded' } },
          { status: 'error', message: 'Invalid credentials', details: { error: 'InvalidCredentials' } },
          { status: 'ok', id: 'ticket-ok' },
          { status: 'error', message: 'Device not registered', details: { error: 'DeviceNotRegistered' } },
        ],
      }),
    );

    const messages: ExpoPushMessage[] = [
      { to: 'ExponentPushToken[too_big]', body: 'Too big' },
      { to: 'ExponentPushToken[rate_limit]', body: 'Rate' },
      { to: 'ExponentPushToken[invalid_cred]', body: 'Invalid' },
      { to: 'ExponentPushToken[ok_token]', body: 'OK' },
      { to: 'ExponentPushToken[unreg_device]', body: 'Unregistered' },
    ];

    const results = await sendPushMessages(messages, {
      fetchFn: mockFetch,
      db: mockDb,
      timeoutMs: 1_000,
    });

    expect(results.length).toBe(5);
    expect(mockDb.devices.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockDb.devices.deleteMany).toHaveBeenCalledWith({
      where: { push_token: { in: ['ExponentPushToken[unreg_device]'] } },
    });
    expect(deletedTokens).toEqual(['ExponentPushToken[unreg_device]']);
  });

  // 9e. Real getPushReceipts entry point removes NO device on non-registration errors and removes only DeviceNotRegistered tokens
  it('real getPushReceipts removes NO device on non-registration errors and removes only DeviceNotRegistered tokens', async () => {
    const deletedTokens: string[] = [];
    const mockDb = {
      devices: {
        deleteMany: vi.fn(async (args: { where: { push_token: { in: string[] } } }) => {
          deletedTokens.push(...args.where.push_token.in);
          return { count: args.where.push_token.in.length };
        }),
      },
    };

    const mockFetch = createMockFetch(async () =>
      jsonResponse({
        data: {
          't-1': { status: 'error', message: 'Message too big', details: { error: 'MessageTooBig' } },
          't-2': { status: 'error', message: 'Rate limit', details: { error: 'MessageRateExceeded' } },
          't-3': { status: 'error', message: 'Invalid credentials', details: { error: 'InvalidCredentials' } },
          't-4': { status: 'ok' },
          't-5': { status: 'error', message: 'Device not registered', details: { error: 'DeviceNotRegistered' } },
        },
      }),
    );

    const ticketToTokenMap = new Map([
      ['t-1', 'ExponentPushToken[too_big]'],
      ['t-2', 'ExponentPushToken[rate_limit]'],
      ['t-3', 'ExponentPushToken[invalid_cred]'],
      ['t-4', 'ExponentPushToken[ok_token]'],
      ['t-5', 'ExponentPushToken[unreg_device]'],
    ]);

    const receipts = await getPushReceipts(['t-1', 't-2', 't-3', 't-4', 't-5'], {
      fetchFn: mockFetch,
      db: mockDb,
      ticketToTokenMap,
      timeoutMs: 1_000,
    });

    expect(receipts.size).toBe(5);
    expect(mockDb.devices.deleteMany).toHaveBeenCalledTimes(1);
    expect(mockDb.devices.deleteMany).toHaveBeenCalledWith({
      where: { push_token: { in: ['ExponentPushToken[unreg_device]'] } },
    });
    expect(deletedTokens).toEqual(['ExponentPushToken[unreg_device]']);
  });

  // 10. Token masking helper
  it('masks push tokens properly without ever revealing the full token in logs', () => {
    expect(maskPushToken('ExponentPushToken[xyz1234567890]')).toBe('ExponentPushTok…');
    expect(maskPushToken('ExpoPushToken[xyz1234567890]')).toBe('ExpoPushToken[x…');
    expect(maskPushToken('short-token')).toBe('shor…');
    expect(maskPushToken('')).toBe('…');
  });

  // 11. Expo Access Token header
  it('includes Authorization header when accessToken is provided and omits when empty', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const mockFetch = createMockFetch(async (_url, init) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return jsonResponse({ data: [{ status: 'ok', id: 'auth-header-ticket' }] });
    });

    // 1. With token
    await sendPushMessages(
      [{ to: 'ExponentPushToken[tok1]', body: 'Test' }],
      { fetchFn: mockFetch, accessToken: 'test-secret-expo-access-token' },
    );
    expect(capturedHeaders?.Authorization).toBe('Bearer test-secret-expo-access-token');

    // 2. Empty token
    await sendPushMessages(
      [{ to: 'ExponentPushToken[tok1]', body: 'Test' }],
      { fetchFn: mockFetch, accessToken: '' },
    );
    expect(capturedHeaders?.Authorization).toBeUndefined();
  });
});

