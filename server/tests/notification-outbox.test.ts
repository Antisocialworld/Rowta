// notification-outbox.test.ts — verifies transactional outbox, deduplication, sweeper leases, quiet-hours deferral, retry/backoff, and payload privacy (Phase 6 Stage 4; rules S1, S6, S7, S9, C2, J1, J3).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type globalDb, teamTransaction, writeDb, type ShardTx } from '../src/db/clients.ts';
import { shardFor } from '../src/db/shard.ts';
import {
  claimDueOutboxRows,
  enqueueNotification,
  registerSweeperRepeatableJob,
  sweepShardOutbox,
  SWEEPER_REPEAT_INTERVAL_MS,
  SWEEPER_SCHEDULER_ID,
  type OutboxRow,
} from '../src/notifications/outbox.ts';
import { getQueue } from '../src/jobs/queues.ts';
import { maskPushToken, type ExpoPushMessage, type SendPushResultItem } from '../src/push/client.ts';

describe('notification outbox & sweeper', () => {
  const shard = 0; // Test on shard 0
  let testTeamId = randomUUID();
  while (shardFor(testTeamId) !== shard) {
    testTeamId = randomUUID();
  }
  const client = writeDb(shard);

  beforeAll(async () => {
    // Ensure clean state if table exists
    await client.$executeRaw`DELETE FROM notification_outbox WHERE recipient_user_id IN (
      SELECT id FROM users WHERE email LIKE 'outbox-test-%'
    )`.catch(() => undefined);
  });

  afterAll(async () => {
    // Cleanup any created rows
    await client.$executeRaw`DELETE FROM notification_outbox WHERE dedupe_key LIKE 'test:%'`.catch(() => undefined);
  });

  describe('1. Repeatable sweeper registration (Item 1)', () => {
    it('registers repeatable sweeper job idempotently on push queue (one repeatable job created)', async () => {
      const queue = getQueue('push');
      // Calling registerSweeperRepeatableJob multiple times must be idempotent
      await registerSweeperRepeatableJob(queue);
      await registerSweeperRepeatableJob(queue);

      const schedulers = await queue.getJobSchedulers();
      const sweeperSchedulers = schedulers.filter((s: { key: string }) => s.key === SWEEPER_SCHEDULER_ID);
      expect(sweeperSchedulers.length).toBe(1);
      expect(sweeperSchedulers[0]?.every).toBe(SWEEPER_REPEAT_INTERVAL_MS);
    });
  });

  describe('2. Transactional rollback', () => {
    it('forces a failure after outbox enqueue inside a teamTransaction; asserts no outbox row was written', async () => {
      const recipientUserId = randomUUID();
      const dedupeKey = `test:rollback:${randomUUID()}`;

      await expect(
        teamTransaction(testTeamId, async (tx: ShardTx) => {
          const enqueued = await enqueueNotification(tx, {
            recipientUserId,
            category: 'swap.requested',
            payload: { teamId: testTeamId, swapId: randomUUID(), shiftId: randomUUID() },
            dedupeKey,
          });
          expect(enqueued).toBe(true);

          // Force an intentional error to roll back transaction
          throw new Error('Simulated transaction rollback');
        }),
      ).rejects.toThrow('Simulated transaction rollback');

      // Verify row does not exist
      const rows = await client.$queryRaw<OutboxRow[]>`
        SELECT * FROM notification_outbox WHERE dedupe_key = ${dedupeKey}
      `;
      expect(rows.length).toBe(0);
    });
  });

  describe('3. Dedupe key', () => {
    it('enqueuing with the same dedupe_key twice results in ONE outbox row (ON CONFLICT DO NOTHING)', async () => {
      const recipientUserId = randomUUID();
      const dedupeKey = `test:dedupe:${randomUUID()}`;

      await teamTransaction(testTeamId, async (tx: ShardTx) => {
        const first = await enqueueNotification(tx, {
          recipientUserId,
          category: 'swap.requested',
          payload: { teamId: testTeamId, swapId: randomUUID(), shiftId: randomUUID() },
          dedupeKey,
        });
        expect(first).toBe(true);

        const second = await enqueueNotification(tx, {
          recipientUserId,
          category: 'swap.requested',
          payload: { teamId: testTeamId, swapId: randomUUID(), shiftId: randomUUID() },
          dedupeKey,
        });
        expect(second).toBe(false);
      });

      const rows = await client.$queryRaw<OutboxRow[]>`
        SELECT * FROM notification_outbox WHERE dedupe_key = ${dedupeKey}
      `;
      expect(rows.length).toBe(1);
    });
  });

  describe('4. Concurrent sweepers & Lease safety (Item 2)', () => {
    it('two sweepers claiming at the same time NEVER claim the same row (FOR UPDATE SKIP LOCKED)', async () => {
      const recipientUserId = randomUUID();
      const dedupeKey1 = `test:claim1:${randomUUID()}`;
      const dedupeKey2 = `test:claim2:${randomUUID()}`;

      await teamTransaction(testTeamId, async (tx: ShardTx) => {
        await enqueueNotification(tx, {
          recipientUserId,
          category: 'swap.requested',
          payload: { teamId: testTeamId, swapId: randomUUID(), shiftId: randomUUID() },
          dedupeKey: dedupeKey1,
        });
        await enqueueNotification(tx, {
          recipientUserId,
          category: 'swap.requested',
          payload: { teamId: testTeamId, swapId: randomUUID(), shiftId: randomUUID() },
          dedupeKey: dedupeKey2,
        });
      });

      // Run two claims concurrently
      const [claim1, claim2] = await Promise.all([
        claimDueOutboxRows(shard, { batchSize: 10, sweeperId: 'sweeper-1' }),
        claimDueOutboxRows(shard, { batchSize: 10, sweeperId: 'sweeper-2' }),
      ]);

      const ids1 = new Set(claim1.map((r) => r.id));
      const ids2 = new Set(claim2.map((r) => r.id));

      // There must be no intersection between the sets of claimed IDs
      for (const id of ids1) {
        expect(ids2.has(id)).toBe(false);
      }
    });

    it('a row reclaimed after lease expiry by another sweeper is NOT marked sent or overwritten by the old sweeper', async () => {
      const recipientUserId = randomUUID();
      const dedupeKey = `test:lease-reclaim:${randomUUID()}`;

      // 1. Enqueue outbox row
      await teamTransaction(testTeamId, async (tx: ShardTx) => {
        await enqueueNotification(tx, {
          recipientUserId,
          category: 'swap.requested',
          payload: { teamId: testTeamId, swapId: randomUUID(), shiftId: randomUUID() },
          dedupeKey,
        });
      });

      // 2. Sweeper 1 claims the row
      const claimed1 = await claimDueOutboxRows(shard, { batchSize: 1, sweeperId: 'sweeper-1' });
      const row1 = claimed1.find((r) => r.dedupe_key === dedupeKey);
      expect(row1).toBeDefined();

      // 3. Simulate sweeper 1 stalling past lease expiry, and sweeper 2 reclaiming the row
      const expiredTime = new Date(Date.now() - 180_000);
      await client.$executeRaw`
        UPDATE notification_outbox
        SET claimed_at = ${expiredTime}
        WHERE dedupe_key = ${dedupeKey};
      `;

      const claimed2 = await claimDueOutboxRows(shard, { batchSize: 1, sweeperId: 'sweeper-2', leaseSeconds: 120 });
      const row2 = claimed2.find((r) => r.dedupe_key === dedupeKey);
      expect(row2).toBeDefined();

      // Current row in DB is claimed by sweeper-2
      const current = await client.$queryRaw<Array<{ claimed_by: string; status: string }>>`
        SELECT claimed_by, status FROM notification_outbox WHERE dedupe_key = ${dedupeKey};
      `;
      expect(current[0]?.claimed_by).toBe('sweeper-2');
      expect(current[0]?.status).toBe('processing');

      // 4. Sweeper 1 wakes up and attempts guarded update with WHERE claimed_by = 'sweeper-1'
      const affected = await client.$executeRaw`
        UPDATE notification_outbox
        SET status = 'sent',
            sent_at = now(),
            claimed_at = NULL,
            claimed_by = NULL
        WHERE id = ${row1!.id}::uuid AND claimed_by = 'sweeper-1';
      `;
      expect(affected).toBe(0);

      // Verify row remains in processing under sweeper-2 and was NOT overwritten to sent
      const after = await client.$queryRaw<Array<{ claimed_by: string; status: string }>>`
        SELECT claimed_by, status FROM notification_outbox WHERE dedupe_key = ${dedupeKey};
      `;
      expect(after[0]?.claimed_by).toBe('sweeper-2');
      expect(after[0]?.status).toBe('processing');
    });
  });

  describe('5. Settings & Category toggles (Item 5)', () => {
    it('recipient with notify_swaps = false marks outbox row skipped with user_disabled_swaps and never sends push', async () => {
      const recipientUserId = randomUUID();
      const dedupeKey = `test:disabledswaps:${randomUUID()}`;

      const mockSettings = {
        user_id: recipientUserId,
        quiet_start: null,
        quiet_end: null,
        time_zone: 'UTC',
        notify_swaps: false, // Disabled
      };

      const mockDb0 = {
        user_settings: {
          findUnique: vi.fn().mockResolvedValue(mockSettings),
        },
        devices: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        push_tickets: {
          create: vi.fn(),
        },
      } as unknown as ReturnType<typeof globalDb>;

      await teamTransaction(testTeamId, async (tx: ShardTx) => {
        await enqueueNotification(tx, {
          recipientUserId,
          category: 'swap.requested',
          payload: { teamId: testTeamId, swapId: randomUUID(), shiftId: randomUUID() },
          dedupeKey,
        });
      });

      const sendMock = vi.fn();
      const result = await sweepShardOutbox(shard, {
        db0: mockDb0,
        sendPushFn: sendMock,
      });

      expect(result.skipped).toBeGreaterThanOrEqual(1);
      expect(sendMock).not.toHaveBeenCalled();

      const rows = await client.$queryRaw<Array<OutboxRow & { last_error: string }>>`
        SELECT * FROM notification_outbox WHERE dedupe_key = ${dedupeKey};
      `;
      expect(rows[0]?.status).toBe('skipped');
      expect(rows[0]?.last_error).toBe('user_disabled_swaps');
    });
  });

  describe('6. Quiet hours & urgent bypass', () => {
    it('recipient in quiet hours has deliver_after bumped to quiet-hours end and is NOT sent', async () => {
      const recipientUserId = randomUUID();
      const dedupeKey = `test:quiet:${randomUUID()}`;

      // Insert user_settings with quiet hours 22:00 - 08:00 UTC
      const mockSettings = {
        user_id: recipientUserId,
        quiet_start: new Date('1970-01-01T22:00:00Z'),
        quiet_end: new Date('1970-01-01T08:00:00Z'),
        time_zone: 'UTC',
        notify_swaps: true,
      };

      const mockDb0 = {
        user_settings: {
          findUnique: vi.fn().mockResolvedValue(mockSettings),
        },
        devices: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        push_tickets: {
          create: vi.fn(),
        },
      } as unknown as ReturnType<typeof globalDb>;

      await teamTransaction(testTeamId, async (tx: ShardTx) => {
        await enqueueNotification(tx, {
          recipientUserId,
          category: 'swap.requested',
          payload: { teamId: testTeamId, swapId: randomUUID(), shiftId: randomUUID() },
          dedupeKey,
        });
      });

      // Test at 23:00 UTC (inside quiet hours)
      const now = new Date('2026-11-03T23:00:00Z');
      const sendMock = vi.fn();

      const result = await sweepShardOutbox(shard, {
        db0: mockDb0,
        now,
        sendPushFn: sendMock,
      });

      expect(result.delayed).toBeGreaterThanOrEqual(1);
      expect(sendMock).not.toHaveBeenCalled();

      // Check row deliver_after was bumped
      const rows = await client.$queryRaw<OutboxRow[]>`
        SELECT * FROM notification_outbox WHERE dedupe_key = ${dedupeKey}
      `;
      expect(rows[0]?.status).toBe('pending');
      expect(rows[0]?.deliver_after).not.toBeNull();
    });

    it('urgent category (billing.restriction) bypasses quiet hours and sends immediately', async () => {
      const recipientUserId = randomUUID();
      const dedupeKey = `test:urgent:${randomUUID()}`;

      const mockSettings = {
        user_id: recipientUserId,
        quiet_start: new Date('1970-01-01T22:00:00Z'),
        quiet_end: new Date('1970-01-01T08:00:00Z'),
        time_zone: 'UTC',
        notify_swaps: true,
      };

      const mockDevice = {
        id: randomUUID(),
        user_id: recipientUserId,
        device_id: 'dev-1',
        push_token: 'ExponentPushToken[urgentToken1234567890]',
      };

      const mockDb0 = {
        user_settings: {
          findUnique: vi.fn().mockResolvedValue(mockSettings),
        },
        devices: {
          findMany: vi.fn().mockResolvedValue([mockDevice]),
        },
        push_tickets: {
          create: vi.fn().mockResolvedValue({}),
        },
      } as unknown as ReturnType<typeof globalDb>;

      await teamTransaction(testTeamId, async (tx: ShardTx) => {
        await enqueueNotification(tx, {
          recipientUserId,
          category: 'billing.restriction',
          payload: { teamId: testTeamId },
          dedupeKey,
        });
      });

      // Test at 23:00 UTC (inside quiet hours)
      const now = new Date('2026-11-03T23:00:00Z');
      const sendMock = vi.fn().mockResolvedValue([
        {
          token: mockDevice.push_token,
          ticket: { status: 'ok', ticketId: 'ticket-urgent-123' },
        },
      ]);

      const result = await sweepShardOutbox(shard, {
        db0: mockDb0,
        now,
        sendPushFn: sendMock,
      });

      expect(result.sent).toBeGreaterThanOrEqual(1);
      expect(sendMock).toHaveBeenCalledTimes(1);

      const rows = await client.$queryRaw<OutboxRow[]>`
        SELECT * FROM notification_outbox WHERE dedupe_key = ${dedupeKey}
      `;
      expect(rows[0]?.status).toBe('sent');
    });
  });

  describe('7. Dead devices & Ticket failure classification (Item 4 & 11)', () => {
    it('permanent errors (MessageTooBig) mark outbox row failed immediately without retry', async () => {
      const recipientUserId = randomUUID();
      const dedupeKey = `test:perm-fail:${randomUUID()}`;

      const mockDevice = {
        id: randomUUID(),
        user_id: recipientUserId,
        device_id: 'dev-perm',
        push_token: 'ExponentPushToken[permToken1234567890]',
      };

      const mockDb0 = {
        user_settings: { findUnique: vi.fn().mockResolvedValue(null) },
        devices: { findMany: vi.fn().mockResolvedValue([mockDevice]) },
        push_tickets: { create: vi.fn() },
      } as unknown as ReturnType<typeof globalDb>;

      const now = new Date();
      await teamTransaction(testTeamId, async (tx: ShardTx) => {
        await enqueueNotification(tx, {
          recipientUserId,
          category: 'swap.requested',
          payload: { teamId: testTeamId, swapId: randomUUID(), shiftId: randomUUID() },
          dedupeKey,
        });
      });

      await client.$executeRaw`
        UPDATE notification_outbox
        SET next_attempt_at = ${now}
        WHERE dedupe_key = ${dedupeKey};
      `;

      // Real return shape matching SendPushResultItem from push/client.ts:34-37
      const sendMock = vi.fn().mockResolvedValue([
        {
          token: mockDevice.push_token,
          ticket: {
            status: 'error',
            message: 'Message too big',
            code: 'MessageTooBig',
            details: { error: 'MessageTooBig' },
          },
        },
      ] satisfies SendPushResultItem[]);

      const result = await sweepShardOutbox(shard, {
        db0: mockDb0,
        now,
        sendPushFn: sendMock,
      });

      expect(result.failed).toBeGreaterThanOrEqual(1);

      const rows = await client.$queryRaw<Array<OutboxRow & { last_error: string }>>`
        SELECT * FROM notification_outbox WHERE dedupe_key = ${dedupeKey};
      `;
      expect(rows[0]?.status).toBe('failed');
      expect(rows[0]?.last_error).toBe('MessageTooBig');
    });

    it('all DeviceNotRegistered errors mark outbox row skipped with device_not_registered', async () => {
      const recipientUserId = randomUUID();
      const dedupeKey = `test:dead-dev:${randomUUID()}`;

      const mockDevice = {
        id: randomUUID(),
        user_id: recipientUserId,
        device_id: 'dev-dead',
        push_token: 'ExponentPushToken[deadToken1234567890]',
      };

      const mockDb0 = {
        user_settings: { findUnique: vi.fn().mockResolvedValue(null) },
        devices: {
          findMany: vi.fn().mockResolvedValue([mockDevice]),
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        push_tickets: { create: vi.fn() },
      } as unknown as ReturnType<typeof globalDb>;

      const now = new Date();
      await teamTransaction(testTeamId, async (tx: ShardTx) => {
        await enqueueNotification(tx, {
          recipientUserId,
          category: 'swap.requested',
          payload: { teamId: testTeamId, swapId: randomUUID(), shiftId: randomUUID() },
          dedupeKey,
        });
      });

      await client.$executeRaw`
        UPDATE notification_outbox
        SET next_attempt_at = ${now}
        WHERE dedupe_key = ${dedupeKey};
      `;

      // Real return shape matching SendPushResultItem from push/client.ts:34-37
      const sendMock = vi.fn().mockResolvedValue([
        {
          token: mockDevice.push_token,
          ticket: {
            status: 'error',
            message: 'Device not registered',
            code: 'DeviceNotRegistered',
            details: { error: 'DeviceNotRegistered' },
          },
        },
      ] satisfies SendPushResultItem[]);

      const result = await sweepShardOutbox(shard, {
        db0: mockDb0,
        now,
        sendPushFn: sendMock,
      });

      expect(result.skipped).toBeGreaterThanOrEqual(1);

      const rows = await client.$queryRaw<Array<OutboxRow & { last_error: string }>>`
        SELECT * FROM notification_outbox WHERE dedupe_key = ${dedupeKey};
      `;
      expect(rows[0]?.status).toBe('skipped');
      expect(rows[0]?.last_error).toBe('device_not_registered');
    });

    it('retryable error (MessageRateExceeded) increments attempts and sets next_attempt_at in the future', async () => {
      const recipientUserId = randomUUID();
      const dedupeKey = `test:retry:${randomUUID()}`;

      const mockDevice = {
        id: randomUUID(),
        user_id: recipientUserId,
        device_id: 'dev-retry',
        push_token: 'ExponentPushToken[retryToken1234567890]',
      };

      const mockDb0 = {
        user_settings: { findUnique: vi.fn().mockResolvedValue(null) },
        devices: { findMany: vi.fn().mockResolvedValue([mockDevice]) },
        push_tickets: { create: vi.fn() },
      } as unknown as ReturnType<typeof globalDb>;

      const now = new Date();
      await teamTransaction(testTeamId, async (tx: ShardTx) => {
        await enqueueNotification(tx, {
          recipientUserId,
          category: 'swap.requested',
          payload: { teamId: testTeamId, swapId: randomUUID(), shiftId: randomUUID() },
          dedupeKey,
        });
      });

      await client.$executeRaw`
        UPDATE notification_outbox
        SET next_attempt_at = ${now}
        WHERE dedupe_key = ${dedupeKey};
      `;

      // Real return shape matching SendPushResultItem from push/client.ts:34-37
      const sendMock = vi.fn().mockResolvedValue([
        {
          token: mockDevice.push_token,
          ticket: {
            status: 'error',
            message: 'Rate exceeded',
            code: 'MessageRateExceeded',
            details: { error: 'MessageRateExceeded' },
          },
        },
      ] satisfies SendPushResultItem[]);

      const result = await sweepShardOutbox(shard, {
        db0: mockDb0,
        now,
        sendPushFn: sendMock,
      });

      expect(result.failed).toBeGreaterThanOrEqual(1);

      const rows = await client.$queryRaw<Array<OutboxRow & { next_attempt_at: Date; last_error: string }>>`
        SELECT * FROM notification_outbox WHERE dedupe_key = ${dedupeKey};
      `;
      expect(rows[0]?.status).toBe('pending');
      expect(rows[0]?.attempts).toBe(1);
      expect(rows[0]?.last_error).toBe('MessageRateExceeded');
      expect(rows[0]?.next_attempt_at.getTime()).toBeGreaterThan(now.getTime());
    });

    it('after max_attempts is reached, row status is marked failed', async () => {
      const recipientUserId = randomUUID();
      const dedupeKey = `test:max-attempts:${randomUUID()}`;

      const mockDevice = {
        id: randomUUID(),
        user_id: recipientUserId,
        device_id: 'dev-retry-max',
        push_token: 'ExponentPushToken[maxRetryToken1234567890]',
      };

      const mockDb0 = {
        user_settings: { findUnique: vi.fn().mockResolvedValue(null) },
        devices: { findMany: vi.fn().mockResolvedValue([mockDevice]) },
        push_tickets: { create: vi.fn() },
      } as unknown as ReturnType<typeof globalDb>;

      const now = new Date();
      // Insert row with attempts = 4, max_attempts = 5, next_attempt_at = now
      await client.$executeRaw`
        INSERT INTO notification_outbox (
          recipient_user_id, category, payload, dedupe_key, status, attempts, max_attempts, next_attempt_at
        ) VALUES (
          ${recipientUserId}::uuid, 'swap.requested', '{}'::jsonb, ${dedupeKey}, 'pending', 4, 5, ${now}
        );
      `;

      // Real return shape matching SendPushResultItem from push/client.ts:34-37
      const sendMock = vi.fn().mockResolvedValue([
        {
          token: mockDevice.push_token,
          ticket: {
            status: 'error',
            message: 'Rate exceeded',
            code: 'MessageRateExceeded',
            details: { error: 'MessageRateExceeded' },
          },
        },
      ] satisfies SendPushResultItem[]);

      const result = await sweepShardOutbox(shard, {
        db0: mockDb0,
        now,
        sendPushFn: sendMock,
      });

      expect(result.failed).toBeGreaterThanOrEqual(1);

      const rows = await client.$queryRaw<Array<OutboxRow & { attempts: number; last_error: string }>>`
        SELECT * FROM notification_outbox WHERE dedupe_key = ${dedupeKey};
      `;
      expect(rows[0]?.status).toBe('failed');
      expect(rows[0]?.attempts).toBe(5);
      expect(rows[0]?.last_error).toBe('MessageRateExceeded');
    });

    it('network or 5xx ticket failure (status failed, retryable true) increments attempts and sets backoff', async () => {
      const recipientUserId = randomUUID();
      const dedupeKey = `test:network-retry:${randomUUID()}`;

      const mockDevice = {
        id: randomUUID(),
        user_id: recipientUserId,
        device_id: 'dev-net-retry',
        push_token: 'ExponentPushToken[netRetryToken1234567890]',
      };

      const mockDb0 = {
        user_settings: { findUnique: vi.fn().mockResolvedValue(null) },
        devices: { findMany: vi.fn().mockResolvedValue([mockDevice]) },
        push_tickets: { create: vi.fn() },
      } as unknown as ReturnType<typeof globalDb>;

      const now = new Date();
      await teamTransaction(testTeamId, async (tx: ShardTx) => {
        await enqueueNotification(tx, {
          recipientUserId,
          category: 'swap.requested',
          payload: { teamId: testTeamId, swapId: randomUUID(), shiftId: randomUUID() },
          dedupeKey,
        });
      });

      await client.$executeRaw`
        UPDATE notification_outbox
        SET next_attempt_at = ${now}
        WHERE dedupe_key = ${dedupeKey};
      `;

      // Real return shape matching SendPushResultItem for network/5xx from client.ts:210-214
      const sendMock = vi.fn().mockResolvedValue([
        {
          token: mockDevice.push_token,
          ticket: {
            status: 'failed',
            error: 'Expo push service temporarily unavailable (HTTP 503)',
            retryable: true,
          },
        },
      ] satisfies SendPushResultItem[]);

      const result = await sweepShardOutbox(shard, {
        db0: mockDb0,
        now,
        sendPushFn: sendMock,
      });

      expect(result.failed).toBeGreaterThanOrEqual(1);

      const rows = await client.$queryRaw<Array<OutboxRow & { last_error: string }>>`
        SELECT * FROM notification_outbox WHERE dedupe_key = ${dedupeKey};
      `;
      expect(rows[0]?.status).toBe('pending');
      expect(rows[0]?.attempts).toBe(1);
      expect(rows[0]?.last_error).toBe('Expo push service temporarily unavailable (HTTP 503)');
    });

    it('recipient with 0 registered devices marks outbox row skipped with reason no_devices', async () => {
      const recipientUserId = randomUUID();
      const dedupeKey = `test:nodevices:${randomUUID()}`;

      const mockDb0 = {
        user_settings: { findUnique: vi.fn().mockResolvedValue(null) },
        devices: { findMany: vi.fn().mockResolvedValue([]) },
        push_tickets: { create: vi.fn() },
      } as unknown as ReturnType<typeof globalDb>;

      await teamTransaction(testTeamId, async (tx: ShardTx) => {
        await enqueueNotification(tx, {
          recipientUserId,
          category: 'swap.requested',
          payload: { teamId: testTeamId, swapId: randomUUID(), shiftId: randomUUID() },
          dedupeKey,
        });
      });

      const sendMock = vi.fn();
      const result = await sweepShardOutbox(shard, {
        db0: mockDb0,
        sendPushFn: sendMock,
      });

      expect(result.skipped).toBeGreaterThanOrEqual(1);
      expect(sendMock).not.toHaveBeenCalled();

      const rows = await client.$queryRaw<Array<OutboxRow & { last_error: string }>>`
        SELECT * FROM notification_outbox WHERE dedupe_key = ${dedupeKey};
      `;
      expect(rows[0]?.status).toBe('skipped');
      expect(rows[0]?.last_error).toBe('no_devices');
    });
  });

  describe('8. Payload privacy rule', () => {
    it('throws when personal data (name, email, note, reason, token) is placed in outbox payload', async () => {
      const recipientUserId = randomUUID();
      const forbiddenFields = [
        { name: 'John Doe' },
        { displayName: 'John' },
        { email: 'john@example.com' },
        { note: 'Shift note here' },
        { declineReason: 'Too busy' },
        { reason: 'Too busy' },
        { token: 'secret-tok' },
        { pushToken: 'ExponentPushToken[xxx]' },
      ];

      for (const field of forbiddenFields) {
        await expect(
          teamTransaction(testTeamId, async (tx: ShardTx) => {
            await enqueueNotification(tx, {
              recipientUserId,
              category: 'swap.requested',
              payload: {
                teamId: testTeamId,
                ...field,
              },
              dedupeKey: `test:privacy:${randomUUID()}`,
            });
          }),
        ).rejects.toThrow('Outbox payload cannot contain personal field');
      }
    });

    it('push message data contains ONLY IDs and category; no names, notes or decline reasons', async () => {
      const recipientUserId = randomUUID();
      const dedupeKey = `test:cleanpayload:${randomUUID()}`;

      const mockDevice = {
        id: randomUUID(),
        user_id: recipientUserId,
        device_id: 'dev-clean',
        push_token: 'ExponentPushToken[cleanToken1234567890]',
      };

      const mockDb0 = {
        user_settings: { findUnique: vi.fn().mockResolvedValue(null) },
        devices: { findMany: vi.fn().mockResolvedValue([mockDevice]) },
        push_tickets: { create: vi.fn().mockResolvedValue({}) },
      } as unknown as ReturnType<typeof globalDb>;

      const swapId = randomUUID();
      const shiftId = randomUUID();

      await teamTransaction(testTeamId, async (tx: ShardTx) => {
        await enqueueNotification(tx, {
          recipientUserId,
          category: 'swap.requested',
          payload: { teamId: testTeamId, swapId, shiftId },
          dedupeKey,
        });
      });

      let capturedMessages: ExpoPushMessage[] = [];
      const sendMock = vi.fn().mockImplementation((msgs: ExpoPushMessage[]) => {
        capturedMessages = msgs;
        return Promise.resolve([
          { token: mockDevice.push_token, ticket: { status: 'ok', ticketId: 'ticket-ok' } },
        ]);
      });

      await sweepShardOutbox(shard, {
        db0: mockDb0,
        sendPushFn: sendMock,
      });

      expect(capturedMessages.length).toBe(1);
      const msg = capturedMessages[0]!;
      expect(msg.data).toEqual({
        url: `rowta://teams/${testTeamId}/swaps/${swapId}`,
        category: 'swap.requested',
        teamId: testTeamId,
        swapId,
        shiftId,
      });

      // Assert no personal fields
      const dataKeys = Object.keys(msg.data as object);
      for (const forbidden of ['name', 'displayName', 'email', 'note', 'declineReason', 'reason', 'token']) {
        expect(dataKeys).not.toContain(forbidden);
      }
    });
  });

  describe('9. Token masking (Item 10)', () => {
    it('maskPushToken masks standard, non-standard, short and empty tokens without leaking token bodies', () => {
      const standardToken = 'ExponentPushToken[abcdef1234567890]';
      const maskedStandard = maskPushToken(standardToken);
      // Contract: starts with fixed 15-char prefix, ends with ellipsis, never contains token body
      expect(maskedStandard.startsWith('ExponentPushTok')).toBe(true);
      expect(maskedStandard.endsWith('…')).toBe(true);
      expect(maskedStandard).toBe('ExponentPushTok…');
      expect(maskedStandard).not.toContain('abcdef');
      expect(maskedStandard).not.toContain('1234567890');

      // Non-standard long token: starts with 15-char prefix, ends with ellipsis, does not leak body
      const nonStandard = 'CustomPushTokenFormatSecret12345';
      const maskedNonStandard = maskPushToken(nonStandard);
      expect(maskedNonStandard.startsWith('CustomPushToken')).toBe(true);
      expect(maskedNonStandard.endsWith('…')).toBe(true);
      expect(maskedNonStandard).toBe('CustomPushToken…');
      expect(maskedNonStandard).not.toContain('Secret');
      expect(maskedNonStandard).not.toContain('12345');

      // Short token (<= 16 chars): starts with 4-char prefix, ends with ellipsis, does not leak remainder
      const shortToken = 'device-secret-1';
      const maskedShort = maskPushToken(shortToken);
      expect(maskedShort).toBe('devi…');
      expect(maskedShort).not.toContain('secret');

      // Empty / non-standard input: does not throw, does not leak, returns '…'
      expect(maskPushToken('')).toBe('…');
    });
  });
});
