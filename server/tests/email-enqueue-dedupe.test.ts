// Deterministic test for email enqueue deduplication and dedupeKey handling (Fix dropped re-invites).
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueEmail } from '../src/jobs/email/enqueue.ts';
import { closeAllQueues, getQueue, jobId } from '../src/jobs/queues.ts';
import { fingerprint } from '../src/security/fingerprint.ts';

describe('email enqueue deduplication (fix dropped re-invites)', () => {
  const FIXED_EPOCH_SECONDS = 1_700_000_000;
  const FIXED_NOW_MS = FIXED_EPOCH_SECONDS * 1_000;
  const createdJobIds: string[] = [];

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS);
  });

  afterEach(async () => {
    const queue = getQueue('email');
    for (const id of createdJobIds) {
      await queue.remove(id).catch(() => undefined);
    }
    createdJobIds.length = 0;
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await closeAllQueues();
  });

  it('two enqueues for the same kind and recipient with NO dedupeKey in the same second still produce ONE job', async () => {
    const queue = getQueue('email');
    const email = `test-dedupe-none-${randomUUID()}@example.com`;

    const expectedJobId = jobId(
      `email-teamInvite-${fingerprint(email).slice(0, 16)}`,
      FIXED_EPOCH_SECONDS,
    );
    createdJobIds.push(expectedJobId);

    await enqueueEmail({
      kind: 'teamInvite',
      email,
      teamName: 'Team A',
      inviterName: 'Inviter 1',
      role: 'staff',
      token: 'tok-first',
    });

    await enqueueEmail({
      kind: 'teamInvite',
      email,
      teamName: 'Team A',
      inviterName: 'Inviter 1',
      role: 'staff',
      token: 'tok-second',
    });

    const job = await queue.getJob(expectedJobId);
    expect(job).toBeDefined();
    expect(job?.id).toBe(expectedJobId);
    expect((job?.data as { token?: string })?.token).toBe('tok-first');

    const jobs = await queue.getJobs(['waiting', 'delayed', 'active']);
    const matching = jobs.filter((j) => (j.data as { email?: string })?.email === email);
    expect(matching).toHaveLength(1);
  });

  it('two enqueues for the same recipient with DIFFERENT dedupeKeys in the same second produce TWO jobs', async () => {
    const queue = getQueue('email');
    const email = `test-dedupe-diff-${randomUUID()}@example.com`;
    const key1 = `selector-${randomUUID()}`;
    const key2 = `selector-${randomUUID()}`;

    const expectedId1 = jobId(
      `email-teamInvite-${fingerprint(`${email}-${key1}`).slice(0, 16)}`,
      FIXED_EPOCH_SECONDS,
    );
    const expectedId2 = jobId(
      `email-teamInvite-${fingerprint(`${email}-${key2}`).slice(0, 16)}`,
      FIXED_EPOCH_SECONDS,
    );
    // Also track the unkeyed ID so cleanup works even if tested against old code
    const unkeyedId = jobId(
      `email-teamInvite-${fingerprint(email).slice(0, 16)}`,
      FIXED_EPOCH_SECONDS,
    );
    createdJobIds.push(expectedId1, expectedId2, unkeyedId);

    expect(expectedId1).not.toBe(expectedId2);

    await enqueueEmail(
      {
        kind: 'teamInvite',
        email,
        teamName: 'Team B',
        inviterName: 'Inviter B',
        role: 'staff',
        token: 'tok-invite-1',
      },
      { dedupeKey: key1 },
    );

    await enqueueEmail(
      {
        kind: 'teamInvite',
        email,
        teamName: 'Team B',
        inviterName: 'Inviter B',
        role: 'staff',
        token: 'tok-invite-2',
      },
      { dedupeKey: key2 },
    );

    const job1 = await queue.getJob(expectedId1);
    const job2 = await queue.getJob(expectedId2);

    expect(job1).toBeDefined();
    expect(job2).toBeDefined();
    expect((job1?.data as { token?: string })?.token).toBe('tok-invite-1');
    expect((job2?.data as { token?: string })?.token).toBe('tok-invite-2');

    const jobs = await queue.getJobs(['waiting', 'delayed', 'active']);
    const matching = jobs.filter((j) => (j.data as { email?: string })?.email === email);
    expect(matching).toHaveLength(2);
  });

  it('two enqueues with the SAME dedupeKey in the same second produce ONE job', async () => {
    const queue = getQueue('email');
    const email = `test-dedupe-same-${randomUUID()}@example.com`;
    const key = `selector-${randomUUID()}`;

    const expectedJobId = jobId(
      `email-teamInvite-${fingerprint(`${email}-${key}`).slice(0, 16)}`,
      FIXED_EPOCH_SECONDS,
    );
    createdJobIds.push(expectedJobId);

    await enqueueEmail(
      {
        kind: 'teamInvite',
        email,
        teamName: 'Team C',
        inviterName: 'Inviter C',
        role: 'staff',
        token: 'tok-invite-first',
      },
      { dedupeKey: key },
    );

    await enqueueEmail(
      {
        kind: 'teamInvite',
        email,
        teamName: 'Team C',
        inviterName: 'Inviter C',
        role: 'staff',
        token: 'tok-invite-second',
      },
      { dedupeKey: key },
    );

    const job = await queue.getJob(expectedJobId);
    expect(job).toBeDefined();
    expect(job?.id).toBe(expectedJobId);
    expect((job?.data as { token?: string })?.token).toBe('tok-invite-first');

    const jobs = await queue.getJobs(['waiting', 'delayed', 'active']);
    const matching = jobs.filter((j) => (j.data as { email?: string })?.email === email);
    expect(matching).toHaveLength(1);
  });
});

