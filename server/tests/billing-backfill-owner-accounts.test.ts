// Unit and integration tests for two-shard backfill-owner-accounts (Phase 6 / G6d D2).
// Tests that:
// 1. Dry run writes nothing to DB0.
// 2. --apply creates accounts and registry rows for teams on BOTH shards (Shard 0 and Shard 1).
// 3. A team deleted recently inside the restore window gets a registry row; a team deleted longer ago than the window gets none.
// 4. Running twice creates nothing the second time (idempotent).
// 5. A creator with an existing account keeps that account unchanged.
// Never uses TRUNCATE or DROP.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { globalDb, writeDb, type ShardClient } from '../src/db/clients.ts';
import { shardFor } from '../src/db/shard.ts';
import { backfillOwnerAccounts } from '../src/billing/backfill-owner-accounts.ts';
import {
  clearRateKeys,
  createVerifiedUser,
  ensureTestCountries,
  shutdownAuthTest,
  uniqueEmail,
} from './helpers/auth-test.ts';

function makeTeamIdForShard(targetShard: 0 | 1): string {
  while (true) {
    const id = randomUUID();
    if (shardFor(id) === targetShard) return id;
  }
}

describe('Two-shard backfill of owner accounts and registry (D2)', () => {
  beforeAll(async () => {
    await clearRateKeys();
    await ensureTestCountries();
  });

  afterAll(async () => {
    await shutdownAuthTest();
  });

  it('dry run writes nothing to DB0', async () => {
    const db0 = globalDb();
    const creatorId = await createVerifiedUser(uniqueEmail('dryrun-creator'), 'TestPass123#');
    const t0Id = makeTeamIdForShard(0);
    const client0 = writeDb(0) as ShardClient;

    await client0.teams.create({
      data: {
        id: t0Id,
        name: 'Dry Run Team Shard 0',
        created_by: creatorId,
        created_at: new Date(),
      },
    });

    const result = await backfillOwnerAccounts({ apply: false });
    expect(result.dryRun).toBe(true);
    expect(result.accountsCreated).toBeGreaterThanOrEqual(1);

    // Verify nothing written on DB0 for this creator and team
    const acct = await db0.owner_accounts.findUnique({ where: { user_id: creatorId } });
    expect(acct).toBeNull();

    const reg = await db0.owner_team_registry.findUnique({ where: { team_id: t0Id } });
    expect(reg).toBeNull();
  });

  it('--apply creates accounts and registry rows for teams on BOTH shards', async () => {
    const db0 = globalDb();
    const creator0 = await createVerifiedUser(uniqueEmail('shard0-creator'), 'TestPass123#');
    const creator1 = await createVerifiedUser(uniqueEmail('shard1-creator'), 'TestPass123#');

    const t0Id = makeTeamIdForShard(0);
    const t1Id = makeTeamIdForShard(1);

    const client0 = writeDb(0) as ShardClient;
    const client1 = writeDb(1) as ShardClient;

    await client0.teams.create({
      data: {
        id: t0Id,
        name: 'Team on Shard 0',
        created_by: creator0,
        created_at: new Date(),
      },
    });

    await client1.teams.create({
      data: {
        id: t1Id,
        name: 'Team on Shard 1',
        created_by: creator1,
        created_at: new Date(),
      },
    });

    const result = await backfillOwnerAccounts({ apply: true });
    expect(result.dryRun).toBe(false);

    // Verify account on DB0 for creator0
    const acct0 = await db0.owner_accounts.findUnique({ where: { user_id: creator0 } });
    expect(acct0).not.toBeNull();
    expect(acct0?.status).toBe('trialing');
    expect(acct0?.plan).toBe('monthly');
    expect(acct0?.trial_used).toBe(true);
    expect(acct0?.currency).toBe('NGN');

    // Verify account on DB0 for creator1 (from shard 1)
    const acct1 = await db0.owner_accounts.findUnique({ where: { user_id: creator1 } });
    expect(acct1).not.toBeNull();
    expect(acct1?.status).toBe('trialing');

    // Verify registry on DB0 for shard 0 team
    const reg0 = await db0.owner_team_registry.findUnique({ where: { team_id: t0Id } });
    expect(reg0).not.toBeNull();
    expect(reg0?.owner_user_id).toBe(creator0);
    expect(reg0?.status).toBe('active');
    expect(reg0?.is_extra).toBe(false);

    // Verify registry on DB0 for shard 1 team
    const reg1 = await db0.owner_team_registry.findUnique({ where: { team_id: t1Id } });
    expect(reg1).not.toBeNull();
    expect(reg1?.owner_user_id).toBe(creator1);
    expect(reg1?.status).toBe('active');
    expect(reg1?.is_extra).toBe(false);
  });

  it('a team deleted recently inside the restore window gets a registry row', async () => {
    const db0 = globalDb();
    const creator = await createVerifiedUser(uniqueEmail('recentdel-creator'), 'TestPass123#');
    const recentDelTeamId = makeTeamIdForShard(1);
    const client1 = writeDb(1) as ShardClient;

    // Deleted 5 days ago (well within 30-day restore window)
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await client1.teams.create({
      data: {
        id: recentDelTeamId,
        name: 'Recently Deleted Team',
        created_by: creator,
        deleted_at: fiveDaysAgo,
        created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      },
    });

    const result = await backfillOwnerAccounts({ apply: true });
    expect(result.deletedTeamsInsideRestoreWindowIncluded).toBeGreaterThanOrEqual(1);

    const reg = await db0.owner_team_registry.findUnique({ where: { team_id: recentDelTeamId } });
    expect(reg).not.toBeNull();
    expect(reg?.owner_user_id).toBe(creator);
    expect(reg?.status).toBe('active');
  });

  it('a team deleted longer ago than the window gets no registry row', async () => {
    const db0 = globalDb();
    const creator = await createVerifiedUser(uniqueEmail('olddel-creator'), 'TestPass123#');
    const oldDelTeamId = makeTeamIdForShard(0);
    const client0 = writeDb(0) as ShardClient;

    // Deleted 40 days ago (outside 30-day restore window)
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await client0.teams.create({
      data: {
        id: oldDelTeamId,
        name: 'Old Deleted Team',
        created_by: creator,
        deleted_at: fortyDaysAgo,
        created_at: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000),
      },
    });

    await backfillOwnerAccounts({ apply: true });

    const reg = await db0.owner_team_registry.findUnique({ where: { team_id: oldDelTeamId } });
    expect(reg).toBeNull();
  });

  it('running twice creates nothing the second time (idempotent)', async () => {
    const secondResult = await backfillOwnerAccounts({ apply: true });
    expect(secondResult.accountsCreated).toBe(0);
    expect(secondResult.registryCreated).toBe(0);
  });

  it('a creator with an existing account keeps that account unchanged', async () => {
    const db0 = globalDb();
    const existingCreator = await createVerifiedUser(uniqueEmail('existing-acct-creator'), 'TestPass123#');

    // Pre-create an active yearly account
    const periodStart = new Date();
    const periodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    await db0.owner_accounts.create({
      data: {
        user_id: existingCreator,
        plan: 'yearly',
        status: 'active',
        period_start: periodStart,
        period_end: periodEnd,
        currency: 'NGN',
        trial_used: true,
      },
    });

    // Create a new team on Shard 0 for this creator
    const teamId = makeTeamIdForShard(0);
    const client0 = writeDb(0) as ShardClient;
    await client0.teams.create({
      data: {
        id: teamId,
        name: 'Existing Account Team',
        created_by: existingCreator,
        created_at: new Date(),
      },
    });

    await backfillOwnerAccounts({ apply: true });

    // Verify account was NOT overwritten with trialing/monthly
    const acct = await db0.owner_accounts.findUnique({ where: { user_id: existingCreator } });
    expect(acct?.status).toBe('active');
    expect(acct?.plan).toBe('yearly');

    // Registry row was created and linked to the existing creator
    const reg = await db0.owner_team_registry.findUnique({ where: { team_id: teamId } });
    expect(reg?.owner_user_id).toBe(existingCreator);
    expect(reg?.status).toBe('active');
  });
});

