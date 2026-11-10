// Two-shard backfill of owner accounts and team registry (Phase 6 / G6d D1).
// Replaces SQL 080 for existing local data:
// - Scans every shard from ALL_SHARDS (never hardcoded 0 and 1)
// - Filters: deleted_at IS NULL and created_by IS NOT NULL
// - Pages teams (pageSize = 500)
// - DB0 writes: owner_accounts (trialing, 14 days, trial_used=true, NGN) + owner_team_registry (active, is_extra=false)
// - Skips creators not present in db0 users
// - Default: DRY RUN (no writes). Requires --apply (apply: true) to write.
// - Refuses if NODE_ENV=production or database host is non-local unless allowNonLocal is true.
// - Counts only; no personal data, no IDs, no emails, no connection strings logged.
import { ALL_SHARDS } from '../db/shard.ts';
import { globalDb, writeDb, type ShardClient } from '../db/clients.ts';
import { env } from '../config/env.ts';
import { TEAM_RESTORE_WINDOW_MS } from '../teams/service.ts';

export interface BackfillOptions {
  apply?: boolean;
  allowNonLocal?: boolean;
  now?: Date;
  batchSize?: number;
}

export interface BackfillResult {
  teamsScannedPerShard: Record<number, number>;
  deletedOrCreatorlessSkipped: number;
  deletedTeamsInsideRestoreWindowIncluded: number;
  accountsAlreadyExisting: number;
  accountsCreated: number;
  registryAlreadyExisting: number;
  registryCreated: number;
  creatorsSkippedMissingUser: number;
  dryRun: boolean;
}

function assertAllowedEnvironment(options: BackfillOptions): void {
  if (options.allowNonLocal) return;

  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to run backfill in production without --allow-non-local');
  }

  const urlsToCheck = [env.DB0_WRITE_URL, env.DB1_WRITE_URL];
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

  for (const urlStr of urlsToCheck) {
    if (!urlStr) continue;
    try {
      const parsed = new URL(urlStr);
      if (!localHosts.has(parsed.hostname.toLowerCase())) {
        throw new Error('Refusing to run backfill on non-local database host without --allow-non-local');
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('Refusing to run')) throw err;
      throw new Error('Refusing to run backfill: database URL is invalid or non-local without --allow-non-local', { cause: err });
    }
  }
}

export async function backfillOwnerAccounts(options: BackfillOptions = {}): Promise<BackfillResult> {
  assertAllowedEnvironment(options);

  const apply = options.apply === true;
  const now = options.now ?? new Date();
  const trialEndsAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const restoreWindowCutoff = new Date(now.getTime() - TEAM_RESTORE_WINDOW_MS);
  const batchSize = options.batchSize ?? 500;
  const db0 = globalDb();

  const teamsScannedPerShard: Record<number, number> = {};
  let deletedOrCreatorlessSkipped = 0;
  let deletedTeamsInsideRestoreWindowIncluded = 0;
  let creatorsSkippedMissingUser = 0;

  const seenExistingAccounts = new Set<string>();
  const seenExistingRegistries = new Set<string>();
  const accountsToCreateSet = new Set<string>();
  const registriesToCreateSet = new Set<string>();

  for (const shard of ALL_SHARDS) {
    teamsScannedPerShard[shard] = 0;
    const shardClient = writeDb(shard) as ShardClient;

    // Count deleted (outside restore window) or creatorless teams skipped on this shard
    const skippedCount = await shardClient.teams.count({
      where: {
        OR: [
          { created_by: null },
          { deleted_at: { lt: restoreWindowCutoff } },
        ],
      },
    });
    deletedOrCreatorlessSkipped += skippedCount;

    // Page through eligible teams only (active or deleted within the 30-day restore window)
    let cursor: string | undefined = undefined;
    while (true) {
      const teamsBatch: Array<{
        id: string;
        created_by: string | null;
        created_at: Date;
        deleted_at: Date | null;
      }> = await shardClient.teams.findMany({
        where: {
          created_by: { not: null },
          OR: [
            { deleted_at: null },
            { deleted_at: { gte: restoreWindowCutoff } },
          ],
        },
        take: batchSize,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { id: 'asc' },
        select: {
          id: true,
          created_by: true,
          created_at: true,
          deleted_at: true,
        },
      });

      if (teamsBatch.length === 0) break;
      cursor = teamsBatch[teamsBatch.length - 1]?.id;
      teamsScannedPerShard[shard] = (teamsScannedPerShard[shard] ?? 0) + teamsBatch.length;

      for (const t of teamsBatch) {
        if (t.deleted_at !== null) {
          deletedTeamsInsideRestoreWindowIncluded++;
        }
      }

      // 1. Check creators in DB0 users
      const batchCreatorIds = Array.from(new Set(teamsBatch.map((t) => t.created_by).filter((id): id is string => typeof id === 'string')));
      const validUsers = await db0.users.findMany({
        where: { id: { in: batchCreatorIds } },
        select: { id: true },
      });
      const validUserSet = new Set(validUsers.map((u) => u.id));

      const eligibleTeamsInBatch = teamsBatch.filter((t) => {
        if (!t.created_by || !validUserSet.has(t.created_by)) {
          creatorsSkippedMissingUser++;
          return false;
        }
        return true;
      });

      if (eligibleTeamsInBatch.length === 0) continue;

      const eligibleCreatorIds = Array.from(new Set(eligibleTeamsInBatch.map((t) => t.created_by as string)));
      const eligibleTeamIds = eligibleTeamsInBatch.map((t) => t.id);

      // 2. Existing DB0 owner_accounts check
      const existingAccounts = await db0.owner_accounts.findMany({
        where: { user_id: { in: eligibleCreatorIds } },
        select: { user_id: true },
      });
      for (const a of existingAccounts) {
        seenExistingAccounts.add(a.user_id);
      }

      // 3. Existing DB0 owner_team_registry check
      const existingRegistries = await db0.owner_team_registry.findMany({
        where: { team_id: { in: eligibleTeamIds } },
        select: { team_id: true },
      });
      for (const r of existingRegistries) {
        seenExistingRegistries.add(r.team_id);
      }

      // 4. Determine items to create
      const newCreatorsForBatch = eligibleCreatorIds.filter(
        (id) => !seenExistingAccounts.has(id) && !accountsToCreateSet.has(id),
      );
      for (const id of newCreatorsForBatch) {
        accountsToCreateSet.add(id);
      }

      const newTeamsForBatch = eligibleTeamsInBatch.filter(
        (t) => !seenExistingRegistries.has(t.id) && !registriesToCreateSet.has(t.id),
      );
      for (const t of newTeamsForBatch) {
        registriesToCreateSet.add(t.id);
      }

      // 5. Apply writes if requested
      if (apply && (newCreatorsForBatch.length > 0 || newTeamsForBatch.length > 0)) {
        await db0.$transaction(async (tx) => {
          if (newCreatorsForBatch.length > 0) {
            await tx.owner_accounts.createMany({
              data: newCreatorsForBatch.map((userId) => ({
                user_id: userId,
                plan: 'monthly',
                status: 'trialing',
                trial_started_at: now,
                trial_ends_at: trialEndsAt,
                trial_used: true,
                period_start: now,
                period_end: trialEndsAt,
                currency: 'NGN',
                created_at: now,
                updated_at: now,
              })),
              skipDuplicates: true,
            });
          }

          if (newTeamsForBatch.length > 0) {
            await tx.owner_team_registry.createMany({
              data: newTeamsForBatch.map((team) => ({
                team_id: team.id,
                owner_user_id: team.created_by as string,
                status: 'active',
                is_extra: false,
                created_at: team.created_at,
              })),
              skipDuplicates: true,
            });
          }
        });
      }
    }
  }

  return {
    teamsScannedPerShard,
    deletedOrCreatorlessSkipped,
    deletedTeamsInsideRestoreWindowIncluded,
    accountsAlreadyExisting: seenExistingAccounts.size,
    accountsCreated: accountsToCreateSet.size,
    registryAlreadyExisting: seenExistingRegistries.size,
    registryCreated: registriesToCreateSet.size,
    creatorsSkippedMissingUser,
    dryRun: !apply,
  };
}

