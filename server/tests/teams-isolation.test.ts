// Team isolation tests (PRD 4, 8.2; rule S7).
// Cross-team resources return 404, not 403, so existence is not leaked.
// Every team-scoped query requires teamId and throws if missing.
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/security/access-token.ts';
import * as service from '../src/teams/service.ts';
import { globalDb, writeDb } from '../src/db/clients.ts';
import { shardFor } from '../src/db/shard.ts';
import {
  clearRateKeys,
  createVerifiedUser,
  ensureTestCountries,
  errorOf,
  post,
  testApp,
  uniqueEmail,
} from './helpers/auth-test.ts';

let app: Hono;

async function get(app: Hono, path: string, headers: Record<string, string> = {}): Promise<Response> {
  return app.request(path, { method: 'GET', headers });
}

beforeAll(async () => {
  await clearRateKeys();
  await ensureTestCountries();
  app = testApp('teams-isolation');
});

describe('Team isolation and cross-team protection (Rule S7)', () => {
  let userAId: string;
  let userAAuth: { authorization: string };
  let teamAId: string;

  let userBId: string;
  let userBAuth: { authorization: string };
  let _teamBId: string;

  beforeAll(async () => {
    // User A in Team A
    const emailA = uniqueEmail('iso-user-a');
    userAId = await createVerifiedUser(emailA, 'PassUserA123#');
    userAAuth = { authorization: `Bearer ${await signAccessToken(userAId)}` };

    const resA = await post(
      app,
      '/teams',
      { name: 'Team Alpha' },
      { ...userAAuth, 'idempotency-key': randomUUID() },
    );
    expect(resA.status).toBe(201);
    const dataA = (await resA.json()) as { data: { id: string } };
    teamAId = dataA.data.id;

    // User B in Team B
    const emailB = uniqueEmail('iso-user-b');
    userBId = await createVerifiedUser(emailB, 'PassUserB123#');
    userBAuth = { authorization: `Bearer ${await signAccessToken(userBId)}` };

    const resB = await post(
      app,
      '/teams',
      { name: 'Team Bravo' },
      { ...userBAuth, 'idempotency-key': randomUUID() },
    );
    expect(resB.status).toBe(201);
    const dataB = (await resB.json()) as { data: { id: string } };
    _teamBId = dataB.data.id;
  });

  describe('User B receives 404 for EVERY team-scoped endpoint of Team A (Rule S7)', () => {
    it('GET /teams/:teamId returns 404', async () => {
      const res = await get(app, `/teams/${teamAId}`, userBAuth);
      expect(res.status).toBe(404);
      const err = await errorOf(res);
      expect(err.code).toBe('team.notFound');
    });

    it('GET /teams/:teamId/members returns 404', async () => {
      const res = await get(app, `/teams/${teamAId}/members`, userBAuth);
      expect(res.status).toBe(404);
      const err = await errorOf(res);
      expect(err.code).toBe('team.notFound');
    });

    it('GET /teams/:teamId/invites returns 404', async () => {
      const res = await get(app, `/teams/${teamAId}/invites`, userBAuth);
      expect(res.status).toBe(404);
      const err = await errorOf(res);
      expect(err.code).toBe('team.notFound');
    });

    it('POST /teams/:teamId/invites returns 404', async () => {
      const res = await post(
        app,
        `/teams/${teamAId}/invites`,
        { email: uniqueEmail('inv'), role: 'staff' },
        userBAuth,
      );
      expect(res.status).toBe(404);
      const err = await errorOf(res);
      expect(err.code).toBe('team.notFound');
    });

    it('POST /teams/:teamId/invites/:inviteId/revoke returns 404', async () => {
      const fakeInviteId = randomUUID();
      const res = await post(app, `/teams/${teamAId}/invites/${fakeInviteId}/revoke`, {}, userBAuth);
      expect(res.status).toBe(404);
      const err = await errorOf(res);
      expect(err.code).toBe('team.notFound');
    });

    it('POST /teams/:teamId/members/:userId/role returns 404', async () => {
      const res = await post(
        app,
        `/teams/${teamAId}/members/${userAId}/role`,
        { role: 'manager' },
        userBAuth,
      );
      expect(res.status).toBe(404);
      const err = await errorOf(res);
      expect(err.code).toBe('team.notFound');
    });

    it('POST /teams/:teamId/members/:userId/remove returns 404', async () => {
      const res = await post(
        app,
        `/teams/${teamAId}/members/${userAId}/remove`,
        {},
        userBAuth,
      );
      expect(res.status).toBe(404);
      const err = await errorOf(res);
      expect(err.code).toBe('team.notFound');
    });

    it('POST /teams/:teamId/leave returns 404', async () => {
      const res = await post(app, `/teams/${teamAId}/leave`, {}, userBAuth);
      expect(res.status).toBe(404);
      const err = await errorOf(res);
      expect(err.code).toBe('team.notFound');
    });

    it('POST /teams/:teamId/settings returns 404', async () => {
      const res = await post(
        app,
        `/teams/${teamAId}/settings`,
        { managers_can_revoke_invites: false },
        userBAuth,
      );
      expect(res.status).toBe(404);
      const err = await errorOf(res);
      expect(err.code).toBe('team.notFound');
    });
  });

  describe('Team-scoped queries without teamId throw in tests (Rule S7)', () => {
    it('assertTeamId throws when teamId is empty or whitespace', async () => {
      const client = globalDb();

      await expect(service.getTeam(userAId, '')).rejects.toThrow(
        'teamId is required for team-scoped data access (rule S7)',
      );
      await expect(service.getTeam(userAId, '   ')).rejects.toThrow(
        'teamId is required for team-scoped data access (rule S7)',
      );
      await expect(service.listMembers(userAId, '')).rejects.toThrow(
        'teamId is required for team-scoped data access (rule S7)',
      );
      await expect(service.listInvites(userAId, '')).rejects.toThrow(
        'teamId is required for team-scoped data access (rule S7)',
      );
      await expect(
        service.createInvite(userAId, '', { email: 'test@example.com', role: 'staff' }),
      ).rejects.toThrow('teamId is required for team-scoped data access (rule S7)');
      await expect(service.revokeInvite(userAId, '', randomUUID())).rejects.toThrow(
        'teamId is required for team-scoped data access (rule S7)',
      );
      await expect(
        service.changeMemberRole(userAId, '', userAId, { role: 'manager' }),
      ).rejects.toThrow('teamId is required for team-scoped data access (rule S7)');
      await expect(service.removeMember(userAId, '', userAId)).rejects.toThrow(
        'teamId is required for team-scoped data access (rule S7)',
      );
      await expect(service.leaveTeam(userAId, '')).rejects.toThrow(
        'teamId is required for team-scoped data access (rule S7)',
      );
      await expect(
        service.updateTeamSettings(userAId, '', { managers_can_revoke_invites: false }),
      ).rejects.toThrow('teamId is required for team-scoped data access (rule S7)');
      await expect(service.getSeatCap('', client)).rejects.toThrow(
        'teamId is required for team-scoped data access (rule S7)',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// listTeams – batched shard queries (Task S1 refactor).
// Tests call listTeams directly; rows are inserted via writeDb / globalDb so
// the test does not go through HTTP and is not rate-limited.
// ---------------------------------------------------------------------------
describe('listTeams – batched shard queries', () => {
  // Each test creates its own user so index rows do not cross-contaminate.
  // All ZZ-country users are dropped in the shared teardown in auth-test.ts.

  it('1. zero teams: returns [] when the user has no index rows', async () => {
    const userId = await createVerifiedUser(uniqueEmail('lt-zero'), 'PassList123#');
    const result = await service.listTeams(userId);
    expect(result).toEqual([]);
  });

  it('2. one team: returns the team with all required fields', async () => {
    const userId = await createVerifiedUser(uniqueEmail('lt-one'), 'PassList123#');
    const teamId = randomUUID();
    const shard = shardFor(teamId);
    const db0 = globalDb();
    const shardClient = writeDb(shard);

    await shardClient.teams.create({
      data: { id: teamId, name: 'Shard Test Team' },
    });
    await shardClient.memberships.create({
      data: { team_id: teamId, user_id: userId, role: 'owner' },
    });
    await db0.user_team_index.create({
      data: { user_id: userId, team_id: teamId },
    });

    const result = await service.listTeams(userId);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(teamId);
    expect(result[0]?.name).toBe('Shard Test Team');
    expect(result[0]?.role).toBe('owner');
    expect(result[0]?.managersCanRevokeInvites).toBe(true);
    expect(result[0]?.createdBy).toBeNull();

    // cleanup
    await db0.user_team_index.delete({ where: { user_id_team_id: { user_id: userId, team_id: teamId } } });
    await shardClient.memberships.deleteMany({ where: { team_id: teamId } });
    await shardClient.teams.delete({ where: { id: teamId } });
  });

  it('3. two teams on different shards: both appear in indexRows order', async () => {
    const userId = await createVerifiedUser(uniqueEmail('lt-two'), 'PassList123#');
    const db0 = globalDb();

    // Find one UUID per shard (brute-force; fast in practice — ~50% hit per try)
    let idOnShard0 = '';
    let idOnShard1 = '';
    while (!idOnShard0 || !idOnShard1) {
      const id = randomUUID();
      if (!idOnShard0 && shardFor(id) === 0) idOnShard0 = id;
      if (!idOnShard1 && shardFor(id) === 1) idOnShard1 = id;
    }

    // Insert shard-0 team first (controls result order via indexRows)
    await writeDb(0).teams.create({ data: { id: idOnShard0, name: 'ShardZero Team' } });
    await writeDb(0).memberships.create({ data: { team_id: idOnShard0, user_id: userId, role: 'staff' } });
    await db0.user_team_index.create({ data: { user_id: userId, team_id: idOnShard0 } });

    await writeDb(1).teams.create({ data: { id: idOnShard1, name: 'ShardOne Team' } });
    await writeDb(1).memberships.create({ data: { team_id: idOnShard1, user_id: userId, role: 'manager' } });
    await db0.user_team_index.create({ data: { user_id: userId, team_id: idOnShard1 } });

    const result = await service.listTeams(userId);
    expect(result).toHaveLength(2);
    // Order must match insertion order in user_team_index (DB0 findMany returns in PK insertion order)
    expect(result[0]?.id).toBe(idOnShard0);
    expect(result[0]?.role).toBe('staff');
    expect(result[1]?.id).toBe(idOnShard1);
    expect(result[1]?.role).toBe('manager');

    // cleanup
    await db0.user_team_index.deleteMany({ where: { user_id: userId } });
    await writeDb(0).memberships.deleteMany({ where: { team_id: idOnShard0 } });
    await writeDb(0).teams.delete({ where: { id: idOnShard0 } });
    await writeDb(1).memberships.deleteMany({ where: { team_id: idOnShard1 } });
    await writeDb(1).teams.delete({ where: { id: idOnShard1 } });
  });

  it('4. removed membership: team absent from result', async () => {
    const userId = await createVerifiedUser(uniqueEmail('lt-removed'), 'PassList123#');
    const teamId = randomUUID();
    const shard = shardFor(teamId);
    const db0 = globalDb();
    const shardClient = writeDb(shard);

    await shardClient.teams.create({ data: { id: teamId, name: 'Removed Membership Team' } });
    await shardClient.memberships.create({
      data: { team_id: teamId, user_id: userId, role: 'staff', removed_at: new Date() },
    });
    await db0.user_team_index.create({ data: { user_id: userId, team_id: teamId } });

    const result = await service.listTeams(userId);
    expect(result).toHaveLength(0);

    // cleanup
    await db0.user_team_index.delete({ where: { user_id_team_id: { user_id: userId, team_id: teamId } } });
    await shardClient.memberships.deleteMany({ where: { team_id: teamId } });
    await shardClient.teams.delete({ where: { id: teamId } });
  });

  it('5. soft-deleted team: team absent from result', async () => {
    const userId = await createVerifiedUser(uniqueEmail('lt-softdel'), 'PassList123#');
    const teamId = randomUUID();
    const shard = shardFor(teamId);
    const db0 = globalDb();
    const shardClient = writeDb(shard);

    await shardClient.teams.create({
      data: { id: teamId, name: 'Deleted Team', deleted_at: new Date() },
    });
    await shardClient.memberships.create({ data: { team_id: teamId, user_id: userId, role: 'owner' } });
    await db0.user_team_index.create({ data: { user_id: userId, team_id: teamId } });

    const result = await service.listTeams(userId);
    expect(result).toHaveLength(0);

    // cleanup
    await db0.user_team_index.delete({ where: { user_id_team_id: { user_id: userId, team_id: teamId } } });
    await shardClient.memberships.deleteMany({ where: { team_id: teamId } });
    await shardClient.teams.delete({ where: { id: teamId } });
  });

  it('6. creator null: createdBy is null when team.created_by is null', async () => {
    const userId = await createVerifiedUser(uniqueEmail('lt-nocreator'), 'PassList123#');
    const teamId = randomUUID();
    const shard = shardFor(teamId);
    const db0 = globalDb();
    const shardClient = writeDb(shard);

    // created_by defaults to NULL (no backfill for test rows)
    await shardClient.teams.create({ data: { id: teamId, name: 'No Creator Team' } });
    await shardClient.memberships.create({ data: { team_id: teamId, user_id: userId, role: 'owner' } });
    await db0.user_team_index.create({ data: { user_id: userId, team_id: teamId } });

    const result = await service.listTeams(userId);
    expect(result).toHaveLength(1);
    expect(result[0]?.createdBy).toBeNull();

    // cleanup
    await db0.user_team_index.delete({ where: { user_id_team_id: { user_id: userId, team_id: teamId } } });
    await shardClient.memberships.deleteMany({ where: { team_id: teamId } });
    await shardClient.teams.delete({ where: { id: teamId } });
  });

  it('7. creator set and user exists in DB0: createdBy has userId and displayName', async () => {
    const userId = await createVerifiedUser(uniqueEmail('lt-withcreator'), 'PassList123#');
    const creatorId = await createVerifiedUser(uniqueEmail('lt-creator'), 'PassCreator123#');
    const teamId = randomUUID();
    const shard = shardFor(teamId);
    const db0 = globalDb();
    const shardClient = writeDb(shard);

    // Set created_by to a real DB0 user (no FK on the shard — it's a uuid column)
    await shardClient.teams.create({ data: { id: teamId, name: 'Creator Team', created_by: creatorId } });
    await shardClient.memberships.create({ data: { team_id: teamId, user_id: userId, role: 'owner' } });
    await db0.user_team_index.create({ data: { user_id: userId, team_id: teamId } });

    const result = await service.listTeams(userId);
    expect(result).toHaveLength(1);
    expect(result[0]?.createdBy).not.toBeNull();
    expect(result[0]?.createdBy?.userId).toBe(creatorId);
    expect(typeof result[0]?.createdBy?.displayName).toBe('string');

    // cleanup
    await db0.user_team_index.delete({ where: { user_id_team_id: { user_id: userId, team_id: teamId } } });
    await shardClient.memberships.deleteMany({ where: { team_id: teamId } });
    await shardClient.teams.delete({ where: { id: teamId } });
  });
});
