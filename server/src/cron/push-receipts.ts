// Check-push-receipts cron job (PRD 8.11, rule J2; skill rowta-notifications-email-recipes).
// Runs every 15 minutes (*/15 * * * *).
// Queries unchecked push_tickets older than the Expo wait window (15m), fetches receipts in batches
// of <= 1000, removes invalid devices (DeviceNotRegistered), marks resolved receipts checked_at = now,
// and abandons unresolvable tickets past the 24h retention window.
// Concurrency safe with FOR UPDATE SKIP LOCKED and optional Redis lock.
// Never logs raw push tokens (rules S1, S9).
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { globalDb } from '../db/clients.ts';
import { getQueue } from '../jobs/queues.ts';
import { logger } from '../lib/logger.ts';
import {
  EXPO_RECEIPTS_BATCH_LIMIT,
  getPushReceipts,
  type PushClientDb,
} from '../push/client.ts';
import { withLock } from './lock.ts';

const log = logger.child({ module: 'cron', job: 'check-push-receipts' });

export const CHECK_PUSH_RECEIPTS_JOB_NAME = 'check-push-receipts';
export const CHECK_PUSH_RECEIPTS_SCHEDULER_ID = 'check-push-receipts-scheduler';
export const CHECK_PUSH_RECEIPTS_LOCK_KEY = 'cron:lock:check-push-receipts';
export const CHECK_PUSH_RECEIPTS_LOCK_TTL_SECONDS = 600;

/** Expo receipts take 15-30 minutes to become available. Wait 15 minutes before checking. */
export const EXPO_RECEIPT_WAIT_MS = 15 * 60 * 1000;

/** Expo retains receipts for 24 hours. Abandon unchecked tickets older than 24h. */
export const EXPO_RECEIPT_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface CheckPushReceiptsOptions {
  batchSize?: number;
  now?: Date;
  waitMs?: number;
  retentionMs?: number;
  db?: PushClientDb;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  accessToken?: string;
  maxBatches?: number;
}

export interface CheckPushReceiptsResult {
  checkedCount: number;
  resolvedCount: number;
  abandonedCount: number;
  pendingCount: number;
}

/**
 * Poll unchecked push tickets, retrieve receipts from Expo, remove DeviceNotRegistered devices,
 * and mark resolved tickets checked_at = now.
 */
export async function runCheckPushReceipts(
  options: CheckPushReceiptsOptions = {},
): Promise<CheckPushReceiptsResult> {
  const db = (options.db ?? globalDb()) as ReturnType<typeof globalDb>;
  const now = options.now ?? new Date();
  const waitMs = options.waitMs ?? EXPO_RECEIPT_WAIT_MS;
  const retentionMs = options.retentionMs ?? EXPO_RECEIPT_RETENTION_MS;
  const batchSize = Math.max(1, Math.min(options.batchSize ?? EXPO_RECEIPTS_BATCH_LIMIT, EXPO_RECEIPTS_BATCH_LIMIT));
  const maxBatches = options.maxBatches ?? 10;

  const waitCutoff = new Date(now.getTime() - waitMs);
  const retentionCutoff = new Date(now.getTime() - retentionMs);

  let totalChecked = 0;
  let totalResolved = 0;
  let totalAbandoned = 0;
  let totalPending = 0;

  for (let batch = 0; batch < maxBatches; batch++) {
    // Select unchecked tickets older than wait window, joining devices to build ticketToTokenMap
    const tickets = await db.$queryRaw<{ id: string; ticket_ref: string; created_at: Date; push_token: string | null }[]>`
      SELECT t.id::text, t.ticket_ref, t.created_at, d.push_token
      FROM push_tickets t
      LEFT JOIN devices d ON t.device_id = d.id
      WHERE t.checked_at IS NULL
        AND t.created_at <= ${waitCutoff}
      ORDER BY t.created_at ASC
      LIMIT ${batchSize}
      FOR UPDATE OF t SKIP LOCKED;
    `;

    if (tickets.length === 0) {
      break;
    }

    const ticketRefs = tickets.map((t) => t.ticket_ref);
    const ticketToTokenMap = new Map<string, string>();
    for (const t of tickets) {
      if (t.push_token) {
        ticketToTokenMap.set(t.ticket_ref, t.push_token);
      }
    }

    // Call getPushReceipts which queries Expo and handles removeInvalidDevices if DeviceNotRegistered
    const receipts = await getPushReceipts(ticketRefs, {
      db,
      ticketToTokenMap,
      fetchFn: options.fetchFn,
      timeoutMs: options.timeoutMs,
      accessToken: options.accessToken,
    });

    const toMarkChecked: string[] = [];

    for (const ticket of tickets) {
      const receipt = receipts.get(ticket.ticket_ref);
      const isResolved = receipt !== undefined && (receipt.status === 'ok' || receipt.status === 'error');
      const isPastRetention = new Date(ticket.created_at).getTime() <= retentionCutoff.getTime();

      if (isResolved || isPastRetention) {
        toMarkChecked.push(ticket.id);
        if (isResolved) {
          totalResolved++;
        } else {
          totalAbandoned++;
        }
      } else {
        // Unknown status and within retention window: leave checked_at NULL so next tick can retry
        totalPending++;
      }
    }

    if (toMarkChecked.length > 0) {
      await db.$executeRaw`
        UPDATE push_tickets
        SET checked_at = ${now}
        WHERE id = ANY(${toMarkChecked}::uuid[]);
      `;
      totalChecked += toMarkChecked.length;
    }

    if (tickets.length < batchSize) {
      break;
    }
  }

  log.info(
    {
      totalChecked,
      totalResolved,
      totalAbandoned,
      totalPending,
    },
    'check-push-receipts completed',
  );

  return {
    checkedCount: totalChecked,
    resolvedCount: totalResolved,
    abandonedCount: totalAbandoned,
    pendingCount: totalPending,
  };
}

/**
 * Run check-push-receipts wrapped in a distributed Redis lock.
 */
export async function runCheckPushReceiptsWithLock(
  redis: Redis,
  options: CheckPushReceiptsOptions = {},
): Promise<{ ran: boolean; result?: CheckPushReceiptsResult }> {
  return withLock(redis, CHECK_PUSH_RECEIPTS_LOCK_KEY, CHECK_PUSH_RECEIPTS_LOCK_TTL_SECONDS, () =>
    runCheckPushReceipts(options),
  );
}

/**
 * Register BullMQ repeatable scheduler on the push queue.
 * Uses upsertJobScheduler for idempotent registration across worker instances.
 */
export async function registerPushReceiptsScheduler(queue?: Queue): Promise<void> {
  const targetQueue = queue ?? getQueue('push');
  await targetQueue.upsertJobScheduler(
    CHECK_PUSH_RECEIPTS_SCHEDULER_ID,
    // PRD 8.11: */15 * * * * (every 15 minutes)
    { pattern: '*/15 * * * *' },
    { name: CHECK_PUSH_RECEIPTS_JOB_NAME, data: { entryName: 'check-push-receipts' } },
  );
}

