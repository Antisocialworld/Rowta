// Expo Push Client (Phase 6 Stage 3; PRD 8.7; rules S1, S9, S14, C2).
// Batch send (<= 100), receipt checks (<= 1000), DeviceNotRegistered cleanup, retry with backoff, token masking.
import { env } from '../config/env.ts';
import { globalDb } from '../db/clients.ts';
import { logger } from '../lib/logger.ts';

export const EXPO_PUSH_SEND_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_PUSH_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

export const EXPO_SEND_BATCH_LIMIT = 100;
export const EXPO_RECEIPTS_BATCH_LIMIT = 1_000;

export const EXPO_MAX_RETRIES = 3;
export const EXPO_INITIAL_BACKOFF_MS = 200;
export const EXPO_MAX_BACKOFF_MS = 2_000;
export const EXPO_REQUEST_TIMEOUT_MS = 10_000;

export interface ExpoPushMessage {
  to: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  badge?: number;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
}

export type PushTicketResult =
  | { status: 'ok'; ticketId: string }
  | { status: 'error'; message: string; code?: string; details?: { error?: string; [key: string]: unknown } }
  | { status: 'failed'; error: string; retryable: boolean };

export interface SendPushResultItem {
  token: string;
  ticket: PushTicketResult;
}

export type PushReceiptResult =
  | { status: 'ok' }
  | { status: 'error'; message: string; code?: string; details?: { error?: string; [key: string]: unknown } }
  | { status: 'unknown' };

export type PushClientDb = {
  devices: {
    deleteMany: (args: { where: { push_token: { in: string[] } } }) => Promise<{ count: number }>;
  };
};

export interface PushClientOptions {
  fetchFn?: typeof fetch;
  accessToken?: string;
  timeoutMs?: number;
  maxRetries?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  db?: PushClientDb;
  ticketToTokenMap?: ReadonlyMap<string, string>;
}

/**
 * Mask an Expo push token for logging (first 15 chars + '…').
 * Never logs or prints the full token (S1, S9).
 */
export function maskPushToken(token: string): string {
  if (!token) return '…';
  if (token.length <= 16) return `${token.slice(0, 4)}…`;
  return `${token.slice(0, 15)}…`;
}

function chunkArray<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateBackoff(attempt: number, initialMs: number, maxMs: number): number {
  const exp = Math.min(maxMs, initialMs * Math.pow(2, attempt));
  const jitter = Math.random() * 50;
  return exp + jitter;
}

function buildHeaders(accessToken?: string): Record<string, string> {
  const token = accessToken ?? env.EXPO_ACCESS_TOKEN;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
  };
  if (token && token.trim().length > 0) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

/**
 * Send push messages in batches of at most 100 to Expo Push API.
 * Retries on HTTP 429 or 5xx with exponential backoff and jitter.
 * Returns results in exact input order.
 */
export async function sendPushMessages(
  messages: readonly ExpoPushMessage[],
  options: PushClientOptions = {},
): Promise<SendPushResultItem[]> {
  if (messages.length === 0) return [];

  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? EXPO_REQUEST_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? EXPO_MAX_RETRIES;
  const initialBackoffMs = options.initialBackoffMs ?? EXPO_INITIAL_BACKOFF_MS;
  const maxBackoffMs = options.maxBackoffMs ?? EXPO_MAX_BACKOFF_MS;
  const headers = buildHeaders(options.accessToken);

  const batches = chunkArray(messages, EXPO_SEND_BATCH_LIMIT);
  const allResults: SendPushResultItem[] = [];

  for (const batch of batches) {
    let attempt = 0;
    let batchSuccess = false;
    let batchTickets: PushTicketResult[] = [];

    while (attempt <= maxRetries && !batchSuccess) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchFn(EXPO_PUSH_SEND_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify(batch),
          signal: controller.signal,
        });
        clearTimeout(timer);

        // 429 or 5xx: retryable failure
        if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
          attempt += 1;
          if (attempt <= maxRetries) {
            await sleep(calculateBackoff(attempt - 1, initialBackoffMs, maxBackoffMs));
            continue;
          }
          batchTickets = batch.map(() => ({
            status: 'failed' as const,
            error: `Expo push service temporarily unavailable (HTTP ${response.status})`,
            retryable: true,
          }));
          break;
        }

        // 4xx other than 429: non-retryable failure
        if (response.status >= 400 && response.status < 500) {
          batchTickets = batch.map(() => ({
            status: 'failed' as const,
            error: `Expo push request rejected (HTTP ${response.status})`,
            retryable: false,
          }));
          break;
        }

        const json = (await response.json()) as {
          data?: Array<{ status: string; id?: string; message?: string; details?: { error?: string } }>;
          errors?: Array<{ code: string; message: string }>;
        };

        if (Array.isArray(json.data)) {
          batchTickets = json.data.map((item) => {
            if (item.status === 'ok' && typeof item.id === 'string') {
              return { status: 'ok', ticketId: item.id };
            }
            return {
              status: 'error',
              message: item.message ?? 'Push notification delivery error',
              code: item.details?.error,
              details: item.details,
            };
          });
          // Ensure length matches batch in case response was shorter
          while (batchTickets.length < batch.length) {
            batchTickets.push({
              status: 'failed',
              error: 'Missing ticket in Expo response',
              retryable: false,
            });
          }
          batchSuccess = true;
        } else {
          // Top-level error object
          const topMsg = json.errors?.[0]?.message ?? 'Expo push API response error';
          batchTickets = batch.map(() => ({
            status: 'failed' as const,
            error: topMsg,
            retryable: false,
          }));
          break;
        }
      } catch (err: unknown) {
        clearTimeout(timer);
        attempt += 1;
        if (attempt <= maxRetries) {
          await sleep(calculateBackoff(attempt - 1, initialBackoffMs, maxBackoffMs));
          continue;
        }
        const isAbort = (err as { name?: string }).name === 'AbortError';
        batchTickets = batch.map(() => ({
          status: 'failed' as const,
          error: isAbort ? 'Expo push request timed out' : 'Expo push network error',
          retryable: true,
        }));
        break;
      }
    }

    for (let i = 0; i < batch.length; i += 1) {
      const msg = batch[i];
      if (!msg) continue;
      allResults.push({
        token: msg.to,
        ticket: batchTickets[i] ?? { status: 'failed', error: 'Unknown ticket state', retryable: false },
      });
    }
  }

  const unregisteredTokens = getUnregisteredTokensFromTickets(allResults);
  if (unregisteredTokens.length > 0) {
    await removeInvalidDevices(unregisteredTokens, options.db);
  }

  return allResults;
}

/**
 * Fetch push receipts in batches of at most 1000 from Expo Push API.
 * Missing ticket IDs in response stay 'unknown'.
 */
export async function getPushReceipts(
  ticketIds: readonly string[],
  options: PushClientOptions = {},
): Promise<Map<string, PushReceiptResult>> {
  const results = new Map<string, PushReceiptResult>();
  if (ticketIds.length === 0) return results;

  // Initialize all requested IDs to 'unknown'
  for (const id of ticketIds) {
    results.set(id, { status: 'unknown' });
  }

  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? EXPO_REQUEST_TIMEOUT_MS;
  const headers = buildHeaders(options.accessToken);
  const batches = chunkArray(ticketIds, EXPO_RECEIPTS_BATCH_LIMIT);

  for (const batch of batches) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchFn(EXPO_PUSH_RECEIPTS_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ids: batch }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        continue; // Keep as 'unknown'
      }

      const json = (await response.json()) as {
        data?: Record<string, { status: string; message?: string; details?: { error?: string } }>;
      };

      if (json.data && typeof json.data === 'object') {
        for (const [id, item] of Object.entries(json.data)) {
          if (item.status === 'ok') {
            results.set(id, { status: 'ok' });
          } else if (item.status === 'error') {
            results.set(id, {
              status: 'error',
              message: item.message ?? '',
              code: item.details?.error,
              details: item.details,
            });
          }
        }
      }
    } catch {
      clearTimeout(timer);
      // Retain as 'unknown' on error
    }
  }

  if (options.ticketToTokenMap && options.ticketToTokenMap.size > 0) {
    const unregisteredTokens = getUnregisteredTokensFromReceipts(results, options.ticketToTokenMap);
    if (unregisteredTokens.length > 0) {
      await removeInvalidDevices(unregisteredTokens, options.db);
    }
  }

  return results;
}

/**
 * Remove invalid device tokens (DeviceNotRegistered).
 * Hard deletes devices with these tokens and logs count + masked tokens.
 * Called only for DeviceNotRegistered errors, never for rate or formatting errors (Rule 11).
 */
export async function removeInvalidDevices(
  tokens: readonly string[],
  db: PushClientDb = globalDb(),
): Promise<number> {
  if (tokens.length === 0) return 0;

  const uniqueTokens = Array.from(new Set(tokens.filter((t) => t.trim().length > 0)));
  if (uniqueTokens.length === 0) return 0;

  const res = await db.devices.deleteMany({
    where: { push_token: { in: uniqueTokens } },
  });

  for (const token of uniqueTokens) {
    logger.info({ token: maskPushToken(token) }, 'Removed invalid device push token');
  }
  logger.info({ count: res.count }, 'Removed invalid devices (DeviceNotRegistered)');

  return res.count;
}

/**
 * Filter ticket results to identify only tokens that failed with DeviceNotRegistered.
 * Errors like MessageTooBig, MessageRateExceeded, and InvalidCredentials never remove a device.
 */
export function getUnregisteredTokensFromTickets(
  results: ReadonlyArray<{ token: string; ticket: PushTicketResult }>,
): string[] {
  const tokens: string[] = [];
  for (const r of results) {
    if (r.ticket.status === 'error' && r.ticket.code === 'DeviceNotRegistered') {
      tokens.push(r.token);
    }
  }
  return tokens;
}

/**
 * Filter receipt results to identify only tokens that failed with DeviceNotRegistered.
 * Errors like MessageTooBig, MessageRateExceeded, and InvalidCredentials never remove a device.
 */
export function getUnregisteredTokensFromReceipts(
  receipts: ReadonlyMap<string, PushReceiptResult>,
  ticketToTokenMap: ReadonlyMap<string, string>,
): string[] {
  const tokens: string[] = [];
  for (const [ticketId, receipt] of receipts.entries()) {
    if (receipt.status === 'error' && receipt.code === 'DeviceNotRegistered') {
      const token = ticketToTokenMap.get(ticketId);
      if (token) {
        tokens.push(token);
      }
    }
  }
  return tokens;
}


