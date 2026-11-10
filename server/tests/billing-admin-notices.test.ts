// Billing Admin notices test (Phase 6 / G6a Task A2).
// Tests for notifyCoveredTeamAdmins:
// - Admin receives notice when payer's plan changes (cancelled, kept, ended)
// - Payer themselves is excluded even if they are the Admin of a covered team
// - Admin of another payer's team gets nothing
// - Deduplication on repeat calls with same event date
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  clearRateKeys,
  createVerifiedUser,
  ensureTestCountries,
  shutdownAuthTest,
  uniqueEmail,
} from './helpers/auth-test.ts';
import { globalDb, forTeam } from '../src/db/clients.ts';
import { notifyCoveredTeamAdmins } from '../src/billing/admin-notices.ts';

describe('billing admin notices (G6a Task A2)', () => {
  let payerAId: string;
  let payerBId: string;
  let admin1Id: string;
  let admin2Id: string;
  let team1Id: string;
  let team2Id: string;
  let team3Id: string;

  beforeAll(async () => {
    await clearRateKeys();
    await ensureTestCountries();

    const db0 = globalDb();

    // 1. Create users
    payerAId = await createVerifiedUser(uniqueEmail('payer-a'), 'Pass12345#');
    payerBId = await createVerifiedUser(uniqueEmail('payer-b'), 'Pass12345#');
    admin1Id = await createVerifiedUser(uniqueEmail('admin-1'), 'Pass12345#');
    admin2Id = await createVerifiedUser(uniqueEmail('admin-2'), 'Pass12345#');

    // 2. Create teams
    team1Id = randomUUID();
    team2Id = randomUUID();
    team3Id = randomUUID();

    const t1Client = forTeam(team1Id);
    await t1Client.teams.create({
      data: {
        id: team1Id,
        name: 'Team One',
        created_by: admin1Id,
        managers_can_revoke_invites: true,
        coverage_status: 'covered',
      },
    });
    // Team 1 Admin is admin1
    await t1Client.memberships.create({
      data: { team_id: team1Id, user_id: admin1Id, role: 'owner' },
    });
    // Team 1 is covered by Payer A
    await db0.owner_team_registry.create({
      data: { owner_user_id: payerAId, team_id: team1Id, is_extra: false, status: 'active' },
    });

    const t2Client = forTeam(team2Id);
    await t2Client.teams.create({
      data: {
        id: team2Id,
        name: 'Team Two',
        created_by: payerAId,
        managers_can_revoke_invites: true,
        coverage_status: 'covered',
      },
    });
    // Team 2 Admin is Payer A themselves
    await t2Client.memberships.create({
      data: { team_id: team2Id, user_id: payerAId, role: 'owner' },
    });
    // Team 2 is also covered by Payer A
    await db0.owner_team_registry.create({
      data: { owner_user_id: payerAId, team_id: team2Id, is_extra: true, status: 'active' },
    });

    const t3Client = forTeam(team3Id);
    await t3Client.teams.create({
      data: {
        id: team3Id,
        name: 'Team Three',
        created_by: admin2Id,
        managers_can_revoke_invites: true,
        coverage_status: 'covered',
      },
    });
    // Team 3 Admin is admin2
    await t3Client.memberships.create({
      data: { team_id: team3Id, user_id: admin2Id, role: 'owner' },
    });
    // Team 3 is covered by Payer B
    await db0.owner_team_registry.create({
      data: { owner_user_id: payerBId, team_id: team3Id, is_extra: false, status: 'active' },
    });
  });

  afterAll(async () => {
    const userIds = [payerAId, payerBId, admin1Id, admin2Id].filter(Boolean);
    const teamIds = [team1Id, team2Id, team3Id].filter(Boolean);

    for (const tid of teamIds) {
      const client = forTeam(tid);
      await client.notification_outbox.deleteMany({ where: { recipient_user_id: { in: userIds } } });
      await client.memberships.deleteMany({ where: { team_id: tid } });
      await client.teams.deleteMany({ where: { id: tid } });
    }

    const db0 = globalDb();
    if (teamIds.length > 0) {
      await db0.owner_team_registry.deleteMany({ where: { team_id: { in: teamIds } } });
    }
    if (userIds.length > 0) {
      await db0.owner_accounts.deleteMany({ where: { user_id: { in: userIds } } });
      await db0.users.deleteMany({ where: { id: { in: userIds } } });
    }

    await shutdownAuthTest();
  });

  it('notifies admin of covered team when payer cancels, excluding payer and other payers teams', async () => {
    const cancelDate = '2026-12-01';
    await notifyCoveredTeamAdmins(payerAId, { type: 'cancelled', date: cancelDate });

    const t1Client = forTeam(team1Id);
    const admin1Notices = await t1Client.notification_outbox.findMany({
      where: { recipient_user_id: admin1Id, category: 'billing.plan_cancelled' },
    });
    expect(admin1Notices.length).toBe(1);
    const firstNotice = admin1Notices[0];
    expect(firstNotice).toBeDefined();
    if (!firstNotice) throw new Error('Expected notice to be defined');
    expect((firstNotice.payload as { date?: string })?.date).toBe(cancelDate);

    // Payer A is Admin of Team 2, but must be excluded because they are the payer
    const t2Client = forTeam(team2Id);
    const payerNotices = await t2Client.notification_outbox.findMany({
      where: { recipient_user_id: payerAId, category: 'billing.plan_cancelled' },
    });
    expect(payerNotices.length).toBe(0);

    // Admin 2 of Team 3 (covered by Payer B) gets nothing
    const t3Client = forTeam(team3Id);
    const admin2Notices = await t3Client.notification_outbox.findMany({
      where: { recipient_user_id: admin2Id, category: 'billing.plan_cancelled' },
    });
    expect(admin2Notices.length).toBe(0);
  });

  it('deduplicates notices on repeat calls with same date', async () => {
    const cancelDate = '2026-12-01';
    // Call a second time with the exact same event
    await notifyCoveredTeamAdmins(payerAId, { type: 'cancelled', date: cancelDate });

    const t1Client = forTeam(team1Id);
    const admin1Notices = await t1Client.notification_outbox.findMany({
      where: { recipient_user_id: admin1Id, category: 'billing.plan_cancelled' },
    });
    // Should still be exactly 1 due to dedupeKey
    expect(admin1Notices.length).toBe(1);
  });

  it('notifies admin when plan is kept', async () => {
    const date = '2026-12-01';
    await notifyCoveredTeamAdmins(payerAId, { type: 'kept', date });

    const t1Client = forTeam(team1Id);
    const admin1Notices = await t1Client.notification_outbox.findMany({
      where: { recipient_user_id: admin1Id, category: 'billing.plan_kept' },
    });
    expect(admin1Notices.length).toBe(1);

    const t2Client = forTeam(team2Id);
    const payerNotices = await t2Client.notification_outbox.findMany({
      where: { recipient_user_id: payerAId, category: 'billing.plan_kept' },
    });
    expect(payerNotices.length).toBe(0);
  });

  it('notifies admin when plan ends / read-only', async () => {
    const date = '2026-12-01';
    await notifyCoveredTeamAdmins(payerAId, { type: 'ended', date });

    const t1Client = forTeam(team1Id);
    const admin1Notices = await t1Client.notification_outbox.findMany({
      where: { recipient_user_id: admin1Id, category: 'billing.plan_ended' },
    });
    expect(admin1Notices.length).toBe(1);

    const t2Client = forTeam(team2Id);
    const payerNotices = await t2Client.notification_outbox.findMany({
      where: { recipient_user_id: payerAId, category: 'billing.plan_ended' },
    });
    expect(payerNotices.length).toBe(0);
  });
});

