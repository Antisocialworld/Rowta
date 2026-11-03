// Transactional notification outbox & sweeper (Phase 6 Stage 4; rules S1, S9, C2, J1, J3).
//
// PRD requirements citations (verbatim):
//   - PRD line 33: "Push notifications for shift changes, swap requests and approvals."
//   - PRD line 177: "- `devices`: id, user_id, device_id (UNIQUE per user), push_token, platform, last_seen_at."
//   - PRD line 178: "- `user_settings`: user_id (PK), quiet_start, quiet_end, time_zone (IANA), notify_shift_changes, notify_swaps,"
//   - PRD line 182: "- `push_tickets`: id, device_id, ticket_ref, created_at, checked_at (receipt checks for push notifications)."
//   - PRD line 405: "- Sent from a background job, never in the request (C2)."
//   - PRD line 423-424: "inside quiet hours a non-urgent notification is DELAYED (BullMQ delayed job)"
//   - PRD line 494: "BullMQ queues for push, webhooks, email, renewals, purges; 5 attempts with exponential backoff"
//
// DESIGN DECISION:
//   The PRD specifies transactional notifications ("notifications in one transaction", line 328)
//   and background processing (line 405), but does NOT contain the word "outbox".
//   The `notification_outbox` table and sweeper pattern are an architectural design decision of
//   Phase 6 Stage 4 to ensure zero lost notifications and atomic commit with business changes across shards.
import { randomUUID } from 'node:crypto';
import type { Job, Queue } from 'bullmq';
import { globalDb, writeDb, type ShardTx } from '../db/clients.ts';
import { ALL_SHARDS, type Shard } from '../db/shard.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { getQueue } from '../jobs/queues.ts';
import { logger } from '../lib/logger.ts';
import { maskPushToken, sendPushMessages, type ExpoPushMessage, type PushTicketResult } from '../push/client.ts';
import { decideDelivery } from './quiet-hours.ts';

const log = logger.child({ module: 'notification-outbox' });

/** Default batch size for sweeper claiming. Small batch bounds processing time. */
export const DEFAULT_BATCH_SIZE = 10;

/**
 * Worst-case send duration calculation:
 * (1 initial + 3 retries = 4 attempts) * 10,000ms timeout + ~2,000ms backoff = 42s.
 * 120s lease provides almost 3x safety buffer over the single call worst-case (42s).
 */
export const DEFAULT_LEASE_SECONDS = 120;

/** Repeatable sweeper interval: 20 seconds. */
export const SWEEPER_REPEAT_INTERVAL_MS = 20_000;
export const SWEEPER_SCHEDULER_ID = 'sweep-outbox-scheduler';

export interface OutboxRow {
  id: string;
  recipient_user_id: string;
  category: string;
  payload: Record<string, unknown>;
  dedupe_key: string;
  status: 'pending' | 'processing' | 'sent' | 'skipped' | 'failed';
  attempts: number;
  max_attempts: number;
  deliver_after: Date | null;
}

export interface EnqueueNotificationParams {
  recipientUserId: string;
  category: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
}

const FORBIDDEN_PAYLOAD_KEYS = new Set([
  'name',
  'displayName',
  'email',
  'note',
  'declineReason',
  'reason',
  'token',
  'pushToken',
]);

const PERMANENT_PUSH_ERRORS = new Set(['MessageTooBig', 'InvalidCredentials']);

/**
 * Enqueue a notification in the transactional outbox on the shard database.
 * Executes within caller's transaction client (ShardTx).
 * Uses ON CONFLICT (dedupe_key) DO NOTHING to ensure database-level idempotency.
 * Enforces rule: IDs and category only; never personal data or tokens.
 */
export async function enqueueNotification(
  tx: ShardTx,
  params: EnqueueNotificationParams,
): Promise<boolean> {
  // Enforce payload privacy rule (Item 2)
  for (const key of Object.keys(params.payload)) {
    if (FORBIDDEN_PAYLOAD_KEYS.has(key)) {
      throw new Error(`Outbox payload cannot contain personal field "${key}"`);
    }
  }

  const payloadJson = JSON.stringify(params.payload);
  const rowsAffected = await tx.$executeRaw`
    INSERT INTO notification_outbox (
      recipient_user_id,
      category,
      payload,
      dedupe_key,
      status,
      attempts,
      max_attempts,
      next_attempt_at
    ) VALUES (
      ${params.recipientUserId}::uuid,
      ${params.category},
      ${payloadJson}::jsonb,
      ${params.dedupeKey},
      'pending',
      0,
      5,
      now()
    )
    ON CONFLICT (dedupe_key) DO NOTHING;
  `;

  return rowsAffected > 0;
}

export interface SweeperOptions {
  batchSize?: number;
  leaseSeconds?: number;
  sweeperId?: string;
  now?: Date;
  db0?: ReturnType<typeof globalDb>;
  sendPushFn?: typeof sendPushMessages;
}

/**
 * Claim due outbox rows for a specific shard using FOR UPDATE SKIP LOCKED inside an atomic UPDATE...RETURNING.
 * Respects BOTH next_attempt_at and deliver_after (a row is due only when both have passed).
 * Reclaims stale rows where status = 'processing' and claimed_at < now - leaseSeconds.
 */
export async function claimDueOutboxRows(
  shard: Shard,
  options: SweeperOptions = {},
): Promise<OutboxRow[]> {
  const client = writeDb(shard);
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  const now = options.now ?? new Date();
  const sweeperId = options.sweeperId ?? `sweeper-${randomUUID().slice(0, 8)}`;
  const staleCutoff = new Date(now.getTime() - leaseSeconds * 1000);

  const claimed = await client.$queryRaw<OutboxRow[]>`
    WITH due AS (
      SELECT id FROM notification_outbox
      WHERE (
        (status = 'pending' AND next_attempt_at <= ${now} AND (deliver_after IS NULL OR deliver_after <= ${now}))
        OR (status = 'processing' AND claimed_at < ${staleCutoff})
      )
      ORDER BY next_attempt_at ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE notification_outbox o
    SET status = 'processing',
        claimed_at = ${now},
        claimed_by = ${sweeperId}
    FROM due
    WHERE o.id = due.id
    RETURNING o.id, o.recipient_user_id, o.category, o.payload, o.dedupe_key, o.status, o.attempts, o.max_attempts, o.deliver_after;
  `;

  return claimed;
}

function getTicketErrorCode(ticket?: PushTicketResult): string {
  if (!ticket) return 'send_failed';
  if (ticket.status === 'error') {
    return ticket.code ?? (ticket.details?.error as string) ?? 'push_error';
  }
  if (ticket.status === 'failed') {
    return ticket.error;
  }
  return 'send_failed';
}

function getNotificationContent(category: string): { title: string; body: string } {
  switch (category) {
    case 'swap.requested':
      return { title: 'Shift swap requested', body: 'A colleague requested a shift swap.' };
    case 'swap.approved':
      return { title: 'Shift swap approved', body: 'Your shift swap request has been approved.' };
    case 'swap.rejected':
      return { title: 'Shift swap declined', body: 'Your shift swap request was declined.' };
    case 'swap.cancelled':
      return { title: 'Shift swap cancelled', body: 'A shift swap request was cancelled.' };
    default:
      return { title: 'Notification', body: 'You have a new update.' };
  }
}

function getDeepLinkUrl(category: string, payload: Record<string, unknown>): string {
  const teamId = typeof payload.teamId === 'string' ? payload.teamId : '';
  const swapId = typeof payload.swapId === 'string' ? payload.swapId : '';
  if (category.startsWith('swap.') && teamId && swapId) {
    return `rowta://teams/${teamId}/swaps/${swapId}`;
  }
  return 'rowta://dashboard';
}

function formatTimeString(date: Date | null): string | null {
  if (!date) return null;
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Sweep and deliver due outbox rows for a single shard.
 * Employs lease safety: re-checks claimed_by before marking any terminal status.
 */
export async function sweepShardOutbox(
  shard: Shard,
  options: SweeperOptions = {},
): Promise<{ processed: number; sent: number; skipped: number; delayed: number; failed: number }> {
  const client = writeDb(shard);
  const db0 = options.db0 ?? globalDb();
  const sendPushFn = options.sendPushFn ?? sendPushMessages;
  const now = options.now ?? new Date();
  const sweeperId = options.sweeperId ?? `sweeper-${randomUUID().slice(0, 8)}`;

  const rows = await claimDueOutboxRows(shard, { ...options, sweeperId, now });
  let sent = 0;
  let skipped = 0;
  let delayed = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      // 0. Refresh claimed_at per row to ensure lease freshness during batch processing
      const refreshed = await client.$executeRaw`
        UPDATE notification_outbox
        SET claimed_at = ${now}
        WHERE id = ${row.id}::uuid AND claimed_by = ${sweeperId} AND status = 'processing';
      `;
      if (refreshed === 0) {
        log.warn({ outboxId: row.id, sweeperId }, 'Row lease lost before processing; skipping');
        continue;
      }

      // 1. Check recipient user_settings in DB0
      const settings = await db0.user_settings.findUnique({
        where: { user_id: row.recipient_user_id },
      });

      // Check category toggle in settings: notify_swaps switched off
      if (row.category.startsWith('swap.') && settings && !settings.notify_swaps) {
        const updated = await client.$executeRaw`
          UPDATE notification_outbox
          SET status = 'skipped',
              last_error = 'user_disabled_swaps',
              claimed_at = NULL,
              claimed_by = NULL
          WHERE id = ${row.id}::uuid AND claimed_by = ${sweeperId};
        `;
        if (updated > 0) skipped += 1;
        continue;
      }

      // Check quiet hours
      const isUrgent = row.category.startsWith('billing.restriction');
      const quietStart = formatTimeString(settings?.quiet_start ?? null);
      const quietEnd = formatTimeString(settings?.quiet_end ?? null);
      const timeZone = settings?.time_zone ?? 'UTC';

      const decision = decideDelivery({
        now,
        timeZone,
        quietStart,
        quietEnd,
        urgent: isUrgent,
      });

      if (decision.action === 'delay') {
        const updated = await client.$executeRaw`
          UPDATE notification_outbox
          SET status = 'pending',
              deliver_after = ${decision.deliverAt},
              claimed_at = NULL,
              claimed_by = NULL
          WHERE id = ${row.id}::uuid AND claimed_by = ${sweeperId};
        `;
        if (updated > 0) delayed += 1;
        continue;
      }

      // 2. Resolve recipient's registered devices from DB0
      const devices = await db0.devices.findMany({
        where: { user_id: row.recipient_user_id },
      });

      const validDevices = devices.filter((d) => typeof d.push_token === 'string' && d.push_token.trim().length > 0);
      if (validDevices.length === 0) {
        const updated = await client.$executeRaw`
          UPDATE notification_outbox
          SET status = 'skipped',
              last_error = 'no_devices',
              claimed_at = NULL,
              claimed_by = NULL
          WHERE id = ${row.id}::uuid AND claimed_by = ${sweeperId};
        `;
        if (updated > 0) skipped += 1;
        continue;
      }

      // 3. Format push message with deep link
      const { title, body } = getNotificationContent(row.category);
      const url = getDeepLinkUrl(row.category, row.payload as Record<string, unknown>);

      log.debug(
        {
          outboxId: row.id,
          recipientUserId: row.recipient_user_id,
          devicesCount: validDevices.length,
          tokens: validDevices.map((d) => maskPushToken(d.push_token!)),
        },
        'Delivering notification to recipient devices',
      );

      const messages: ExpoPushMessage[] = validDevices.map((d) => ({
        to: d.push_token!,
        title,
        body,
        data: {
          url,
          category: row.category,
          ...(row.payload as Record<string, unknown>),
        },
      }));

      // 4. Send through Expo push client (options.db cleans up DeviceNotRegistered tokens)
      const results = await sendPushFn(messages, { db: db0 });

      // Record push_tickets for receipts cron
      for (const resItem of results) {
        if (resItem.ticket.status === 'ok' && resItem.ticket.ticketId) {
          const dev = validDevices.find((d) => d.push_token === resItem.token);
          if (dev) {
            await db0.push_tickets
              .create({
                data: {
                  device_id: dev.id,
                  ticket_ref: resItem.ticket.ticketId,
                },
              })
              .catch((err) => {
                if (!isUniqueViolation(err)) throw err;
              });
          }
        }
      }

      const anyOk = results.some((r) => r.ticket.status === 'ok');
      if (anyOk) {
        const updated = await client.$executeRaw`
          UPDATE notification_outbox
          SET status = 'sent',
              sent_at = ${now},
              claimed_at = NULL,
              claimed_by = NULL
          WHERE id = ${row.id}::uuid AND claimed_by = ${sweeperId};
        `;
        if (updated > 0) {
          sent += 1;
        } else {
          log.warn({ outboxId: row.id, sweeperId }, 'Row lease lost before marking sent; skipped update');
        }
      } else {
        // Evaluate classification of failure:
        // A. All devices unregistered -> mark skipped with 'device_not_registered' (devices already purged by sendPushMessages)
        const allUnregistered = results.every(
          (r) =>
            r.ticket.status === 'error' &&
            (r.ticket.code === 'DeviceNotRegistered' || r.ticket.details?.error === 'DeviceNotRegistered'),
        );

        if (allUnregistered) {
          const updated = await client.$executeRaw`
            UPDATE notification_outbox
            SET status = 'skipped',
                last_error = 'device_not_registered',
                claimed_at = NULL,
                claimed_by = NULL
            WHERE id = ${row.id}::uuid AND claimed_by = ${sweeperId};
          `;
          if (updated > 0) skipped += 1;
          continue;
        }

        // B. Permanent errors (MessageTooBig, InvalidCredentials) -> mark failed immediately without retry
        const permErr = results.find(
          (r) =>
            r.ticket.status === 'error' &&
            (PERMANENT_PUSH_ERRORS.has(r.ticket.code ?? '') ||
              PERMANENT_PUSH_ERRORS.has(String(r.ticket.details?.error ?? ''))),
        );

        if (permErr && permErr.ticket.status === 'error') {
          const errCode = permErr.ticket.code ?? String(permErr.ticket.details?.error ?? 'permanent_error');
          const updated = await client.$executeRaw`
            UPDATE notification_outbox
            SET status = 'failed',
                last_error = ${errCode},
                claimed_at = NULL,
                claimed_by = NULL
            WHERE id = ${row.id}::uuid AND claimed_by = ${sweeperId};
          `;
          if (updated > 0) failed += 1;
          continue;
        }

        // C. Retryable errors (MessageRateExceeded, network error, timeout, 5xx)
        const nextAttempts = row.attempts + 1;
        const retryErrCode = getTicketErrorCode(results[0]?.ticket);

        if (nextAttempts >= row.max_attempts) {
          const updated = await client.$executeRaw`
            UPDATE notification_outbox
            SET status = 'failed',
                attempts = ${nextAttempts},
                last_error = ${retryErrCode},
                claimed_at = NULL,
                claimed_by = NULL
            WHERE id = ${row.id}::uuid AND claimed_by = ${sweeperId};
          `;
          if (updated > 0) failed += 1;
        } else {
          const backoffSec = Math.min(2 ** nextAttempts * 5, 3600);
          const nextAttemptAt = new Date(now.getTime() + backoffSec * 1000);
          const updated = await client.$executeRaw`
            UPDATE notification_outbox
            SET status = 'pending',
                attempts = ${nextAttempts},
                next_attempt_at = ${nextAttemptAt},
                last_error = ${retryErrCode},
                claimed_at = NULL,
                claimed_by = NULL
            WHERE id = ${row.id}::uuid AND claimed_by = ${sweeperId};
          `;
          if (updated > 0) failed += 1;
        }
      }
    } catch (err: unknown) {
      log.error({ err, outboxId: row.id }, 'Error processing outbox row');
      const nextAttempts = row.attempts + 1;
      const backoffSec = Math.min(2 ** nextAttempts * 5, 3600);
      const nextAttemptAt = new Date(now.getTime() + backoffSec * 1000);

      await client.$executeRaw`
        UPDATE notification_outbox
        SET status = ${nextAttempts >= row.max_attempts ? 'failed' : 'pending'},
            attempts = ${nextAttempts},
            next_attempt_at = ${nextAttemptAt},
            last_error = 'exception',
            claimed_at = NULL,
            claimed_by = NULL
        WHERE id = ${row.id}::uuid AND claimed_by = ${sweeperId};
      `;
      failed += 1;
    }
  }

  return { processed: rows.length, sent, skipped, delayed, failed };
}

/**
 * Sweeper entry: sweeps all shards (iterates ALL_SHARDS).
 */
export async function sweepNotificationOutbox(
  options: SweeperOptions = {},
): Promise<{ processed: number; sent: number; skipped: number; delayed: number; failed: number }> {
  let totalProcessed = 0;
  let totalSent = 0;
  let totalSkipped = 0;
  let totalDelayed = 0;
  let totalFailed = 0;

  for (const shard of ALL_SHARDS) {
    const res = await sweepShardOutbox(shard, options);
    totalProcessed += res.processed;
    totalSent += res.sent;
    totalSkipped += res.skipped;
    totalDelayed += res.delayed;
    totalFailed += res.failed;
  }

  return {
    processed: totalProcessed,
    sent: totalSent,
    skipped: totalSkipped,
    delayed: totalDelayed,
    failed: totalFailed,
  };
}

/**
 * BullMQ processor for 'push' queue.
 */
export async function processPushJob(job: Job): Promise<unknown> {
  if (job.name === 'sweep-outbox') {
    return sweepNotificationOutbox();
  }
  log.info({ queue: job.queueName, jobId: job.id, jobName: job.name }, 'Push job processed');
  return { acknowledged: true };
}

/**
 * Register the outbox sweeper as an idempotent repeatable job scheduler on BullMQ 'push' queue.
 * Runs every SWEEPER_REPEAT_INTERVAL_MS (20s). Safe on worker restart and multiple instances.
 */
export async function registerSweeperRepeatableJob(queue?: Queue): Promise<void> {
  const targetQueue = queue ?? getQueue('push');
  await targetQueue.upsertJobScheduler(
    SWEEPER_SCHEDULER_ID,
    {
      every: SWEEPER_REPEAT_INTERVAL_MS,
    },
    {
      name: 'sweep-outbox',
      data: {},
      opts: {
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      },
    },
  );
}
