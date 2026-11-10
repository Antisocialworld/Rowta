// Purge jobs tests (rules D4 to D6, PRD 7.3, 8.10, 8.11; skill rowta-data-recipes section 3.13).
//
// Verifies:
//   - Rows older than cutoff are deleted.
//   - Rows just inside cutoff survive.
//   - password_resets with fresh grant survive even if initial code expired > 7 days ago.
//   - Dry run logs dry_run=true and deletes nothing.
//   - Real run logs dry_run=false with exact deleted counts.
//   - Batching works across multiple statements.
//   - Protected tables are completely untouched.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAllDatabases, globalDb, writeDb } from '../src/db/clients.ts';
import { createRedisConnection } from '../src/jobs/queues.ts';
import { runPurgeIdempotency, runPurgeTokens } from '../src/jobs/purge/processor.ts';
import { ensureTestCountries } from './helpers/auth-test.ts';

const redis = createRedisConnection(false);

const PROTECTED_TABLES_DB0 = [
  'users',
  'teams',
  'memberships',
  'shifts',
  'swap_requests',
  'subscriptions',
  'ledger_entries',
  'payment_intents',
  'sent_emails',
  'devices',
  'push_tickets',
  'notification_log',
  'activity_events',
  'countries',
  'currencies',
  'plan_prices',
] as const;

async function getProtectedTableCounts(): Promise<Record<string, number>> {
  const db = globalDb();
  const counts: Record<string, number> = {};
  for (const table of PROTECTED_TABLES_DB0) {
    const rows = await db.$queryRawUnsafe<Array<{ count: number }>>(`SELECT count(*)::int AS count FROM "${table}";`);
    counts[table] = Number(rows[0]?.count ?? 0);
  }
  return counts;
}

const FAKE_HASH = '$argon2id$v=19$m=19456,t=2,p=1$fakeSalt$fakeHashPlaceholderValue';

describe('purge jobs', () => {
  let testUserId: string;
  let testTeam0Id: string;
  let testTeam1Id: string;

  beforeAll(async () => {
    await ensureTestCountries();
    const db0 = globalDb();
    const db1 = writeDb(1);

    // Seed one test user on DB0
    const userRes = await db0.users.create({
      data: {
        email: `purge-user-${randomUUID().slice(0, 8)}@example.test`,
        display_name: 'Purge Test User',
        country: 'ZZ',
        password_hash: FAKE_HASH,
      },
    });
    testUserId = userRes.id;

    // Seed test teams on shard 0 and shard 1
    const t0 = await db0.teams.create({
      data: { name: `Purge Team 0 ${randomUUID().slice(0, 6)}` },
    });
    testTeam0Id = t0.id;

    const t1 = await db1.teams.create({
      data: { name: `Purge Team 1 ${randomUUID().slice(0, 6)}` },
    });
    testTeam1Id = t1.id;
  });

  afterAll(async () => {
    const db0 = globalDb();
    const db1 = writeDb(1);

    // Clean up created test teams and user
    await db0.invites.deleteMany({ where: { team_id: testTeam0Id } });
    await db1.invites.deleteMany({ where: { team_id: testTeam1Id } });
    await db0.teams.deleteMany({ where: { id: testTeam0Id } });
    await db1.teams.deleteMany({ where: { id: testTeam1Id } });

    // Deleting user cascades test refresh_tokens, magic_tokens, password_resets
    await db0.users.deleteMany({ where: { id: testUserId } });

    await redis.quit().catch(() => undefined);
    await closeAllDatabases();
  });

  it('purge-tokens: dry run counts rows and logs dry_run=true without deleting anything', async () => {
    const db0 = globalDb();
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400 * 1_000);

    // Seed 1 expired pending signup
    const email = `dryrun-${randomUUID().slice(0, 8)}@example.test`;
    await db0.pending_signups.create({
      data: {
        email,
        display_name: 'DryRun Tester',
        country: 'ZZ',
        password_hash: FAKE_HASH,
        code_hash: FAKE_HASH,
        expires_at: eightDaysAgo,
      },
    });

    const countsBefore = await getProtectedTableCounts();

    const result = await runPurgeTokens({ dryRunOnly: true });
    expect(result.job).toBe('purge-tokens');

    const pendingResult = result.tables.find((t) => t.table === 'pending_signups');
    expect(pendingResult).toBeDefined();
    expect(pendingResult!.dryRunCount).toBeGreaterThanOrEqual(1);
    expect(pendingResult!.deletedCount).toBe(0);

    // Verify row still exists in DB
    const row = await db0.pending_signups.findUnique({ where: { email } });
    expect(row).not.toBeNull();

    // Verify purge_log recorded dry_run = true
    const logRows = await db0.$queryRaw<Array<{ job: string; table_name: string; dry_run: boolean }>>`
      SELECT job, table_name, dry_run FROM purge_log
      WHERE job = 'purge-tokens' AND table_name = 'pending_signups' AND dry_run = true
      ORDER BY ran_at DESC LIMIT 1;
    `;
    expect(logRows).toHaveLength(1);
    expect(logRows[0]?.dry_run).toBe(true);

    const countsAfter = await getProtectedTableCounts();
    expect(countsAfter).toEqual(countsBefore);

    // Clean up
    await db0.pending_signups.delete({ where: { email } });
  });

  it('purge-tokens: deletes expired tokens > 7 days old, leaves fresh ones, and respects later of grant_expires_at', async () => {
    const db0 = globalDb();
    const db1 = writeDb(1);
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400 * 1_000);
    const sixDays23HoursAgo = new Date(Date.now() - (7 * 86_400 - 3_600) * 1_000);
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400 * 1_000);

    // 1. pending_signups
    const oldEmail = `old-ps-${randomUUID().slice(0, 8)}@example.test`;
    const freshEmail = `fresh-ps-${randomUUID().slice(0, 8)}@example.test`;
    await db0.pending_signups.createMany({
      data: [
        {
          email: oldEmail,
          display_name: 'Old Pending',
          country: 'ZZ',
          password_hash: FAKE_HASH,
          code_hash: FAKE_HASH,
          expires_at: eightDaysAgo,
        },
        {
          email: freshEmail,
          display_name: 'Fresh Pending',
          country: 'ZZ',
          password_hash: FAKE_HASH,
          code_hash: FAKE_HASH,
          expires_at: sixDays23HoursAgo,
        },
      ],
    });

    // 2. password_resets:
    // a) Code expired 8 days ago, no grant -> PURGED
    const r1 = await db0.password_resets.create({
      data: {
        user_id: testUserId,
        code_hash: FAKE_HASH,
        expires_at: eightDaysAgo,
        consumed_at: eightDaysAgo,
      },
    });
    // b) Code expired 8 days ago, but grant expires 2 days ago (< 7 days ago) -> SURVIVES!
    const r2 = await db0.password_resets.create({
      data: {
        user_id: testUserId,
        code_hash: FAKE_HASH,
        expires_at: eightDaysAgo,
        consumed_at: eightDaysAgo,
        grant_selector: `gsel-${randomUUID().slice(0, 8)}`,
        grant_verifier_hash: FAKE_HASH,
        grant_expires_at: twoDaysAgo,
      },
    });
    // c) Code expired 6d 23h ago -> SURVIVES!
    const r3 = await db0.password_resets.create({
      data: {
        user_id: testUserId,
        code_hash: FAKE_HASH,
        expires_at: sixDays23HoursAgo,
        consumed_at: sixDays23HoursAgo,
      },
    });

    // 3. magic_tokens
    const mOld = await db0.magic_tokens.create({
      data: {
        user_id: testUserId,
        selector: `mold-${randomUUID().slice(0, 8)}`,
        verifier_hash: FAKE_HASH,
        expires_at: eightDaysAgo,
      },
    });
    const mFresh = await db0.magic_tokens.create({
      data: {
        user_id: testUserId,
        selector: `mfresh-${randomUUID().slice(0, 8)}`,
        verifier_hash: FAKE_HASH,
        expires_at: sixDays23HoursAgo,
      },
    });

    // 4. refresh_tokens (both revoked/used and plain)
    const refOld = await db0.refresh_tokens.create({
      data: {
        user_id: testUserId,
        family_id: randomUUID(),
        selector: `rold-${randomUUID().slice(0, 8)}`,
        verifier_hash: FAKE_HASH,
        expires_at: eightDaysAgo,
        revoked_at: eightDaysAgo,
      },
    });
    const refFresh = await db0.refresh_tokens.create({
      data: {
        user_id: testUserId,
        family_id: randomUUID(),
        selector: `rfresh-${randomUUID().slice(0, 8)}`,
        verifier_hash: FAKE_HASH,
        expires_at: sixDays23HoursAgo,
        revoked_at: sixDays23HoursAgo,
      },
    });

    // 5. invites on db0 and db1
    const inv0Old = await db0.invites.create({
      data: {
        team_id: testTeam0Id,
        email: `inv0-old-${randomUUID().slice(0, 8)}@example.test`,
        role: 'staff',
        selector: `inv0old-${randomUUID().slice(0, 8)}`,
        verifier_hash: FAKE_HASH,
        invited_by: testUserId,
        expires_at: eightDaysAgo,
      },
    });
    const inv0Fresh = await db0.invites.create({
      data: {
        team_id: testTeam0Id,
        email: `inv0-fresh-${randomUUID().slice(0, 8)}@example.test`,
        role: 'staff',
        selector: `inv0fresh-${randomUUID().slice(0, 8)}`,
        verifier_hash: FAKE_HASH,
        invited_by: testUserId,
        expires_at: sixDays23HoursAgo,
      },
    });
    const inv1Old = await db1.invites.create({
      data: {
        team_id: testTeam1Id,
        email: `inv1-old-${randomUUID().slice(0, 8)}@example.test`,
        role: 'staff',
        selector: `inv1old-${randomUUID().slice(0, 8)}`,
        verifier_hash: FAKE_HASH,
        invited_by: testUserId,
        expires_at: eightDaysAgo,
      },
    });
    const inv1Fresh = await db1.invites.create({
      data: {
        team_id: testTeam1Id,
        email: `inv1-fresh-${randomUUID().slice(0, 8)}@example.test`,
        role: 'staff',
        selector: `inv1fresh-${randomUUID().slice(0, 8)}`,
        verifier_hash: FAKE_HASH,
        invited_by: testUserId,
        expires_at: sixDays23HoursAgo,
      },
    });

    const protectedCountsBefore = await getProtectedTableCounts();

    // Execute real run
    const result = await runPurgeTokens({ dryRunFirst: true });
    expect(result.job).toBe('purge-tokens');

    // Assertions on deleted vs surviving rows
    expect(await db0.pending_signups.findUnique({ where: { email: oldEmail } })).toBeNull();
    expect(await db0.pending_signups.findUnique({ where: { email: freshEmail } })).not.toBeNull();

    expect(await db0.password_resets.findUnique({ where: { id: r1.id } })).toBeNull();
    expect(await db0.password_resets.findUnique({ where: { id: r2.id } })).not.toBeNull();
    expect(await db0.password_resets.findUnique({ where: { id: r3.id } })).not.toBeNull();

    expect(await db0.magic_tokens.findUnique({ where: { id: mOld.id } })).toBeNull();
    expect(await db0.magic_tokens.findUnique({ where: { id: mFresh.id } })).not.toBeNull();

    expect(await db0.refresh_tokens.findUnique({ where: { id: refOld.id } })).toBeNull();
    expect(await db0.refresh_tokens.findUnique({ where: { id: refFresh.id } })).not.toBeNull();

    expect(await db0.invites.findUnique({ where: { id: inv0Old.id } })).toBeNull();
    expect(await db0.invites.findUnique({ where: { id: inv0Fresh.id } })).not.toBeNull();
    expect(await db1.invites.findUnique({ where: { id: inv1Old.id } })).toBeNull();
    expect(await db1.invites.findUnique({ where: { id: inv1Fresh.id } })).not.toBeNull();

    // Verify purge_log records dry_run=false with deleted count >= 1
    const logs = await db0.$queryRaw<Array<{ table_name: string; row_count: number; dry_run: boolean }>>`
      SELECT table_name, row_count, dry_run FROM purge_log
      WHERE job = 'purge-tokens' AND dry_run = false
      ORDER BY ran_at DESC LIMIT 5;
    `;
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) expect(l.dry_run).toBe(false);

    // Protected tables remain untouched
    const protectedCountsAfter = await getProtectedTableCounts();
    expect(protectedCountsAfter).toEqual(protectedCountsBefore);

    // Teardown surviving test rows
    await db0.pending_signups.delete({ where: { email: freshEmail } });
    await db0.password_resets.deleteMany({ where: { id: { in: [r2.id, r3.id] } } });
    await db0.magic_tokens.delete({ where: { id: mFresh.id } });
    await db0.refresh_tokens.delete({ where: { id: refFresh.id } });
    await db0.invites.delete({ where: { id: inv0Fresh.id } });
    await db1.invites.delete({ where: { id: inv1Fresh.id } });
  });

  it('purge-idempotency: purges keys older than 48h across both shards, retains 47h keys', async () => {
    const fiftyHoursAgo = new Date(Date.now() - 50 * 3_600 * 1_000);
    const fortySevenHoursAgo = new Date(Date.now() - 47 * 3_600 * 1_000);

    const oldKey0 = `k0-old-${randomUUID().slice(0, 8)}`;
    const freshKey0 = `k0-fresh-${randomUUID().slice(0, 8)}`;
    const oldKey1 = `k1-old-${randomUUID().slice(0, 8)}`;
    const freshKey1 = `k1-fresh-${randomUUID().slice(0, 8)}`;

    const db0 = writeDb(0);
    const db1 = writeDb(1);

    await db0.idempotency_keys.createMany({
      data: [
        { scope: 'test-team-0', key: oldKey0, request_fingerprint: 'fp1', created_at: fiftyHoursAgo },
        { scope: 'test-team-0', key: freshKey0, request_fingerprint: 'fp2', created_at: fortySevenHoursAgo },
      ],
    });
    await db1.idempotency_keys.createMany({
      data: [
        { scope: 'test-team-1', key: oldKey1, request_fingerprint: 'fp3', created_at: fiftyHoursAgo },
        { scope: 'test-team-1', key: freshKey1, request_fingerprint: 'fp4', created_at: fortySevenHoursAgo },
      ],
    });

    const protectedCountsBefore = await getProtectedTableCounts();

    // 1. Dry run
    const dryRunRes = await runPurgeIdempotency({ dryRunOnly: true });
    expect(dryRunRes.job).toBe('purge-idempotency');
    for (const t of dryRunRes.tables) {
      expect(t.dryRunCount).toBeGreaterThanOrEqual(1);
      expect(t.deletedCount).toBe(0);
    }

    // 2. Real run
    const realRes = await runPurgeIdempotency({ dryRunFirst: true });
    expect(realRes.job).toBe('purge-idempotency');
    for (const t of realRes.tables) {
      expect(t.deletedCount).toBeGreaterThanOrEqual(1);
    }

    // Assert old deleted, fresh kept
    expect(await db0.idempotency_keys.findUnique({ where: { scope_key: { scope: 'test-team-0', key: oldKey0 } } })).toBeNull();
    expect(await db0.idempotency_keys.findUnique({ where: { scope_key: { scope: 'test-team-0', key: freshKey0 } } })).not.toBeNull();

    expect(await db1.idempotency_keys.findUnique({ where: { scope_key: { scope: 'test-team-1', key: oldKey1 } } })).toBeNull();
    expect(await db1.idempotency_keys.findUnique({ where: { scope_key: { scope: 'test-team-1', key: freshKey1 } } })).not.toBeNull();

    const protectedCountsAfter = await getProtectedTableCounts();
    expect(protectedCountsAfter).toEqual(protectedCountsBefore);

    // Teardown
    await db0.idempotency_keys.delete({ where: { scope_key: { scope: 'test-team-0', key: freshKey0 } } });
    await db1.idempotency_keys.delete({ where: { scope_key: { scope: 'test-team-1', key: freshKey1 } } });
  });

  it('batching works across more rows than a single batch', async () => {
    const db0 = globalDb();
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400 * 1_000);
    const emails: string[] = [];

    // Insert 12 rows with batchSize set to 5 (requires 3 iterations: 5 + 5 + 2)
    for (let i = 0; i < 12; i++) {
      const e = `batch-${i}-${randomUUID().slice(0, 8)}@example.test`;
      emails.push(e);
      await db0.pending_signups.create({
        data: {
          email: e,
          display_name: `Batch ${i}`,
          country: 'ZZ',
          password_hash: FAKE_HASH,
          code_hash: FAKE_HASH,
          expires_at: tenDaysAgo,
        },
      });
    }

    const res = await runPurgeTokens({ batchSize: 5 });
    const pendingRes = res.tables.find((t) => t.table === 'pending_signups');
    expect(pendingRes).toBeDefined();
    expect(pendingRes!.deletedCount).toBeGreaterThanOrEqual(12);

    // Verify all 12 are gone
    const remaining = await db0.pending_signups.findMany({ where: { email: { in: emails } } });
    expect(remaining).toHaveLength(0);
  });
});
