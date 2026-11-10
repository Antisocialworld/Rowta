// Teams seat limit and concurrency/race tests (PRD 4, 5, 8.2; Owner Decision 1).
// Starter tier has 5 seats hard cap (owner not counted).
// Race test: two concurrent accepts for the last seat -> exactly one succeeds, one gets 422 team.seatLimit.
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import type { Worker } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { forTeam } from '../src/db/clients.ts';
import { signAccessToken } from '../src/security/access-token.ts';
import {
  clearRateKeys,
  createVerifiedUser,
  dataOf,
  ensureTestCountries,
  errorOf,
  mailCaptureClear,
  post,
  shutdownAuthTest,
  startEmailWorker,
  testApp,
  uniqueEmail,
  waitForMail,
  inviteTokenFromMail,
} from './helpers/auth-test.ts';

let app: Hono;
let worker: Worker;

beforeAll(async () => {
  await clearRateKeys();
  await ensureTestCountries();
  await mailCaptureClear();
  worker = await startEmailWorker();
  app = testApp('teams-concurrency');
});

afterAll(async () => {
  await shutdownAuthTest(worker);
});

describe('Teams seat limit and concurrency (Starter cap = 5, owner not counted)', () => {
  let ownerId: string;
  let ownerAuth: { authorization: string };
  let teamId: string;

  beforeAll(async () => {
    const ownerEmail = uniqueEmail('seat-owner');
    ownerId = await createVerifiedUser(ownerEmail, 'SeatOwner123#');
    ownerAuth = { authorization: `Bearer ${await signAccessToken(ownerId)}` };

    const res = await post(
      app,
      '/teams',
      { name: 'Seat Cap Test Team' },
      { ...ownerAuth, 'idempotency-key': randomUUID() },
    );
    expect(res.status).toBe(201);
    const data = await dataOf(res);
    teamId = data.id as string;
  });

  it('Owner does not count against the 5 seat cap (Owner Decision 1)', async () => {
    // Fill 4 seats with staff members
    for (let i = 1; i <= 4; i++) {
      const email = uniqueEmail(`staff-seat-${i}`);
      const userId = await createVerifiedUser(email, `StaffPass123#${i}`);
      const userAuth = { authorization: `Bearer ${await signAccessToken(userId)}` };

      await mailCaptureClear();
      const invRes = await post(app, `/teams/${teamId}/invites`, { email, role: 'staff' }, ownerAuth);
      expect(invRes.status).toBe(200);

      const mail = await waitForMail(email);
      const token = inviteTokenFromMail(mail);

      const accRes = await post(app, '/invites/accept', { token }, userAuth);
      expect(accRes.status).toBe(200);
    }

    // Now 4 non-owner seats are active.
    const shardClient = forTeam(teamId);
    const count = await shardClient.memberships.count({
      where: { team_id: teamId, role: { not: 'owner' }, removed_at: null },
    });
    expect(count).toBe(4);
  });

  it('Cannot invite beyond the seat cap when cap is exhausted', async () => {
    // Invite 5th member
    const email5 = uniqueEmail('staff-seat-5');
    const invRes5 = await post(app, `/teams/${teamId}/invites`, { email: email5, role: 'staff' }, ownerAuth);
    expect(invRes5.status).toBe(200);

    // 4 active members + 1 open invite = 5 seats allocated.
    // Attempting a 6th invite must fail with 422 team.seatLimit
    const email6 = uniqueEmail('staff-seat-6');
    const invRes6 = await post(app, `/teams/${teamId}/invites`, { email: email6, role: 'staff' }, ownerAuth);
    expect(invRes6.status).toBe(422);
    const err = await errorOf(invRes6);
    expect(err.code).toBe('team.seatLimit');

    // Revoke the 5th invite to free up the 5th seat for the race test
    const invRow = await forTeam(teamId).invites.findFirst({
      where: { team_id: teamId, email: email5, accepted_at: null, revoked_at: null },
    });
    expect(invRow).not.toBeNull();
    const revRes = await post(app, `/teams/${teamId}/invites/${invRow!.id}/revoke`, {}, ownerAuth);
    expect(revRes.status).toBe(200);
  });

  it('Race condition for the last seat: concurrent accepts serialize with row lock', async () => {
    // 4 active seats currently. We create two invitations for the 5th seat.
    // To allow 2 open invites without hitting cap at invite-creation time,
    // we invite candidate A, candidate B (temporarily modifying or creating invites)
    // Actually: createInvite checks `activeNonOwnerCount + openInvitesCount >= cap`.
    // If cap is 5, active is 4, openInvites is 0, we can invite candidate A (open becomes 1).
    // Now open is 1 + active 4 = 5. To have 2 valid tokens for the race, let's insert invite B directly into the shard DB
    // to simulate a race where two invites were sent or an unexpired invite existed.
    const candAEmail = uniqueEmail('cand-a');
    const candAId = await createVerifiedUser(candAEmail, 'CandAPass123#');
    const candAAuth = { authorization: `Bearer ${await signAccessToken(candAId)}` };

    await mailCaptureClear();
    const invResA = await post(app, `/teams/${teamId}/invites`, { email: candAEmail, role: 'staff' }, ownerAuth);
    expect(invResA.status).toBe(200);
    const mailA = await waitForMail(candAEmail);
    const tokenA = inviteTokenFromMail(mailA);

    const candBEmail = uniqueEmail('cand-b');
    const candBId = await createVerifiedUser(candBEmail, 'CandBPass123#');
    const candBAuth = { authorization: `Bearer ${await signAccessToken(candBId)}` };

    // Insert valid invite for candidate B directly into shard DB with selector and verifier hash
    const { createTokenParts, formatToken } = await import('../src/security/tokens.ts');
    const { hashSecret } = await import('../src/security/argon2.ts');
    const partsB = createTokenParts();
    const tokenB = formatToken(partsB);
    const verifierHashB = await hashSecret(partsB.verifier);

    const shardClient = forTeam(teamId);
    await shardClient.invites.create({
      data: {
        team_id: teamId,
        email: candBEmail,
        role: 'staff',
        selector: partsB.selector,
        verifier_hash: verifierHashB,
        invited_by: ownerId,
        expires_at: new Date(Date.now() + 86400000),
      },
    });

    // Now both candidate A and candidate B have valid unexpired invite tokens.
    // But there is ONLY 1 seat remaining (active = 4, cap = 5).
    // Send both accept requests concurrently!
    const [resA, resB] = await Promise.all([
      post(app, '/invites/accept', { token: tokenA }, candAAuth),
      post(app, '/invites/accept', { token: tokenB }, candBAuth),
    ]);

    const statuses = [resA.status, resB.status].sort();
    // Exactly ONE must succeed (200) and ONE must fail with 422 (team.seatLimit)
    expect(statuses).toEqual([200, 422]);

    const failedRes = resA.status === 422 ? resA : resB;
    const err = await errorOf(failedRes);
    expect(err.code).toBe('team.seatLimit');

    // Confirm database has exactly 5 active non-owner members (Starter cap is strictly respected)
    const finalNonOwnerCount = await shardClient.memberships.count({
      where: { team_id: teamId, role: { not: 'owner' }, removed_at: null },
    });
    expect(finalNonOwnerCount).toBe(5);
  });
});
