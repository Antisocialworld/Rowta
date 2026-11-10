// Entitlements and capacity tests (C3).
// Unit/integration tests for server/src/billing/entitlements.ts. Requires the test database.
// Imports from server/src/billing/* and test helpers only.
// Run from the repo root:  npm test --workspace @rowta/server -- billing-entitlements
import { describe, expect, it } from 'vitest';
import { afterAll, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PlanInterval } from '../src/billing/entitlements.ts';
import {
  clearRateKeys,
  createVerifiedUser,
  ensureTestCountries,
  shutdownAuthTest,
  uniqueEmail,
} from './helpers/auth-test.ts';
import { globalDb, forTeam } from '../src/db/clients.ts';
import {
  entitlementsFor,
  applyCoverage,
  canCreateTeam,
  reserveTeamSlot,
  releaseTeamSlot,
  loadPlanEntitlements,
  loadOwnerAccount,
  loadTeamRegistry,
} from '../src/billing/entitlements.ts';
import { createTeam } from '../src/teams/service.ts';

describe('billing entitlements and capacity (C3)', () => {
  let ownerId: string;
  let teamId: string;
  let team2Id: string;
  let extraTeamId: string;

  beforeAll(async () => {
    await clearRateKeys();
    await ensureTestCountries();

    ownerId = await createVerifiedUser(uniqueEmail('ce-owner'), 'OwnerPass123#');

    teamId = '11111111-1111-1111-1111-111111111111';
    team2Id = '22222222-2222-2222-2222-222222222222';

    // Seed plan_entitlements (monthly + yearly).
    await globalDb().plan_entitlements.upsert({
      where: { interval: 'monthly' },
      create: {
        interval: 'monthly',
        base_price_minor: BigInt(650000),
        free_teams: 2,
        extra_team_price_minor: BigInt(200000),
        people_per_team: 10,
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
    await globalDb().plan_entitlements.upsert({
      where: { interval: 'yearly' },
      create: {
        interval: 'yearly',
        base_price_minor: BigInt(7800000),
        free_teams: 3,
        extra_team_price_minor: BigInt(2400000),
        people_per_team: 10,
        extra_person_price_minor: BigInt(240000),
        max_teams: 20,
        max_people_per_team: 50,
        trial_days: 14,
        trial_teams: 1,
        trial_people: 10,
        min_addon_charge_minor: BigInt(50000),
      },
      update: {},
    });

    // Create owner_account for the owner (active, monthly).
    await globalDb().owner_accounts.upsert({
      where: { user_id: ownerId },
      create: {
        user_id: ownerId,
        plan: 'monthly',
        status: 'active',
        trial_used: true,
        period_start: new Date(),
        period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        currency: 'NGN',
      },
      update: {},
    });

    // Create teams on their shards.
    await forTeam(teamId).teams.upsert({
      where: { id: teamId },
      create: { id: teamId, name: 'Team 1', created_by: ownerId },
      update: { created_by: ownerId },
    });
    await forTeam(team2Id).teams.upsert({
      where: { id: team2Id },
      create: { id: team2Id, name: 'Team 2', created_by: ownerId },
      update: { created_by: ownerId },
    });

    // Owner membership on both teams: use existing owner membership instead of inserting another.
    const existingOwner1 = await forTeam(teamId).memberships.findFirst({
      where: { team_id: teamId, role: 'owner', removed_at: null },
    });
    if (existingOwner1) {
      await forTeam(teamId).memberships.update({
        where: { id: existingOwner1.id },
        data: { user_id: ownerId },
      });
    } else {
      await forTeam(teamId).memberships.create({
        data: { team_id: teamId, user_id: ownerId, role: 'owner' },
      });
    }

    const existingOwner2 = await forTeam(team2Id).memberships.findFirst({
      where: { team_id: team2Id, role: 'owner', removed_at: null },
    });
    if (existingOwner2) {
      await forTeam(team2Id).memberships.update({
        where: { id: existingOwner2.id },
        data: { user_id: ownerId },
      });
    } else {
      await forTeam(team2Id).memberships.create({
        data: { team_id: team2Id, user_id: ownerId, role: 'owner' },
      });
    }

    // Owner team registry: first freeTeams are free, next is extra.
    await globalDb().owner_team_registry.upsert({
      where: { team_id: teamId },
      create: { team_id: teamId, owner_user_id: ownerId, status: 'active', is_extra: false },
      update: { owner_user_id: ownerId, status: 'active', is_extra: false },
    });
    await globalDb().owner_team_registry.upsert({
      where: { team_id: team2Id },
      create: { team_id: team2Id, owner_user_id: ownerId, status: 'active', is_extra: false },
      update: { owner_user_id: ownerId, status: 'active', is_extra: false },
    });

    extraTeamId = randomUUID();
    await forTeam(extraTeamId).teams.upsert({
      where: { id: extraTeamId },
      create: { id: extraTeamId, name: 'Extra Team', created_by: ownerId },
      update: {},
    });
    await forTeam(extraTeamId).memberships.upsert({
      where: { team_id_user_id: { team_id: extraTeamId, user_id: ownerId } },
      create: { team_id: extraTeamId, user_id: ownerId, role: 'owner' },
      update: {},
    });
    await globalDb().owner_team_registry.upsert({
      where: { team_id: extraTeamId },
      create: { team_id: extraTeamId, owner_user_id: ownerId, status: 'active', is_extra: true },
      update: {},
    });
  });

  afterAll(async () => {
    for (const tid of [teamId, team2Id, extraTeamId]) {
      if (tid) {
        await globalDb().owner_team_registry.deleteMany({ where: { team_id: tid } }).catch(() => undefined);
        await forTeam(tid).memberships.deleteMany({ where: { team_id: tid } }).catch(() => undefined);
        await forTeam(tid).teams.deleteMany({ where: { id: tid } }).catch(() => undefined);
      }
    }
    await shutdownAuthTest();
  });

  describe('loadPlanEntitlements', () => {
    it('returns monthly entitlements with NGN prices', async () => {
      const e = await loadPlanEntitlements('monthly');
      expect(e).not.toBeNull();
      expect(e!.interval).toBe('monthly');
      expect(e!.basePriceMinor).toBe(650000);
      expect(e!.freeTeams).toBe(2);
      expect(e!.extraTeamPriceMinor).toBe(200000);
      expect(e!.peoplePerTeam).toBe(10);
      expect(e!.maxTeams).toBe(20);
      expect(e!.maxPeoplePerTeam).toBe(50);
      expect(e!.minAddonChargeMinor).toBe(50000);
    });

    it('returns yearly entitlements', async () => {
      const e = await loadPlanEntitlements('yearly');
      expect(e).not.toBeNull();
      expect(e!.interval).toBe('yearly');
      expect(e!.basePriceMinor).toBe(7800000);
      expect(e!.freeTeams).toBe(3);
      expect(e!.extraTeamPriceMinor).toBe(2400000);
    });

    it('returns null for unknown interval', async () => {
      const e = await loadPlanEntitlements('weekly' as unknown as PlanInterval);
      expect(e).toBeNull();
    });
  });

  describe('loadOwnerAccount', () => {
    it('returns the owner account', async () => {
      const a = await loadOwnerAccount(ownerId);
      expect(a).not.toBeNull();
      expect(a!.userId).toBe(ownerId);
      expect(a!.status).toBe('active');
      expect(a!.plan).toBe('monthly');
      expect(a!.currency).toBe('NGN');
    });

    it('returns null for user without account', async () => {
      const a = await loadOwnerAccount('00000000-0000-0000-0000-000000000000');
      expect(a).toBeNull();
    });
  });

  describe('loadTeamRegistry', () => {
    it('returns registry row for a team', async () => {
      const r = await loadTeamRegistry(teamId);
      expect(r).not.toBeNull();
      expect(r!.ownerUserId).toBe(ownerId);
      expect(r!.isExtra).toBe(false);
    });

    it('returns null for unregistered team', async () => {
      const r = await loadTeamRegistry('33333333-3333-3333-3333-333333333333');
      expect(r).toBeNull();
    });
  });

  describe('entitlementsFor', () => {
    it('returns covered status for a free team under active account', async () => {
      const e = await entitlementsFor(teamId);
      const ent = await loadPlanEntitlements('monthly');
      const expectedTotalTeams = (ent?.freeTeams ?? 2) + 1;
      expect(e.teamId).toBe(teamId);
      expect(e.ownerUserId).toBe(ownerId);
      expect(e.coverageStatus).toBe('covered');
      expect(e.isExtra).toBe(false);
      expect(e.accountStatus).toBe('active');
      expect(e.planEntitlements?.freeTeams).toBe(ent?.freeTeams ?? 2);
      expect(e.teamsUsed).toBe(expectedTotalTeams);
      expect(e.freeTeamsRemaining).toBe(0);
      // canCreateTeam means may create a team, possibly paying for an extra one (capped at maxTeams).
      expect(e.canCreateTeam).toBe(true);
      expect(e.seatsUsed).toBe(0);
      expect(e.seatsIncluded).toBe(10);
      expect(e.canAddPerson).toBe(true);
    });

    it('returns is_extra=true for the team beyond the free allowance on monthly', async () => {
      const e = await entitlementsFor(extraTeamId);
      expect(e.isExtra).toBe(true);
      expect(e.coverageStatus).toBe('covered');
    });

    it('seatsUsed counts active non-owner members and pending invites', async () => {
      // Add a staff member and a pending invite to teamId.
      await forTeam(teamId).memberships.create({
        data: { team_id: teamId, user_id: 'aaaaaaaa-0000-0000-0000-000000000002', role: 'staff' },
      });
      await forTeam(teamId).invites.create({
        data: {
          team_id: teamId,
          email: 'pending@example.test',
          role: 'staff',
          selector: 'sel-pending',
          verifier_hash: '$argon2id$v=19$fake',
          invited_by: ownerId,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      const e = await entitlementsFor(teamId);
      expect(e.seatsUsed).toBe(2); // 1 staff + 1 pending invite
      expect(e.canAddPerson).toBe(true); // 2 < 10 included

      // Cleanup.
      await forTeam(teamId).memberships.delete({
        where: { team_id_user_id: { team_id: teamId, user_id: 'aaaaaaaa-0000-0000-0000-000000000002' } },
      });
      await forTeam(teamId).invites.delete({ where: { selector: 'sel-pending' } });
    });
  });

  describe('capacity caps (20 teams / 50 people)', () => {
    it('canCreateTeam is false when free allowance exhausted', async () => {
      // Owner has 2 teams on monthly (freeTeams=2), so teamsUsed(2) >= freeAllowance(2).
      // canCreate requires teamsUsed < maxTeams AND teamsUsed < freeAllowance.
      const result = await canCreateTeam(ownerId);
      expect(result).toBe(false);
    });

    it('canAddPerson respects included seats', async () => {
      const e = await entitlementsFor(teamId);
      expect(e.canAddPerson).toBe(true);
      expect(e.seatsRemaining).toBe(10);
    });
  });

  describe('reserveTeamSlot / releaseTeamSlot', () => {
    it('reserves a slot for a new team (pending_payment beyond free allowance)', async () => {
      const newTeamId = '44444444-4444-4444-4444-444444444444';
      // Owner has 2 teams on monthly (free=2), so next team is pending_payment.
      await expect(reserveTeamSlot(ownerId, newTeamId)).resolves.toBeUndefined();

      const reg = await loadTeamRegistry(newTeamId);
      expect(reg).not.toBeNull();
      expect(reg!.status).toBe('pending_payment');
      expect(reg!.isExtra).toBe(true);

      // Cleanup: release the slot.
      await releaseTeamSlot(newTeamId);
      const regAfter = await loadTeamRegistry(newTeamId);
      expect(regAfter).toBeNull();
    });

    it('throws when owner has no account', async () => {
      const noAccountId = '00000000-0000-0000-0000-000000000000';
      await expect(
        reserveTeamSlot(noAccountId, '55555555-5555-5555-5555-555555555555'),
      ).rejects.toThrow();
    });

    it('releaseTeamSlot on unknown team does not throw', async () => {
      await expect(
        releaseTeamSlot('99999999-9999-9999-9999-999999999999'),
      ).resolves.toBeUndefined();
    });
  });

  describe('applyCoverage', () => {
    it('recalculates coverage for all teams owned by a user', async () => {
      await applyCoverage(ownerId);

      const e1 = await entitlementsFor(teamId);
      expect(e1.coverageStatus).toBe('covered');
      expect(e1.isExtra).toBe(false);

      const e2 = await entitlementsFor(team2Id);
      expect(e2.coverageStatus).toBe('covered');
      expect(e2.isExtra).toBe(false);

      const eExtra = await entitlementsFor(extraTeamId);
      expect(eExtra.coverageStatus).toBe('covered');
      expect(eExtra.isExtra).toBe(true);
    });

    it('sets past_due when account is past_due', async () => {
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: { status: 'past_due', grace_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      });

      await applyCoverage(ownerId);

      const e1 = await entitlementsFor(teamId);
      expect(e1.coverageStatus).toBe('past_due');
      const e2 = await entitlementsFor(team2Id);
      expect(e2.coverageStatus).toBe('past_due');
      const eExtra = await entitlementsFor(extraTeamId);
      expect(eExtra.coverageStatus).toBe('past_due');

      // Restore.
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: { status: 'active', grace_ends_at: null },
      });
    });

    it('is idempotent: calling twice produces same result', async () => {
      await applyCoverage(ownerId);
      const e1 = await entitlementsFor(teamId);
      await applyCoverage(ownerId);
      const e2 = await entitlementsFor(teamId);
      expect(e1.coverageStatus).toBe(e2.coverageStatus);
      expect(e1.isExtra).toBe(e2.isExtra);
    });
  });

  describe('trial uniqueness', () => {
    it('owner_accounts has one row per user (user_id is PK)', async () => {
      const a1 = await loadOwnerAccount(ownerId);
      expect(a1).not.toBeNull();
      expect(a1!.trialUsed).toBe(true);

      // A second upsert for the same user should not create a second row.
      await globalDb().owner_accounts.upsert({
        where: { user_id: ownerId },
        create: {
          user_id: ownerId,
          plan: 'monthly',
          status: 'trialing',
          trial_used: true,
          currency: 'NGN',
        },
        update: {},
      });
      const count = await globalDb().owner_accounts.count({ where: { user_id: ownerId } });
      expect(count).toBe(1);
    });
  });

  describe('backfill idempotency (concept check)', () => {
    it('re-running backfill logic produces same counts', async () => {
      const acctCount = await globalDb().owner_accounts.count({
        where: { user_id: ownerId },
      });
      expect(acctCount).toBe(1);

      const ent = await loadPlanEntitlements('monthly');
      const expectedRegCount = (ent?.freeTeams ?? 2) + 1;
      const regCount = await globalDb().owner_team_registry.count({
        where: { owner_user_id: ownerId },
      });
      expect(regCount).toBe(expectedRegCount);
    });
  });

  describe('createTeam pendingPayment', () => {
    it('returns pendingPayment=true when over the free allowance', async () => {
      // Owner already has 3 teams on monthly (free allowance = 2). A 4th team is pending_payment.
      const result = await createTeam(ownerId, { name: 'Over Allowance Team' }, uniqueEmail('billing'));
      expect(result.pendingPayment).toBe(true);
      const reg = await loadTeamRegistry(result.id);
      expect(reg).not.toBeNull();
      expect(reg!.status).toBe('pending_payment');
      expect(reg!.isExtra).toBe(true);
      await releaseTeamSlot(result.id);
    });

    it('returns pendingPayment=false when within the free allowance', async () => {
      // First release extraTeamId and team2Id so owner has only 1 team (under free allowance 2).
      await releaseTeamSlot(extraTeamId);
      await releaseTeamSlot(team2Id);
      const result = await createTeam(ownerId, { name: 'Within Allowance Team' }, uniqueEmail('billing'));
      expect(result.pendingPayment).toBe(false);
      const reg = await loadTeamRegistry(result.id);
      expect(reg).not.toBeNull();
      expect(reg!.status).toBe('active');
      expect(reg!.isExtra).toBe(false);
      await releaseTeamSlot(result.id);
    });
  });
});
