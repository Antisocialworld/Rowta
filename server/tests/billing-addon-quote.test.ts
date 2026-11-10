// Add-on minimum charge and interval switch unit/integration tests (Phase 6 / G6c C7).
// Tests that:
// 1. A prorated add-on amount below minAddonChargeMinor is clamped to minAddonChargeMinor immediately (not 0).
// 2. Quantity 0 (no extra people) is charged 0.
// 3. Minimum is read dynamically from plan_entitlements (not hardcoded).
// 4. Switching from yearly to monthly mid-period rejects with 422 billing.switch_not_available_yet.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
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
import { globalDb } from '../src/db/clients.ts';
import { signAccessToken } from '../src/security/access-token.ts';
import { quote } from '../src/billing/account-service.ts';
import { HttpError } from '../src/middleware/error.ts';

let app: Hono;

describe('Add-on minimum charge and interval switch (C7)', () => {
  let ownerId: string;
  let ownerAuth: Record<string, string>;
  let teamId: string;

  beforeAll(async () => {
    await clearRateKeys();
    await ensureTestCountries();
    app = testApp('billing-addon-quote');

    ownerId = await createVerifiedUser(uniqueEmail('addon-quote-owner'), 'OwnerPass123#');
    ownerAuth = { authorization: `Bearer ${await signAccessToken(ownerId)}` };

    // Create team
    const teamRes = await post(app, '/teams', { name: 'Quote Test Team' }, {
      ...ownerAuth,
      'idempotency-key': uniqueEmail('billing'),
    });
    expect(teamRes.status).toBe(201);
    teamId = ((await dataOf(teamRes)).id as string);

    // Upsert plan_entitlements with custom min_addon_charge_minor (e.g. 50,000 kobo = ₦500)
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
      update: {
        min_addon_charge_minor: BigInt(50000),
      },
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
      update: {
        min_addon_charge_minor: BigInt(50000),
      },
    });

    // Create an active monthly owner account ending in 3 days (out of a 30-day period)
    const now = Date.now();
    await globalDb().owner_accounts.upsert({
      where: { user_id: ownerId },
      create: {
        user_id: ownerId,
        plan: 'monthly',
        status: 'active',
        period_start: new Date(now - 27 * 24 * 60 * 60 * 1000),
        period_end: new Date(now + 3 * 24 * 60 * 60 * 1000),
        currency: 'NGN',
      },
      update: {
        plan: 'monthly',
        status: 'active',
        period_start: new Date(now - 27 * 24 * 60 * 60 * 1000),
        period_end: new Date(now + 3 * 24 * 60 * 60 * 1000),
      },
    });

    await globalDb().owner_team_registry.upsert({
      where: { team_id: teamId },
      create: { team_id: teamId, owner_user_id: ownerId, status: 'active', is_extra: false },
      update: {},
    });
  });

  afterAll(async () => {
    await shutdownAuthTest();
  });

  it('prorated amount below minimum is clamped to minAddonChargeMinor immediately (not 0)', async () => {
    // 3 days remaining out of 30:
    // extra team: 200,000 * 3 / 30 = 20,000 kobo.
    // 20,000 < minAddonChargeMinor (50,000 kobo).
    const result = await quote(ownerId, { action: 'add_team', teamId });
    expect(result.amountMinor).toBe(50000); // clamped to minAddonChargeMinor, not 0
    expect(result.effectiveFrom).toBe('now');
  });

  it('quantity 0 is charged 0 and deferred to next renewal', async () => {
    // team has 10 included people; asking for 5 people means 0 extra people.
    const result = await quote(ownerId, { action: 'add_people', teamId, people: 5 });
    expect(result.amountMinor).toBe(0);
    expect(result.effectiveFrom).toBe('next_renewal');
  });

  it('minimum charge is read from plan_entitlements table, not hardcoded', async () => {
    const entitlements = await globalDb().plan_entitlements.findUnique({ where: { interval: 'monthly' } });
    expect(entitlements).not.toBeNull();
    const minCharge = Number(entitlements?.min_addon_charge_minor);

    const result = await quote(ownerId, { action: 'add_team', teamId });
    expect(result.amountMinor).toBe(minCharge);
  });

  it('yearly add_team and add_people quotes use yearly row values with deterministic proration', async () => {
    const now = Date.now();
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    // Set fixed period: periodDays = 200, remainingDays = 100 (deterministic ratio 100/200 = 0.5)
    // Extra 5 minutes avoids millisecond rounding boundary jitter across test execution.
    await globalDb().owner_accounts.update({
      where: { user_id: ownerId },
      data: {
        plan: 'yearly',
        status: 'active',
        period_start: new Date(now - 100 * MS_PER_DAY),
        period_end: new Date(now + 100 * MS_PER_DAY + 5 * 60 * 1000),
      },
    });

    // Hand calculation for add_team:
    //   yearly extra_team_price_minor from plan_entitlements = 2,400,000 kobo (₦24,000.00)
    //   remainingDays = 100, periodDays = 200 => ratio = 100 / 200 = 0.5
    //   prorated = floor(2,400,000 * 100 / 200) = 1,200,000 kobo (₦12,000.00)
    //   (without the fix, multiplying by intervalMultiplier(12) would have erroneously yielded 14,400,000 kobo)
    const teamQuote = await quote(ownerId, { action: 'add_team', teamId });
    expect(teamQuote.amountMinor).toBe(1200000);
    expect(teamQuote.effectiveFrom).toBe('now');

    // Read people_per_team and extra_person_price_minor from the actual plan_entitlements yearly row at runtime:
    const yearlyEntitlements = await globalDb().plan_entitlements.findUnique({ where: { interval: 'yearly' } });
    expect(yearlyEntitlements).not.toBeNull();
    const includedPeople = yearlyEntitlements!.people_per_team;
    const extraPersonPriceMinor = Number(yearlyEntitlements!.extra_person_price_minor);

    // Hand calculation for add_people:
    //   request people = includedPeople + 5 => extra people = 5
    //   unprorated extra = 5 * extraPersonPriceMinor
    //   remainingDays = 100, periodDays = 200 => ratio = 100 / 200 = 0.5
    //   prorated = floor(5 * extraPersonPriceMinor * 100 / 200)
    //   (without the fix, multiplying by intervalMultiplier(12) would have erroneously scaled by 12x)
    const expectedPeopleAmount = Math.floor((5 * extraPersonPriceMinor * 100) / 200);
    const peopleQuote = await quote(ownerId, { action: 'add_people', teamId, people: includedPeople + 5 });
    expect(peopleQuote.amountMinor).toBe(expectedPeopleAmount);
    expect(peopleQuote.effectiveFrom).toBe('now');
  });

  it('yearly to monthly switch mid-period rejects with 422 billing.switch_not_available_yet', async () => {
    // Set account to active yearly
    await globalDb().owner_accounts.update({
      where: { user_id: ownerId },
      data: { plan: 'yearly' },
    });

    try {
      await quote(ownerId, { action: 'switch_interval', interval: 'monthly' });
      expect.unreachable('Should have thrown 422 HttpError');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      const httpErr = err as HttpError;
      expect(httpErr.status).toBe(422);
      expect(httpErr.code).toBe('billing.switch_not_available_yet');
      expect(httpErr.message).toBe('You can switch to monthly when your yearly plan ends.');
    }
  });

  it('POST /billing/account/quote route returns 422 for yearly to monthly downgrade', async () => {
    const res = await post(
      app,
      '/billing/account/quote',
      { action: 'switch_interval', interval: 'monthly' },
      ownerAuth,
    );
    expect(res.status).toBe(422);
    const err = await errorOf(res);
    expect(err.code).toBe('billing.switch_not_available_yet');
  });
});

