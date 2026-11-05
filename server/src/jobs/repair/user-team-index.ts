// Repair job for user_team_index and team_directory (skill rowta-teams-roles-recipes; PRD 8.11).
//
// Reconciles DB0 global index tables (team_directory, user_team_index) against authoritative
// shard data (memberships, teams).
// Safe to re-run (idempotent), dry-run support, logs actions.
import { globalDb, writeDb } from '../../db/clients.ts';
import { shardFor, type Shard } from '../../db/shard.ts';
import { logger } from '../../lib/logger.ts';

const log = logger.child({ module: 'repair', job: 'repair-user-team-index' });

export interface RepairOptions {
  dryRunOnly?: boolean;
}

export interface RepairResult {
  dryRun: {
    missingDirectoryCount: number;
    missingIndexCount: number;
    staleIndexCount: number;
  };
  real?: {
    repairedDirectoryCount: number;
    repairedIndexCount: number;
    cleanedIndexCount: number;
  };
}

export async function runRepairUserTeamIndex(options: RepairOptions = {}): Promise<RepairResult> {
  const db0 = globalDb();
  const shards: Shard[] = [0, 1];

  // 1. Gather all active memberships across all shards
  const activeMemberships: { teamId: string; userId: string; shard: Shard }[] = [];
  for (const s of shards) {
    const shardClient = writeDb(s);
    const members = await shardClient.$queryRaw<{ team_id: string; user_id: string }[]>`
      SELECT m.team_id::text, m.user_id::text
      FROM memberships m
      JOIN teams t ON t.id = m.team_id
      WHERE m.removed_at IS NULL AND t.deleted_at IS NULL
    `;
    for (const m of members) {
      activeMemberships.push({ teamId: m.team_id, userId: m.user_id, shard: s });
    }
  }

  // 2. Check team_directory and user_team_index in DB0
  const userRows = await db0.users.findMany({
    where: { id: { in: activeMemberships.map((m) => m.userId) } },
    select: { id: true },
  });
  const validUserIds = new Set(userRows.map((u) => u.id));
  const validMemberships = activeMemberships.filter((m) => validUserIds.has(m.userId));

  const existingDirectory = await db0.team_directory.findMany();
  const directorySet = new Set(existingDirectory.map((d) => d.team_id));

  const existingIndex = await db0.user_team_index.findMany();
  const indexSet = new Set(existingIndex.map((i) => `${i.user_id}:${i.team_id}`));

  const missingDirectoryTeams = new Map<string, Shard>();
  const missingIndexPairs: { userId: string; teamId: string }[] = [];

  for (const item of activeMemberships) {
    if (!directorySet.has(item.teamId)) {
      missingDirectoryTeams.set(item.teamId, shardFor(item.teamId));
    }
  }

  for (const item of validMemberships) {
    const key = `${item.userId}:${item.teamId}`;
    if (!indexSet.has(key)) {
      missingIndexPairs.push({ userId: item.userId, teamId: item.teamId });
    }
  }

  // 3. Find stale entries in user_team_index
  const activeSet = new Set(validMemberships.map((m) => `${m.userId}:${m.teamId}`));
  const staleIndexPairs: { userId: string; teamId: string }[] = [];
  for (const item of existingIndex) {
    const key = `${item.user_id}:${item.team_id}`;
    if (!activeSet.has(key)) {
      staleIndexPairs.push({ userId: item.user_id, teamId: item.team_id });
    }
  }

  const dryRunCounts = {
    missingDirectoryCount: missingDirectoryTeams.size,
    missingIndexCount: missingIndexPairs.length,
    staleIndexCount: staleIndexPairs.length,
  };

  log.info({ ...dryRunCounts, dryRun: true }, 'repair-user-team-index dry run check');

  if (options.dryRunOnly === true) {
    return { dryRun: dryRunCounts };
  }

  // 4. Perform real repair
  let repairedDirectoryCount = 0;
  for (const [teamId, shard] of missingDirectoryTeams.entries()) {
    await db0.$executeRaw`
      INSERT INTO team_directory (team_id, shard)
      VALUES (${teamId}::uuid, ${shard})
      ON CONFLICT (team_id) DO NOTHING
    `;
    repairedDirectoryCount++;
  }

  let repairedIndexCount = 0;
  for (const pair of missingIndexPairs) {
    await db0.$executeRaw`
      INSERT INTO user_team_index (user_id, team_id)
      VALUES (${pair.userId}::uuid, ${pair.teamId}::uuid)
      ON CONFLICT (user_id, team_id) DO NOTHING
    `;
    repairedIndexCount++;
  }

  let cleanedIndexCount = 0;
  for (const pair of staleIndexPairs) {
    await db0.$executeRaw`
      DELETE FROM user_team_index
      WHERE user_id = ${pair.userId}::uuid AND team_id = ${pair.teamId}::uuid
    `;
    cleanedIndexCount++;
  }

  const realCounts = {
    repairedDirectoryCount,
    repairedIndexCount,
    cleanedIndexCount,
  };

  log.info({ ...realCounts, dryRun: false }, 'repair-user-team-index real run completed');

  return {
    dryRun: dryRunCounts,
    real: realCounts,
  };
}
