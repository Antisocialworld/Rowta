// Repair job tests for user_team_index and team_directory (PRD 8.11; skill rowta-teams-roles-recipes).
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { forTeam, globalDb } from '../src/db/clients.ts';
import { runRepairUserTeamIndex } from '../src/jobs/repair/user-team-index.ts';
import { createVerifiedUser, ensureTestCountries, uniqueEmail } from './helpers/auth-test.ts';

beforeAll(async () => {
  await ensureTestCountries();
});

describe('repair-user-team-index job (PRD 8.11 reconciliation)', () => {
  let userId: string;
  let teamId: string;

  beforeAll(async () => {
    const email = uniqueEmail('repair-owner');
    userId = await createVerifiedUser(email, 'RepairOwner123#');

    // Create a team directly on its shard
    teamId = randomUUID();
    const shardClient = forTeam(teamId);

    await shardClient.teams.create({
      data: {
        id: teamId,
        name: 'Repair Reconciliation Team',
        managers_can_revoke_invites: true,
      },
    });

    await shardClient.memberships.create({
      data: {
        team_id: teamId,
        user_id: userId,
        role: 'owner',
      },
    });
  });

  it('detects missing directory, missing index, and stale index in dry run', async () => {
    const db0 = globalDb();

    // Ensure team_directory and user_team_index are missing for this team
    await db0.team_directory.deleteMany({ where: { team_id: teamId } });
    await db0.user_team_index.deleteMany({ where: { team_id: teamId } });

    // Insert a stale record into user_team_index for a valid user with no membership
    const staleEmail = uniqueEmail('stale-user');
    const staleUserId = await createVerifiedUser(staleEmail, 'StalePass123#');
    const nonExistentTeamId = randomUUID();
    await db0.user_team_index.create({
      data: {
        user_id: staleUserId,
        team_id: nonExistentTeamId,
      },
    });

    const res = await runRepairUserTeamIndex({ dryRunOnly: true });

    expect(res.dryRun.missingDirectoryCount).toBeGreaterThanOrEqual(1);
    expect(res.dryRun.missingIndexCount).toBeGreaterThanOrEqual(1);
    expect(res.dryRun.staleIndexCount).toBeGreaterThanOrEqual(1);
    expect(res.real).toBeUndefined();

    // Verify nothing changed in DB0
    const dirAfter = await db0.team_directory.findUnique({ where: { team_id: teamId } });
    expect(dirAfter).toBeNull();

    const idxAfter = await db0.user_team_index.findUnique({
      where: { user_id_team_id: { user_id: userId, team_id: teamId } },
    });
    expect(idxAfter).toBeNull();

    const orphanAfter = await db0.user_team_index.findUnique({
      where: { user_id_team_id: { user_id: staleUserId, team_id: nonExistentTeamId } },
    });
    expect(orphanAfter).not.toBeNull();

    // Clean up test stale record
    await db0.user_team_index.deleteMany({
      where: { user_id: staleUserId, team_id: nonExistentTeamId },
    });
  });

  it('repairs missing directory and index entries, and cleans stale ones', async () => {
    const db0 = globalDb();

    // Ensure team_directory and user_team_index are missing for this team
    await db0.team_directory.deleteMany({ where: { team_id: teamId } });
    await db0.user_team_index.deleteMany({ where: { team_id: teamId } });

    // Insert a stale record into user_team_index for a valid user with no membership
    const staleEmail2 = uniqueEmail('stale-user-2');
    const staleUserId2 = await createVerifiedUser(staleEmail2, 'StalePass123#');
    const nonExistentTeamId2 = randomUUID();
    await db0.user_team_index.create({
      data: {
        user_id: staleUserId2,
        team_id: nonExistentTeamId2,
      },
    });

    const res = await runRepairUserTeamIndex();

    expect(res.real?.repairedDirectoryCount).toBeGreaterThanOrEqual(1);
    expect(res.real?.repairedIndexCount).toBeGreaterThanOrEqual(1);
    expect(res.real?.cleanedIndexCount).toBeGreaterThanOrEqual(1);

    // Verify directory was inserted in DB0
    const dir = await db0.team_directory.findUnique({ where: { team_id: teamId } });
    expect(dir).not.toBeNull();
    expect(dir?.team_id).toBe(teamId);

    // Verify index was inserted in DB0
    const idx = await db0.user_team_index.findUnique({
      where: { user_id_team_id: { user_id: userId, team_id: teamId } },
    });
    expect(idx).not.toBeNull();

    // Verify stale orphan was removed
    const orphan = await db0.user_team_index.findUnique({
      where: { user_id_team_id: { user_id: staleUserId2, team_id: nonExistentTeamId2 } },
    });
    expect(orphan).toBeNull();
  });

  it('second run is clean and idempotent (0 missing, 0 stale)', async () => {
    const res = await runRepairUserTeamIndex();
    expect(res.dryRun.missingDirectoryCount).toBe(0);
    expect(res.dryRun.missingIndexCount).toBe(0);
    expect(res.dryRun.staleIndexCount).toBe(0);
    expect(res.real?.repairedDirectoryCount).toBe(0);
    expect(res.real?.repairedIndexCount).toBe(0);
    expect(res.real?.cleanedIndexCount).toBe(0);
  });
});
