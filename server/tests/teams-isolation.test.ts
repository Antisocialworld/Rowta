// Team isolation tests (PRD 4, 8.2; rule S7).
// Cross-team resources return 404, not 403, so existence is not leaked.
// Every team-scoped query requires teamId and throws if missing.
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/security/access-token.ts';
import * as service from '../src/teams/service.ts';
import { globalDb } from '../src/db/clients.ts';
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
