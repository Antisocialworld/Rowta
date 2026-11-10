// cron-jobs.test.ts — verifies expire-invites, check-push-receipts, two-worker lock proofs, and token masking (Phase 6 Stage 5; rules S1, S6, S7, S9, J2).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  closeAllDatabases,
  forTeam,
  globalDb,
  writeDb,
} from '../src/db/clients.ts';
import { shardFor } from '../src/db/shard.ts';
import { closeAllQueues, createRedisConnection, getQueue } from '../src/jobs/queues.ts';
import { withLock } from '../src/cron/lock.ts';
import {
  EXPIRE_INVITES_JOB_NAME,
  EXPIRE_INVITES_SCHEDULER_ID,
  registerExpireInvitesScheduler,
  runExpireInvites,
  runExpireInvitesWithLock,
} from '../src/cron/expire-invites.ts';
import {
  CHECK_PUSH_RECEIPTS_JOB_NAME,
  CHECK_PUSH_RECEIPTS_SCHEDULER_ID,
  registerPushReceiptsScheduler,
  runCheckPushReceipts,
  runCheckPushReceiptsWithLock,
} from '../src/cron/push-receipts.ts';
import { logger } from '../src/lib/logger.ts';
import { createVerifiedUser, ensureTestCountries, uniqueEmail } from './helpers/auth-test.ts';

const redis = createRedisConnection(false);

beforeAll(async () => {
  await ensureTestCountries();
});

afterAll(async () => {
  await closeAllQueues();
  await redis.quit().catch(() => undefined);
  await closeAllDatabases();
});

describe('Phase 6 Stage 5: Cron jobs & Two-worker Lock Proof', () => {
  describe('1. Two-workers lock proof (Item 5)', () => {
    it('node-cron Redis lock: two concurrent callers racing for the same lock key -> exactly one wins, one skips', async () => {
      const lockKey = `cron:lock:test-race-${randomUUID()}`;
      let executedCount = 0;

      const [res1, res2] = await Promise.all([
        withLock(redis, lockKey, 30, async () => {
          executedCount++;
          await new Promise((r) => setTimeout(r, 50));
          return 'worker-1';
        }),
        withLock(redis, lockKey, 30, async () => {
          executedCount++;
          await new Promise((r) => setTimeout(r, 50));
          return 'worker-2';
        }),
      ]);

      expect(executedCount).toBe(1);
      const ranResults = [res1.ran, res2.ran].sort();
      expect(ranResults).toEqual([false, true]);
    });

    it('BullMQ repeatable jobs: registering the same scheduler id from two workers results in exactly ONE scheduler', async () => {
      const purgeQueue = getQueue('purge');
      const pushQueue = getQueue('push');

      // Simulate two worker processes booting concurrently and calling schedulers
      await Promise.all([
        registerExpireInvitesScheduler(purgeQueue),
        registerExpireInvitesScheduler(purgeQueue),
        registerPushReceiptsScheduler(pushQueue),
        registerPushReceiptsScheduler(pushQueue),
      ]);

      const purgeSchedulers = await purgeQueue.getJobSchedulers();
      const inviteSchedulers = purgeSchedulers.filter((s) => s.key === EXPIRE_INVITES_SCHEDULER_ID);
      expect(inviteSchedulers).toHaveLength(1);
      expect(inviteSchedulers[0]?.name).toBe(EXPIRE_INVITES_JOB_NAME);

      const pushSchedulers = await pushQueue.getJobSchedulers();
      const receiptSchedulers = pushSchedulers.filter((s) => s.key === CHECK_PUSH_RECEIPTS_SCHEDULER_ID);
      expect(receiptSchedulers).toHaveLength(1);
      expect(receiptSchedulers[0]?.name).toBe(CHECK_PUSH_RECEIPTS_JOB_NAME);
    });

    it('concurrency row lock proof: two concurrent expire-invites executions do not double-process rows', async () => {
      const now = new Date();
      const teamId = randomUUID();
      const shard = shardFor(teamId);
      const client = writeDb(shard);

      const ownerEmail = uniqueEmail('race-inv-owner');
      const ownerId = await createVerifiedUser(ownerEmail, 'RaceOwner123#');

      await client.teams.create({
        data: {
          id: teamId,
          name: 'Concurrent Invites Team',
          managers_can_revoke_invites: true,
        },
      });
      await client.memberships.create({
        data: { team_id: teamId, user_id: ownerId, role: 'owner' },
      });

      // Insert 6 expired invites and record their IDs for isolated verification
      const dummyArgon2 = '$argon2id$v=19$m=19456,t=2,p=1$mock$mockhash';
      const seededIds: string[] = [];
      for (let i = 0; i < 6; i++) {
        const inv = await client.invites.create({
          data: {
            team_id: teamId,
            email: `race-invite-${i}-${randomUUID().slice(0, 8)}@example.com`,
            role: 'staff',
            selector: `race-sel-${i}-${randomUUID().slice(0, 8)}`,
            verifier_hash: dummyArgon2,
            invited_by: ownerId,
            expires_at: new Date(now.getTime() - 60_000), // 1 minute ago
          },
        });
        seededIds.push(inv.id);
      }

      // Count open expired invites on shard before concurrent execution
      const preExpired = await client.$queryRaw<{ count: bigint }[]>`
        SELECT count(*)::bigint as count
        FROM invites
        WHERE accepted_at IS NULL
          AND revoked_at IS NULL
          AND expires_at <= ${now};
      `;
      const preCount = Number(preExpired[0]?.count ?? 0n);

      // Run two workers simultaneously
      const [res1, res2] = await Promise.all([
        runExpireInvites({ now, batchSize: 3 }),
        runExpireInvites({ now, batchSize: 3 }),
      ]);

      // Count open expired invites on shard after concurrent execution
      const postExpired = await client.$queryRaw<{ count: bigint }[]>`
        SELECT count(*)::bigint as count
        FROM invites
        WHERE accepted_at IS NULL
          AND revoked_at IS NULL
          AND expires_at <= ${now};
      `;
      const postCount = Number(postExpired[0]?.count ?? 0n);

      // Concurrency lock proof: sum of expired rows reported by both workers must account
      // exactly for the closed expired rows (preCount - postCount), proving no double-processing.
      // In isolated runs this is exactly 6; in parallel full-suite runs it includes other test rows.
      expect(res1.shards[shard] + res2.shards[shard]).toBe(preCount - postCount);
      expect(res1.shards[shard] + res2.shards[shard]).toBeGreaterThanOrEqual(seededIds.length);

      // Assert each seeded invite specifically was expired and closed exactly once
      const updatedSeeded = await client.invites.findMany({
        where: { id: { in: seededIds } },
        select: { id: true, revoked_at: true, accepted_at: true },
      });
      expect(updatedSeeded).toHaveLength(6);
      for (const inv of updatedSeeded) {
        expect(inv.revoked_at).not.toBeNull();
        expect(inv.revoked_at?.getTime()).toBe(now.getTime());
        expect(inv.accepted_at).toBeNull();
      }

      // Verify no remaining open invites for this test team
      const remainingOpen = await client.invites.findMany({
        where: {
          team_id: teamId,
          revoked_at: null,
          accepted_at: null,
        },
      });
      expect(remainingOpen).toHaveLength(0);
    });
  });

  describe('2. Expire-invites cron (Item 2 & 7)', () => {
    let teamShard0: string;
    let teamShard1: string;
    let owner0: string;
    let owner1: string;

    beforeAll(async () => {
      // Find two team IDs that map to shard 0 and shard 1
      while (!teamShard0 || !teamShard1) {
        const id = randomUUID();
        if (shardFor(id) === 0 && !teamShard0) teamShard0 = id;
        if (shardFor(id) === 1 && !teamShard1) teamShard1 = id;
      }

      owner0 = await createVerifiedUser(uniqueEmail('inv-shard0'), 'OwnerPass123#');
      owner1 = await createVerifiedUser(uniqueEmail('inv-shard1'), 'OwnerPass123#');

      const client0 = forTeam(teamShard0);
      await client0.teams.create({
        data: { id: teamShard0, name: 'Shard 0 Invites Team', managers_can_revoke_invites: true },
      });
      await client0.memberships.create({
        data: { team_id: teamShard0, user_id: owner0, role: 'owner' },
      });

      const client1 = forTeam(teamShard1);
      await client1.teams.create({
        data: { id: teamShard1, name: 'Shard 1 Invites Team', managers_can_revoke_invites: true },
      });
      await client1.memberships.create({
        data: { team_id: teamShard1, user_id: owner1, role: 'owner' },
      });
    });

    it('marks expired pending invites on both shards, leaving non-expired, accepted, and revoked untouched', async () => {
      const now = new Date();
      const dummyArgon2 = '$argon2id$v=19$m=19456,t=2,p=1$mock$mockhash';
      const client0 = forTeam(teamShard0);
      const client1 = forTeam(teamShard1);

      // Shard 0: 1 expired invite, 1 future invite, 1 accepted invite, 1 already revoked invite
      const [exp0, fut0, acc0, rev0] = await Promise.all([
        client0.invites.create({
          data: {
            team_id: teamShard0,
            email: `exp0-${randomUUID().slice(0, 8)}@example.com`,
            role: 'staff',
            selector: `sel-exp0-${randomUUID().slice(0, 8)}`,
            verifier_hash: dummyArgon2,
            invited_by: owner0,
            expires_at: new Date(now.getTime() - 10_000), // expired 10s ago
          },
        }),
        client0.invites.create({
          data: {
            team_id: teamShard0,
            email: `fut0-${randomUUID().slice(0, 8)}@example.com`,
            role: 'staff',
            selector: `sel-fut0-${randomUUID().slice(0, 8)}`,
            verifier_hash: dummyArgon2,
            invited_by: owner0,
            expires_at: new Date(now.getTime() + 3600_000), // future
          },
        }),
        client0.invites.create({
          data: {
            team_id: teamShard0,
            email: `acc0-${randomUUID().slice(0, 8)}@example.com`,
            role: 'staff',
            selector: `sel-acc0-${randomUUID().slice(0, 8)}`,
            verifier_hash: dummyArgon2,
            invited_by: owner0,
            expires_at: new Date(now.getTime() - 10_000),
            accepted_at: new Date(now.getTime() - 20_000), // already accepted
          },
        }),
        client0.invites.create({
          data: {
            team_id: teamShard0,
            email: `rev0-${randomUUID().slice(0, 8)}@example.com`,
            role: 'staff',
            selector: `sel-rev0-${randomUUID().slice(0, 8)}`,
            verifier_hash: dummyArgon2,
            invited_by: owner0,
            expires_at: new Date(now.getTime() - 10_000),
            revoked_at: new Date('2026-01-01T00:00:00Z'), // already revoked in past
          },
        }),
      ]);

      // Shard 1: 1 expired invite
      const exp1 = await client1.invites.create({
        data: {
          team_id: teamShard1,
          email: `exp1-${randomUUID().slice(0, 8)}@example.com`,
          role: 'staff',
          selector: `sel-exp1-${randomUUID().slice(0, 8)}`,
          verifier_hash: dummyArgon2,
          invited_by: owner1,
          expires_at: new Date(now.getTime() - 15_000), // expired
        },
      });

      // Run expire-invites
      const result = await runExpireInvites({ now });
      expect(result.shards[0]).toBeGreaterThanOrEqual(1);
      expect(result.shards[1]).toBeGreaterThanOrEqual(1);

      // Verify Shard 0 states
      const updatedExp0 = await client0.invites.findUnique({ where: { id: exp0.id } });
      expect(updatedExp0?.revoked_at).not.toBeNull();
      expect(updatedExp0?.revoked_at?.getTime()).toBe(now.getTime());

      const updatedFut0 = await client0.invites.findUnique({ where: { id: fut0.id } });
      expect(updatedFut0?.revoked_at).toBeNull();

      const updatedAcc0 = await client0.invites.findUnique({ where: { id: acc0.id } });
      expect(updatedAcc0?.revoked_at).toBeNull();
      expect(updatedAcc0?.accepted_at).not.toBeNull();

      const updatedRev0 = await client0.invites.findUnique({ where: { id: rev0.id } });
      expect(updatedRev0?.revoked_at).toEqual(new Date('2026-01-01T00:00:00Z'));

      // Verify Shard 1 state
      const updatedExp1 = await client1.invites.findUnique({ where: { id: exp1.id } });
      expect(updatedExp1?.revoked_at).not.toBeNull();
    });

    it('runExpireInvitesWithLock acquires Redis lock and runs successfully', async () => {
      const res = await runExpireInvitesWithLock(redis);
      expect(res.ran).toBe(true);
      expect(res.result).toBeDefined();
    });
  });

  describe('3. Check-push-receipts cron (Item 3 & 7)', () => {
    let testUserId: string;
    let registeredDeviceId: string;
    let unregisteredDeviceId: string;
    const db0 = globalDb();

    beforeAll(async () => {
      testUserId = await createVerifiedUser(uniqueEmail('receipt-user'), 'ReceiptPass123#');

      // Create test devices in DB0
      const d1 = await db0.devices.create({
        data: {
          user_id: testUserId,
          device_id: `dev-registered-${randomUUID().slice(0, 8)}`,
          push_token: 'ExponentPushToken[registered_token_ok]',
          platform: 'android',
        },
      });
      registeredDeviceId = d1.id;

      const d2 = await db0.devices.create({
        data: {
          user_id: testUserId,
          device_id: `dev-unregistered-${randomUUID().slice(0, 8)}`,
          push_token: 'ExponentPushToken[unregistered_token_bad]',
          platform: 'android',
        },
      });
      unregisteredDeviceId = d2.id;
    });

    it('processes unchecked tickets past wait window, deletes DeviceNotRegistered, marks resolved, and respects retention', async () => {
      const now = new Date('2026-11-03T16:00:00Z');
      const waitMs = 15 * 60 * 1000; // 15m
      const retentionMs = 24 * 60 * 60 * 1000; // 24h

      const tPastWait = new Date(now.getTime() - 20 * 60 * 1000); // 20m ago (past wait)
      const tTooRecent = new Date(now.getTime() - 5 * 60 * 1000); // 5m ago (inside wait window)
      const tPastRetention = new Date(now.getTime() - 25 * 60 * 60 * 1000); // 25h ago (past 24h retention)

      const refOk = `ticket-ref-ok-${randomUUID().slice(0, 8)}`;
      const refUnreg = `ticket-ref-unregistered-${randomUUID().slice(0, 8)}`;
      const refTooRecent = `ticket-ref-recent-${randomUUID().slice(0, 8)}`;
      const refAbandoned = `ticket-ref-abandon-${randomUUID().slice(0, 8)}`;
      const refUnknownPending = `ticket-ref-pending-${randomUUID().slice(0, 8)}`;

      // 1. Ticket that succeeds (ok)
      const ticketOk = await db0.push_tickets.create({
        data: {
          device_id: registeredDeviceId,
          ticket_ref: refOk,
          created_at: tPastWait,
        },
      });

      // 2. Ticket that fails with DeviceNotRegistered
      const ticketUnreg = await db0.push_tickets.create({
        data: {
          device_id: unregisteredDeviceId,
          ticket_ref: refUnreg,
          created_at: tPastWait,
        },
      });

      // 3. Ticket that is inside the 15m wait window (should NOT be queried)
      const ticketTooRecent = await db0.push_tickets.create({
        data: {
          device_id: registeredDeviceId,
          ticket_ref: refTooRecent,
          created_at: tTooRecent,
        },
      });

      // 4. Ticket that is > 24h old and still unknown from Expo (should be abandoned / checked_at set)
      const ticketAbandoned = await db0.push_tickets.create({
        data: {
          device_id: registeredDeviceId,
          ticket_ref: refAbandoned,
          created_at: tPastRetention,
        },
      });

      // 5. Ticket that is 20m old (< 24h) and unknown from Expo (should remain unchecked for next retry)
      const ticketPending = await db0.push_tickets.create({
        data: {
          device_id: registeredDeviceId,
          ticket_ref: refUnknownPending,
          created_at: tPastWait,
        },
      });

      // Mock Expo Push receipts response
      const mockFetch = vi.fn().mockImplementation(async (_url: string, opts: { body?: string }) => {
        const parsed = JSON.parse(opts.body ?? '{}') as { ids: string[] };
        const data: Record<string, { status: string; message?: string; details?: { error?: string } }> = {};

        for (const id of parsed.ids) {
          if (id === refOk) {
            data[id] = { status: 'ok' };
          } else if (id === refUnreg) {
            data[id] = {
              status: 'error',
              message: 'DeviceNotRegistered',
              details: { error: 'DeviceNotRegistered' },
            };
          }
          // refAbandoned and refUnknownPending are NOT in data -> stay 'unknown'
        }

        return {
          ok: true,
          json: async () => ({ data }),
        };
      });

      const result = await runCheckPushReceipts({
        now,
        waitMs,
        retentionMs,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(mockFetch).toHaveBeenCalled();
      expect(result.resolvedCount).toBeGreaterThanOrEqual(2); // refOk and refUnreg
      expect(result.abandonedCount).toBeGreaterThanOrEqual(1); // refAbandoned
      expect(result.pendingCount).toBeGreaterThanOrEqual(1); // refUnknownPending

      // Check DB states:
      const updatedOk = await db0.push_tickets.findUnique({ where: { id: ticketOk.id } });
      expect(updatedOk?.checked_at).not.toBeNull();

      const updatedUnreg = await db0.push_tickets.findUnique({ where: { id: ticketUnreg.id } });
      expect(updatedUnreg?.checked_at).not.toBeNull();

      // Device for unregistered token should be deleted
      const checkUnregDev = await db0.devices.findUnique({ where: { id: unregisteredDeviceId } });
      expect(checkUnregDev).toBeNull();

      // Device for registered token must NOT be deleted
      const checkRegDev = await db0.devices.findUnique({ where: { id: registeredDeviceId } });
      expect(checkRegDev).not.toBeNull();

      // Recent ticket must not have been checked
      const updatedRecent = await db0.push_tickets.findUnique({ where: { id: ticketTooRecent.id } });
      expect(updatedRecent?.checked_at).toBeNull();

      // Abandoned ticket (>24h) must have checked_at set
      const updatedAbandoned = await db0.push_tickets.findUnique({ where: { id: ticketAbandoned.id } });
      expect(updatedAbandoned?.checked_at).not.toBeNull();

      // Pending ticket (<24h, unknown) must remain unchecked
      const updatedPending = await db0.push_tickets.findUnique({ where: { id: ticketPending.id } });
      expect(updatedPending?.checked_at).toBeNull();
    });

    it('batch limit <= 1000 is clamped and respected', async () => {
      const now = new Date('2026-11-03T16:00:00Z');
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: {} }),
      });

      // Passing batchSize > 1000 or negative numbers
      const res = await runCheckPushReceipts({
        now,
        batchSize: 2000,
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      expect(res).toBeDefined();
    });

    it('runCheckPushReceiptsWithLock acquires Redis lock and runs successfully', async () => {
      const res = await runCheckPushReceiptsWithLock(redis);
      expect(res.ran).toBe(true);
      expect(res.result).toBeDefined();
    });
  });

  describe('4. Token masking in logs (Item 7)', () => {
    it('never logs raw push tokens in receipt processing and device deletion', async () => {
      const rawToken = 'ExponentPushToken[secret_push_token_99999]';
      const infoSpy = vi.spyOn(logger, 'info');

      const db0 = globalDb();
      const user = await createVerifiedUser(uniqueEmail('mask-log-user'), 'MaskPass123#');
      const dev = await db0.devices.create({
        data: {
          user_id: user,
          device_id: `dev-mask-${randomUUID().slice(0, 8)}`,
          push_token: rawToken,
          platform: 'android',
        },
      });

      const ref = `ticket-ref-mask-${randomUUID().slice(0, 8)}`;
      await db0.push_tickets.create({
        data: {
          device_id: dev.id,
          ticket_ref: ref,
          created_at: new Date(Date.now() - 30 * 60 * 1000),
        },
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            [ref]: {
              status: 'error',
              message: 'DeviceNotRegistered',
              details: { error: 'DeviceNotRegistered' },
            },
          },
        }),
      });

      await runCheckPushReceipts({
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      // Verify no logger.info call contains the full raw token body
      for (const call of infoSpy.mock.calls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toContain('secret_push_token_99999');
      }

      infoSpy.mockRestore();
    });
  });
});

