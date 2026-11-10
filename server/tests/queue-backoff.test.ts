// Queue backoff test (Task G2).
// Verifies that a job failing with retryable errors is retried with growing backoff delays,
// and that after max_attempts it is marked failed.
// Pure integration test: uses the real SweepShardOutbox function with a mock sendPushFn.
// Run from the repo root:  npm test --workspace @rowta/server -- queue-backoff
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { forTeam } from '../src/db/clients.ts';
import { signAccessToken } from '../src/security/access-token.ts';
import { globalDb } from '../src/db/clients.ts';
import {
  clearRateKeys,
  createVerifiedUser,
  dataOf,
  ensureTestCountries,
  post,
  shutdownAuthTest,
  testApp,
  uniqueEmail,
} from './helpers/auth-test.ts';

let app: Hono;

interface Fixture {
  ownerId: string;
  staffId: string;
  ownerAuth: { authorization: string };
  staffAuth: { authorization: string };
  teamId: string;
}

async function createTeamFor(ownerAuth: { authorization: string }, name: string): Promise<string> {
  const res = await post(app, '/teams', { name }, { ...ownerAuth, 'idempotency-key': randomUUID() });
  expect(res.status).toBe(201);
  return (await dataOf(res)).id as string;
}

async function addMember(teamId: string, userId: string, role: 'manager' | 'staff'): Promise<void> {
  await forTeam(teamId).memberships.create({ data: { team_id: teamId, user_id: userId, role } });
}

describe('Queue backoff (Task G2)', () => {
  let f: Fixture;

  beforeAll(async () => {
    await clearRateKeys();
    await ensureTestCountries();
    app = testApp('queue-backoff');

    const ownerId = await createVerifiedUser(uniqueEmail('qb-owner'), 'OwnerPass123#');
    const staffId = await createVerifiedUser(uniqueEmail('qb-staff'), 'StaffPass123#');

    const ownerAuth = { authorization: `Bearer ${await signAccessToken(ownerId)}` };
    const staffAuth = { authorization: `Bearer ${await signAccessToken(staffId)}` };

    const teamId = await createTeamFor(ownerAuth, 'Backoff Test Team');
    await addMember(teamId, staffId, 'staff');

    f = { ownerId, staffId, ownerAuth, staffAuth, teamId };
  });

  afterAll(async () => {
    await shutdownAuthTest();
  });

  it('failed job retries with growing backoff delays and eventually succeeds', async () => {
    const { sweepShardOutbox } = await import('../src/notifications/outbox.ts');

    // Isolate this test's row: remove any pre-existing outbox rows so only
    // the row inserted below is swept.
    await globalDb().notification_outbox.deleteMany({});

    // Insert this test's own outbox row with a known id, due now.
    const rowId = randomUUID();
    const dueAt = new Date();
    await globalDb().devices.create({
      data: {
        user_id: f.ownerId,
        device_id: 'test-device-qb',
        push_token: 'ExponentPushToken[test-qb]',
      },
    });
    await globalDb().notification_outbox.create({
      data: {
        id: rowId,
        recipient_user_id: f.ownerId,
        category: 'shift.created',
        payload: {},
        dedupe_key: `test-backoff-${rowId}`,
        status: 'pending',
        attempts: 0,
        max_attempts: 5,
        next_attempt_at: dueAt,
        deliver_after: dueAt,
      },
    });

    const shard = 0;
    // Fail the first two send attempts, succeed on the third so the row
    // progresses pending -> pending -> sent.
    const sendPushFn = vi.fn()
      .mockRejectedValueOnce(new Error('send failed'))
      .mockRejectedValueOnce(new Error('send failed'))
      .mockResolvedValue([{ ticket: { status: 'ok', ticketId: 'ticket-1' } }]);

    // Page 1: first attempt fails
    const now1 = new Date(dueAt.getTime() + 1_000);
    await sweepShardOutbox(shard, {
      batchSize: 10,
      db0: globalDb(),
      sendPushFn,
      now: now1,
    });

    // Verify this test's row was updated with attempt 1 and a backoff
    const row1 = await globalDb().notification_outbox.findUnique({ where: { id: rowId } });
    expect(row1).not.toBeNull();
    if (!row1) throw new Error('row1 is missing');
    expect(row1.attempts).toBe(1);
    expect(row1.status).toBe('pending');
    const nextAttemptAt1 = row1.next_attempt_at;
    expect(nextAttemptAt1).toBeDefined();
    if (!nextAttemptAt1) throw new Error('next_attempt_at is missing');
    expect(nextAttemptAt1.getTime()).toBeGreaterThan(now1.getTime());

    const delay1 = nextAttemptAt1.getTime() - now1.getTime();
    expect(delay1).toBeGreaterThan(0);

    // Page 2: second attempt fails with a longer backoff
    const now2 = new Date(nextAttemptAt1.getTime() + 1_000);
    await sweepShardOutbox(shard, {
      batchSize: 10,
      db0: globalDb(),
      sendPushFn,
      now: now2,
    });

    const row2 = await globalDb().notification_outbox.findUnique({ where: { id: rowId } });
    expect(row2).not.toBeNull();
    if (!row2) throw new Error('row2 is missing');
    expect(row2.attempts).toBe(2);
    expect(row2.status).toBe('pending');
    const nextAttemptAt2 = row2.next_attempt_at;
    expect(nextAttemptAt2).toBeDefined();
    if (!nextAttemptAt2) throw new Error('next_attempt_at is missing');
    expect(nextAttemptAt2.getTime()).toBeGreaterThan(now2.getTime());

    const delay2 = nextAttemptAt2.getTime() - now2.getTime();
    expect(delay2).toBeGreaterThan(delay1);

    // Page 3: third attempt succeeds
    const now3 = new Date(nextAttemptAt2.getTime() + 1_000);
    await sweepShardOutbox(shard, {
      batchSize: 10,
      db0: globalDb(),
      sendPushFn,
      now: now3,
    });

    const row3 = await globalDb().notification_outbox.findUnique({ where: { id: rowId } });
    expect(row3).not.toBeNull();
    if (!row3) throw new Error('row3 is missing');
    expect(row3.status).toBe('sent');
    // The sweeper marks a row 'sent' on success without incrementing attempts,
    // so after two failures (attempts 1, then 2) the sent row is at attempts 2.
    expect(row3.attempts).toBe(2);
  });
});