// Account-level move billing tests (C6).
// Integration tests for /teams/:teamId/billing/move/* endpoints.
//
// Fixture shape (ADR 0024 A7): the team's Admin (membership role 'owner') is NOT the payer.
// The payer is an active member whose user id sits in owner_team_registry.owner_user_id.
// A move hands the billing holder role to the Admin; only the payer can request it and only
// the Admin can accept/decline it. Teams live on a shard, so shard tables are read through
// forTeam(teamId), never globalDb().
//
// Run from the repo root:  npm test --workspace @rowta/server -- billing-move
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import {
  clearRateKeys,
  createVerifiedUser,
  dataOf,
  errorOf,
  ensureTestCountries,
  post,
  shutdownAuthTest,
  testApp,
  uniqueEmail,
} from './helpers/auth-test.ts';
import { globalDb, forTeam } from '../src/db/clients.ts';
import { signAccessToken } from '../src/security/access-token.ts';
import { sweepExpiredMoves } from '../src/jobs/sweep-expired-moves.ts';

let app: Hono;

interface Actor {
  readonly id: string;
  readonly auth: Record<string, string>;
}

interface MoveFixture {
  readonly admin: Actor; // team Admin (owner role): the move receiver
  readonly payer: Actor; // current billing holder (registry owner): the move requester
  readonly teamId: string;
}

async function postJson(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': uniqueEmail('billing'), ...headers },
    body: JSON.stringify(body),
  });
}

async function makeUser(prefix: string): Promise<Actor> {
  const id = await createVerifiedUser(uniqueEmail(prefix), 'FixturePass123#');
  return { id, auth: { authorization: `Bearer ${await signAccessToken(id)}` } };
}

async function seedActiveAccount(userId: string): Promise<void> {
  await globalDb().owner_accounts.upsert({
    where: { user_id: userId },
    create: { user_id: userId, plan: 'monthly', status: 'active', trial_used: true, currency: 'NGN' },
    update: {},
  });
}

async function createTeamFor(auth: Record<string, string>, name: string): Promise<string> {
  const res = await post(app, '/teams', { name }, { ...auth, 'idempotency-key': uniqueEmail('billing') });
  expect(res.status).toBe(201);
  return (await dataOf(res)).id as string;
}

/**
 * Build a team whose Admin (owner role) differs from its payer: the Admin creates the team,
 * the payer is added as a member, then the registry is pointed at the payer (the state an
 * ownership transfer leaves behind — billing does not follow the Admin role).
 */
async function makeMoveFixture(
  name: string,
  options: { adminHasAccount?: boolean } = {},
): Promise<MoveFixture> {
  const admin = await makeUser('mv-admin');
  const payer = await makeUser('mv-payer');
  const teamId = await createTeamFor(admin.auth, name);
  await forTeam(teamId).memberships.create({
    data: { team_id: teamId, user_id: payer.id, role: 'staff' },
  });
  await globalDb().owner_team_registry.update({
    where: { team_id: teamId },
    data: { owner_user_id: payer.id },
  });
  await seedActiveAccount(payer.id);
  if (options.adminHasAccount === false) {
    await globalDb().owner_accounts.deleteMany({ where: { user_id: admin.id } });
  }
  return { admin, payer, teamId };
}

function requestMove(fixture: MoveFixture, headers: Record<string, string> = fixture.payer.auth): Promise<Response> {
  return postJson(
    `/teams/${fixture.teamId}/billing/move/request`,
    { receiverUserId: fixture.admin.id },
    headers,
  );
}

describe('account-level move billing (C6)', () => {
  beforeAll(async () => {
    await clearRateKeys();
    await ensureTestCountries();
    app = testApp('billing-move');

    // Entitlements are DATA. The migrations seed both rows; this keeps the suite self-contained
    // if it runs against a database whose seed was wiped.
    await globalDb().plan_entitlements.upsert({
      where: { interval: 'monthly' },
      create: {
        interval: 'monthly',
        base_price_minor: BigInt(650000),
        free_teams: 2,
        extra_team_price_minor: BigInt(200000),
        people_per_team: 15,
        extra_person_price_minor: BigInt(20000),
        max_teams: 20,
        max_people_per_team: 50,
        trial_days: 14,
        trial_teams: 1,
        trial_people: 10,
        min_addon_charge_minor: BigInt(50000),
      },
      update: {},
    });
  });

  beforeEach(async () => {
    await clearRateKeys();
  });

  afterAll(async () => {
    await shutdownAuthTest();
  });

  describe('requestMove', () => {
    it('receiver with no billing account CAN receive a request (no receiver account check)', async () => {
      const f = await makeMoveFixture('No Account Receiver', { adminHasAccount: false });

      const res = await requestMove(f);
      expect(res.status).toBe(201);
      const body = await dataOf(res);
      expect(typeof body.moveId).toBe('string');
    });

    it('rejects when caller is not the paying owner', async () => {
      const f = await makeMoveFixture('Not Payer Team');

      // The Admin is a member and has an account, but the registry says the payer is someone else.
      const res = await requestMove(f, f.admin.auth);
      expect(res.status).toBe(403);
      const err = await errorOf(res);
      expect(err.code).toBe('billing.not_payer');
    });

    it('rejects when caller is not a member of the team', async () => {
      const f = await makeMoveFixture('Non Member Team');
      const outsider = await makeUser('mv-nonmember');
      await seedActiveAccount(outsider.id);

      const res = await requestMove(f, outsider.auth);
      expect(res.status).toBe(403);
      const err = await errorOf(res);
      expect(err.code).toBe('billing.not_payer');
    });

    it('requires Idempotency-Key', async () => {
      const f = await makeMoveFixture('Idempotency Missing Team');
      const res = await app.request(`/teams/${f.teamId}/billing/move/request`, {
        method: 'POST',
        headers: { ...f.payer.auth, 'content-type': 'application/json' },
        body: JSON.stringify({ receiverUserId: f.admin.id }),
      });
      expect(res.status).toBe(400);
      const err = await errorOf(res);
      expect(err.code).toBe('idempotency.missing');
    });

    it('returns same move id for repeated request with same key', async () => {
      const f = await makeMoveFixture('Idempotent Request Team');
      const key = uniqueEmail('idem-key');

      const send = async (): Promise<Response> =>
        app.request(`/teams/${f.teamId}/billing/move/request`, {
          method: 'POST',
          headers: { ...f.payer.auth, 'content-type': 'application/json', 'idempotency-key': key },
          body: JSON.stringify({ receiverUserId: f.admin.id }),
        });

      const res1 = await send();
      expect(res1.status).toBe(201);
      const body1 = await dataOf(res1);

      const res2 = await send();
      expect(res2.status).toBe(201);
      const body2 = await dataOf(res2);
      expect(body2.moveId).toBe(body1.moveId);
    });
  });

  describe('getMove', () => {
    it('returns null when no open move', async () => {
      const f = await makeMoveFixture('No Move Team');
      const res = await app.request(`/teams/${f.teamId}/billing/move`, {
        headers: f.payer.auth,
      });
      expect(res.status).toBe(200);
      const body = await dataOf(res);
      expect(body.move).toBeNull();
    });
  });

  describe('acceptMove/declineMove/cancelMove', () => {
    it('accept with no open move returns 404', async () => {
      const f = await makeMoveFixture('Accept Missing Team');
      const res = await postJson(
        `/teams/${f.teamId}/billing/move/${randomUUID()}/accept`,
        {},
        f.admin.auth,
      );
      expect(res.status).toBe(404);
    });

    it('decline with no open move returns 404', async () => {
      const f = await makeMoveFixture('Decline Missing Team');
      const res = await postJson(
        `/teams/${f.teamId}/billing/move/${randomUUID()}/decline`,
        {},
        f.admin.auth,
      );
      expect(res.status).toBe(404);
    });

    it('full move flow: request, accept, coverage pending_payment when no free slot', async () => {
      const f = await makeMoveFixture('Move Flow Team');
      // The receiver already owns two teams, so the moved team is their third (no free slot).
      await createTeamFor(f.admin.auth, 'Move Flow Extra 1');
      await createTeamFor(f.admin.auth, 'Move Flow Extra 2');

      const reqRes = await requestMove(f);
      expect(reqRes.status).toBe(201);
      const { moveId } = (await dataOf(reqRes)) as { moveId: string };

      const accRes = await postJson(
        `/teams/${f.teamId}/billing/move/${moveId}/accept`,
        {},
        f.admin.auth,
      );
      expect(accRes.status).toBe(200);

      const reg = await globalDb().owner_team_registry.findUnique({ where: { team_id: f.teamId } });
      expect(reg?.owner_user_id).toBe(f.admin.id);
      expect(reg?.status).toBe('pending_payment');

      const t1 = await forTeam(f.teamId).teams.findUnique({ where: { id: f.teamId } });
      expect(t1?.coverage_status).toBe('pending_payment');
    });

    it('move expired on lazy read', async () => {
      const f = await makeMoveFixture('Lazy Expiry Team');

      const reqRes = await requestMove(f);
      expect(reqRes.status).toBe(201);
      const { moveId } = (await dataOf(reqRes)) as { moveId: string };

      await forTeam(f.teamId).billing_handovers.update({
        where: { id: moveId },
        data: { expires_at: new Date(Date.now() - 86_400_000) }, // 1 day ago
      });

      const res = await app.request(`/teams/${f.teamId}/billing/move`, { headers: f.payer.auth });
      expect(res.status).toBe(200);
      const body = (await dataOf(res)) as { move: { id: string; status: string } };
      expect(body.move.status).toBe('expired');
    });

    it('acceptMove: receiver at maxTeams gets 422 billing.receiver_team_cap', async () => {
      const f = await makeMoveFixture('Team Cap Team');
      // Put the receiver at the monthly cap (20 teams).
      await globalDb().owner_team_registry.createMany({
        data: Array.from({ length: 20 }, () => ({
          team_id: randomUUID(),
          owner_user_id: f.admin.id,
          status: 'active',
          is_extra: true,
        })),
      });

      const reqRes = await requestMove(f);
      expect(reqRes.status).toBe(201);
      const { moveId } = (await dataOf(reqRes)) as { moveId: string };

      const res = await postJson(
        `/teams/${f.teamId}/billing/move/${moveId}/accept`,
        {},
        f.admin.auth,
      );
      expect(res.status).toBe(422);
      const err = await errorOf(res);
      expect(err.code).toBe('billing.receiver_team_cap');

      // Nothing changed: the registry still shows the payer as owner.
      const reg = await globalDb().owner_team_registry.findUnique({ where: { team_id: f.teamId } });
      expect(reg?.owner_user_id).toBe(f.payer.id);
      expect(reg?.status).toBe('active');
    });
  });

  describe('sweepExpiredMoves', () => {
    // Flush any expired move left behind by earlier tests/files so expiredCount is exact.
    beforeEach(async () => {
      await sweepExpiredMoves();
    });

    it('expired requested move becomes expired and exactly one notice is enqueued', async () => {
      const f = await makeMoveFixture('Sweep Team');

      const reqRes = await requestMove(f);
      expect(reqRes.status).toBe(201);
      const { moveId } = (await dataOf(reqRes)) as { moveId: string };

      await forTeam(f.teamId).billing_handovers.update({
        where: { id: moveId },
        data: { expires_at: new Date(Date.now() - 86_400_000) }, // 1 day ago
      });

      const result = await sweepExpiredMoves();
      expect(result.expiredCount).toBe(1);

      const move = await forTeam(f.teamId).billing_handovers.findUnique({ where: { id: moveId } });
      expect(move?.status).toBe('expired');

      const events = await forTeam(f.teamId).notification_outbox.findMany({
        where: { category: 'billing.move_expired' },
      });
      const moveExpiredEvents = events.filter(
        (e) => e.dedupe_key === `billing:move:${moveId}:expired`,
      );
      expect(moveExpiredEvents.length).toBe(1);
    });

    it('second run enqueues nothing', async () => {
      const f = await makeMoveFixture('Sweep Second Team');

      const reqRes = await requestMove(f);
      expect(reqRes.status).toBe(201);
      const { moveId } = (await dataOf(reqRes)) as { moveId: string };

      await forTeam(f.teamId).billing_handovers.update({
        where: { id: moveId },
        data: { expires_at: new Date(Date.now() - 86_400_000) },
      });

      await sweepExpiredMoves();
      const eventsAfterFirst = await forTeam(f.teamId).notification_outbox.findMany({
        where: { category: 'billing.move_expired' },
      });
      const countAfterFirst = eventsAfterFirst.filter(
        (e) => e.dedupe_key === `billing:move:${moveId}:expired`,
      ).length;
      expect(countAfterFirst).toBe(1);

      await sweepExpiredMoves();
      const eventsAfterSecond = await forTeam(f.teamId).notification_outbox.findMany({
        where: { category: 'billing.move_expired' },
      });
      const countAfterSecond = eventsAfterSecond.filter(
        (e) => e.dedupe_key === `billing:move:${moveId}:expired`,
      ).length;
      expect(countAfterSecond).toBe(1); // Still 1, no new notice.
    });

    it('non-expired requested move is untouched', async () => {
      const f = await makeMoveFixture('Sweep Non-Expired Team');

      const reqRes = await requestMove(f);
      expect(reqRes.status).toBe(201);
      const { moveId } = (await dataOf(reqRes)) as { moveId: string };

      // The move has a future expires_at (7 days from creation).
      await sweepExpiredMoves();

      const move = await forTeam(f.teamId).billing_handovers.findUnique({ where: { id: moveId } });
      expect(move?.status).toBe('requested');
    });

    it('accepted move is untouched', async () => {
      const f = await makeMoveFixture('Sweep Accepted Team');

      const reqRes = await requestMove(f);
      expect(reqRes.status).toBe(201);
      const { moveId } = (await dataOf(reqRes)) as { moveId: string };

      // Accept first (an expired request cannot be accepted), then push its expiry into the past.
      const accRes = await postJson(
        `/teams/${f.teamId}/billing/move/${moveId}/accept`,
        {},
        f.admin.auth,
      );
      expect(accRes.status).toBe(200);

      await forTeam(f.teamId).billing_handovers.update({
        where: { id: moveId },
        data: { expires_at: new Date(Date.now() - 86_400_000) },
      });

      await sweepExpiredMoves();

      const move = await forTeam(f.teamId).billing_handovers.findUnique({ where: { id: moveId } });
      expect(move?.status).toBe('accepted');
    });
  });
});
