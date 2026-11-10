// Account-level renewal/grace tests (C5).
// Tests for server/src/billing/account-renewal-processor.ts. Not registered until C7.
// Imports from server/src/billing/* and test helpers only.
// Run from the repo root:  npm test --workspace @rowta/server -- billing-account-renewal
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { UnrecoverableError, type Job } from 'bullmq';
import {
  clearRateKeys,
  createVerifiedUser,
  ensureTestCountries,
  shutdownAuthTest,
  uniqueEmail,
} from './helpers/auth-test.ts';
import { globalDb, forTeam } from '../src/db/clients.ts';
import {
  processAccountRenewalJob,
  processAccountGraceReminder,
  processAccountYearlyReminder,
  processAccountTrialEnd,
} from '../src/billing/account-renewal-processor.ts';
import { quote } from '../src/billing/account-service.ts';

function renewalJob(ownerUserId: string, periodEnd: Date): Job<{ ownerUserId: string; periodEnd: string }> {
  return { data: { ownerUserId, periodEnd: periodEnd.toISOString() } } as unknown as Job<{ ownerUserId: string; periodEnd: string }>;
}

function graceJob(ownerUserId: string): Job<{ ownerUserId: string }> {
  return { data: { ownerUserId } } as unknown as Job<{ ownerUserId: string }>;
}

function yearlyJob(ownerUserId: string, periodEnd: Date): Job<{ ownerUserId: string; periodEnd: string }> {
  return { data: { ownerUserId, periodEnd: periodEnd.toISOString() } } as unknown as Job<{ ownerUserId: string; periodEnd: string }>;
}

function trialEndJob(ownerUserId: string): Job<{ ownerUserId: string }> {
  return { data: { ownerUserId } } as unknown as Job<{ ownerUserId: string }>;
}

describe('account-level renewal and grace (C5)', () => {
  let ownerId: string;
  let teamId: string;

  beforeAll(async () => {
    await clearRateKeys();
    await ensureTestCountries();

    ownerId = await createVerifiedUser(uniqueEmail('arn-owner'), 'OwnerPass123#');
    teamId = randomUUID();

    // Seed plan_entitlements.
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

    // Create team and membership.
    await forTeam(teamId).teams.upsert({
      where: { id: teamId },
      create: { id: teamId, name: 'Renewal Test Team', created_by: ownerId },
      update: {},
    });
    await forTeam(teamId).memberships.upsert({
      where: { team_id_user_id: { team_id: teamId, user_id: ownerId } },
      create: { team_id: teamId, user_id: ownerId, role: 'owner' },
      update: {},
    });

    // Register team.
    await globalDb().owner_team_registry.upsert({
      where: { team_id: teamId },
      create: { team_id: teamId, owner_user_id: ownerId, status: 'active', is_extra: false },
      update: {},
    });
  });

  beforeEach(async () => {
    await clearRateKeys();
  });

  afterAll(async () => {
    if (teamId) {
      await globalDb().owner_team_registry.deleteMany({ where: { team_id: teamId } });
      await forTeam(teamId).memberships.deleteMany({ where: { team_id: teamId } });
      await forTeam(teamId).teams.deleteMany({ where: { id: teamId } });
    }
    await shutdownAuthTest();
  });

  describe('processAccountRenewalJob', () => {
    it('skips account that does not exist', async () => {
      const result = await processAccountRenewalJob(renewalJob('00000000-0000-0000-0000-000000000000', new Date()));
      expect(result.processed).toBe(false);
    });

    it('skips non-active account', async () => {
      await globalDb().owner_accounts.create({
        data: {
          user_id: ownerId,
          plan: 'monthly',
          status: 'cancelled',
          currency: 'NGN',
        },
      });
      const result = await processAccountRenewalJob(renewalJob(ownerId, new Date(Date.now() - 86400000)));
      expect(result.processed).toBe(false);
    });

    it('cancels at period end when cancel_at_period_end is set', async () => {
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: { status: 'active', cancel_at_period_end: true },
      });
      const result = await processAccountRenewalJob(renewalJob(ownerId, new Date(Date.now() - 86400000)));
      expect(result.processed).toBe(true);

      const account = await globalDb().owner_accounts.findUnique({ where: { user_id: ownerId } });
      if (!account) throw new Error('account not found after cancel');
      expect(account.status).toBe('cancelled');

      // Restore.
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: { status: 'active', cancel_at_period_end: false },
      });
    });

    it('fails visibly when no entitlements row', async () => {
      await globalDb().plan_entitlements.delete({ where: { interval: 'monthly' } });
      const result = await processAccountRenewalJob(renewalJob(ownerId, new Date(Date.now() - 86400000)));
      expect(result.processed).toBe(false);
      const account = await globalDb().owner_accounts.findUnique({ where: { user_id: ownerId } });
      if (!account) throw new Error('account not found after renewal failure');
      expect(account.status).toBe('past_due');
      expect(account.grace_ends_at).not.toBeNull();

      // Restore entitlements.
      await globalDb().plan_entitlements.create({
        data: {
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
      });
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: { status: 'active', grace_ends_at: null },
      });
    });

    afterEach(async () => {
      // Ensure owner account is restored to active monthly state even if a test throws.
      await globalDb().owner_accounts.updateMany({
        where: { user_id: ownerId },
        data: { plan: 'monthly', status: 'active', cancel_at_period_end: false, grace_ends_at: null },
      });
    });

    it('monthly renewal charges 650,000 (base price without multiplier)', async () => {
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: { plan: 'monthly', status: 'active', cancel_at_period_end: false },
      });
      const periodEnd = new Date(Date.now() - 3600000);
      const txRef = `account_renewal:${ownerId}:${periodEnd.toISOString()}`;
      await processAccountRenewalJob(renewalJob(ownerId, periodEnd));

      const intent = await globalDb().payment_intents.findUnique({
        where: { tx_ref: txRef },
      });
      expect(intent).not.toBeNull();
      expect(intent?.team_id).toBe(teamId);
      expect(Number(intent?.amount_minor)).toBe(650000);
    });

    it('yearly renewal charges 7,800,000 (base price without multiplier)', async () => {
      try {
        await globalDb().owner_accounts.update({
          where: { user_id: ownerId },
          data: { plan: 'yearly', status: 'active', cancel_at_period_end: false },
        });
        const periodEnd = new Date(Date.now() - 7200000);
        const txRef = `account_renewal:${ownerId}:${periodEnd.toISOString()}`;
        await processAccountRenewalJob(renewalJob(ownerId, periodEnd));

        const intent = await globalDb().payment_intents.findUnique({
          where: { tx_ref: txRef },
        });
        expect(intent).not.toBeNull();
        expect(intent?.team_id).toBe(teamId);
        expect(Number(intent?.amount_minor)).toBe(7800000);
      } finally {
        await globalDb().owner_accounts.update({
          where: { user_id: ownerId },
          data: { plan: 'monthly' },
        });
      }
    });

    it('consistency: yearly subscribe quote == renewal base charge == plan_entitlements yearly base_price_minor', async () => {
      try {
        const quoteRes = await quote(ownerId, { action: 'subscribe', interval: 'yearly' });
        const entitlements = await globalDb().plan_entitlements.findUnique({ where: { interval: 'yearly' } });
        expect(entitlements).not.toBeNull();
        const basePriceMinor = Number(entitlements?.base_price_minor);

        await globalDb().owner_accounts.update({
          where: { user_id: ownerId },
          data: { plan: 'yearly', status: 'active', cancel_at_period_end: false },
        });
        const periodEnd = new Date(Date.now() - 10800000);
        const txRef = `account_renewal:${ownerId}:${periodEnd.toISOString()}`;
        await processAccountRenewalJob(renewalJob(ownerId, periodEnd));
        const intent = await globalDb().payment_intents.findUnique({
          where: { tx_ref: txRef },
        });
        const renewalCharge = Number(intent?.amount_minor);

        expect(intent?.team_id).toBe(teamId);
        expect(quoteRes.amountMinor).toBe(basePriceMinor);
        expect(renewalCharge).toBe(basePriceMinor);
        expect(quoteRes.amountMinor).toBe(7800000);
        expect(renewalCharge).toBe(7800000);
      } finally {
        await globalDb().owner_accounts.update({
          where: { user_id: ownerId },
          data: { plan: 'monthly' },
        });
      }
    });

    it('owner with no registry rows rejects with explicit unrecoverable error and writes no intent', async () => {
      const noTeamOwnerId = await createVerifiedUser(uniqueEmail('arn-no-team'), 'OwnerPass123#');
      await globalDb().owner_accounts.create({
        data: {
          user_id: noTeamOwnerId,
          plan: 'monthly',
          status: 'active',
          currency: 'NGN',
        },
      });

      const periodEnd = new Date(Date.now() - 14400000);
      let caughtErr: unknown = null;
      try {
        await processAccountRenewalJob(renewalJob(noTeamOwnerId, periodEnd));
      } catch (err) {
        caughtErr = err;
      }
      expect(caughtErr).toBeInstanceOf(UnrecoverableError);
      expect((caughtErr as Error)?.name).toBe('UnrecoverableError');
      expect((caughtErr as Error)?.message).toBe('account renewal: owner has no team to attach the renewal payment to');

      const intent = await globalDb().payment_intents.findFirst({
        where: { created_by: noTeamOwnerId },
      });
      expect(intent).toBeNull();
    });

    it('renewal with extra teams includes extra team price in total charge', async () => {
      const extraTeamId = randomUUID();
      try {
        await forTeam(extraTeamId).teams.create({
          data: { id: extraTeamId, name: 'Extra Renewal Team', created_by: ownerId },
        });
        await globalDb().owner_team_registry.create({
          data: {
            team_id: extraTeamId,
            owner_user_id: ownerId,
            status: 'active',
            is_extra: true,
          },
        });

        // Hand calculation for monthly renewal with 1 extra team:
        //   monthly base_price_minor from plan_entitlements = 650,000 kobo (₦6,500.00)
        //   monthly extra_team_price_minor from plan_entitlements = 200,000 kobo (₦2,000.00)
        //   extra teams count = 1 (is_extra: true)
        //   extra people = 0 (team has 0 extra people)
        //   total charge = 650,000 + (1 * 200,000) = 850,000 kobo (₦8,500.00)
        //   intent.team_id must associate with the primary team (oldest registered team: teamId)
        const periodEnd = new Date(Date.now() - 18000000);
        const txRef = `account_renewal:${ownerId}:${periodEnd.toISOString()}`;
        await processAccountRenewalJob(renewalJob(ownerId, periodEnd));

        const intent = await globalDb().payment_intents.findUnique({
          where: { tx_ref: txRef },
        });
        expect(intent).not.toBeNull();
        expect(intent?.team_id).toBe(teamId);
        expect(Number(intent?.amount_minor)).toBe(850000);
        expect(intent?.seats).toBe(1);
      } finally {
        await globalDb().owner_team_registry.deleteMany({ where: { team_id: extraTeamId } });
        await forTeam(extraTeamId).teams.deleteMany({ where: { id: extraTeamId } });
      }
    });
  });

  describe('processAccountGraceReminder', () => {
    it('skips non-past_due account', async () => {
      const result = await processAccountGraceReminder(graceJob(ownerId));
      expect(result.processed).toBe(false);
    });

    it('sets read_only at day 7', async () => {
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: {
          status: 'past_due',
          grace_ends_at: new Date(Date.now() - 86400000),
        },
      });
      const result = await processAccountGraceReminder(graceJob(ownerId));
      expect(result.processed).toBe(true);
      const account = await globalDb().owner_accounts.findUnique({ where: { user_id: ownerId } });
      if (!account) throw new Error('account not found after grace reminder');
      expect(account.status).toBe('read_only');

      // Restore.
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: { status: 'active', grace_ends_at: null },
      });
    });

    it('enqueues day 0/3/6 notices', async () => {
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: {
          status: 'past_due',
          grace_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
      const result = await processAccountGraceReminder(graceJob(ownerId));
      expect(result.processed).toBe(true);
      const account = await globalDb().owner_accounts.findUnique({ where: { user_id: ownerId } });
      if (!account) throw new Error('account not found after grace reminder');
      expect(account.status).toBe('past_due');

      // Restore.
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: { status: 'active', grace_ends_at: null },
      });
    });
  });

  describe('processAccountYearlyReminder', () => {
    it('skips non-yearly account', async () => {
      const result = await processAccountYearlyReminder(yearlyJob(ownerId, new Date(Date.now() + 14 * 86400000)));
      expect(result.processed).toBe(false);
    });

    it('enqueues reminder at 14/7/3 days before yearly renewal', async () => {
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: { plan: 'yearly', status: 'active' },
      });
      for (const days of [14, 7, 3]) {
        const result = await processAccountYearlyReminder(yearlyJob(ownerId, new Date(Date.now() + days * 86400000)));
        expect(result.processed).toBe(true);
      }
      // Restore.
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: { plan: 'monthly' },
      });
    });
  });

  describe('processAccountTrialEnd', () => {
    it('sets read_only when trial ended', async () => {
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: {
          status: 'trialing',
          trial_ends_at: new Date(Date.now() - 86400000),
        },
      });
      const result = await processAccountTrialEnd(trialEndJob(ownerId));
      expect(result.processed).toBe(true);
      const account = await globalDb().owner_accounts.findUnique({ where: { user_id: ownerId } });
      if (!account) throw new Error('account not found after trial end');
      expect(account.status).toBe('read_only');
      expect(account.lapsed_at).not.toBeNull();

      // Restore.
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: { status: 'active', trial_ends_at: null, lapsed_at: null },
      });
    });

    it('does not send deletion warnings for lapsed read_only account at 23 and 29 days', async () => {
      for (const days of [23, 29]) {
        await globalDb().owner_accounts.update({
          where: { user_id: ownerId },
          data: {
            status: 'read_only',
            trial_ends_at: new Date(Date.now() - days * 86400000),
            lapsed_at: new Date(Date.now() - days * 86400000),
          },
        });
        const result = await processAccountTrialEnd(trialEndJob(ownerId));
        expect(result.processed).toBe(true);

        const account = await globalDb().owner_accounts.findUnique({ where: { user_id: ownerId } });
        expect(account?.status).toBe('read_only');

        const outboxRows = await globalDb().notification_outbox.findMany({
          where: {
            recipient_user_id: ownerId,
            category: 'billing.account_deletion_warning',
          },
        });
        expect(outboxRows.length).toBe(0);
      }

      // Restore.
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: { status: 'active', trial_ends_at: null, lapsed_at: null },
      });
    });
  });
});
