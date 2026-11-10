// Account-level billing webhook integration tests (Task D).
// Tests for processWebhookJob handling account_* intents and cancellation replay.
// Imports from server/src/billing/*, server/src/jobs/* and test helpers only.
// Run from repo root:  npm test --workspace @rowta/server -- billing-account-webhook
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import type { Hono } from 'hono';
import { globalDb, forTeam } from '../src/db/clients.ts';
import { processWebhookJob, type WebhookJobData } from '../src/jobs/webhook-processor.ts';
import { simulatorProvider } from '../src/billing/simulator.ts';
import { flutterwaveProvider } from '../src/billing/flutterwave-client.ts';
import { signAccessToken } from '../src/security/access-token.ts';
import {
  clearRateKeys,
  createVerifiedUser,
  dataOf,
  ensureTestCountries,
  post,
  shutdownAuthTest,
  testApp,
  uniqueEmail,
} from './helpers/auth-test.ts';

let app: Hono;

function webhookJob(txRef: string, eventType = 'charge.completed'): Job<WebhookJobData> {
  return { data: { txRef, eventType } } as Job<WebhookJobData>;
}

async function createTeamFor(auth: Record<string, string>, name: string): Promise<string> {
  const res = await post(app, '/teams', { name }, { ...auth, 'idempotency-key': uniqueEmail('billing') });
  expect(res.status).toBe(201);
  return (await dataOf(res)).id as string;
}

describe('account-level billing webhook (Task D)', () => {
  let ownerId: string;
  let ownerAuth: Record<string, string>;
  let teamId: string;
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdTxRefs: string[] = [];

  beforeAll(async () => {
    await clearRateKeys();
    await ensureTestCountries();
    app = testApp('billing-account-webhook');

    ownerId = await createVerifiedUser(uniqueEmail('baw-owner'), 'OwnerPass123#');
    createdUserIds.push(ownerId);
    ownerAuth = { authorization: `Bearer ${await signAccessToken(ownerId)}` };

    teamId = await createTeamFor(ownerAuth, 'Webhook Primary Team');
    createdTeamIds.push(teamId);

    // Seed plan_entitlements
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
  });

  beforeEach(async () => {
    await clearRateKeys();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    for (const txRef of createdTxRefs) {
      await globalDb().payment_intents.deleteMany({ where: { tx_ref: txRef } }).catch(() => undefined);
      await globalDb().webhook_events.deleteMany({ where: { tx_ref: txRef } }).catch(() => undefined);
    }
    for (const tid of createdTeamIds) {
      await forTeam(tid).ledger_entries.deleteMany({ where: { team_id: tid } }).catch(() => undefined);
      await forTeam(tid).notification_outbox.deleteMany({ where: { recipient_user_id: { in: createdUserIds } } }).catch(() => undefined);
      await forTeam(tid).activity_events.deleteMany({ where: { team_id: tid } }).catch(() => undefined);
      await globalDb().owner_team_registry.deleteMany({ where: { team_id: tid } }).catch(() => undefined);
      await forTeam(tid).memberships.deleteMany({ where: { team_id: tid } }).catch(() => undefined);
      await forTeam(tid).teams.deleteMany({ where: { id: tid } }).catch(() => undefined);
    }
    for (const uid of createdUserIds) {
      await globalDb().owner_accounts.deleteMany({ where: { user_id: uid } }).catch(() => undefined);
    }
    await shutdownAuthTest();
  });

  // D1 first purchase: a pending account_subscribe intent plus a successful verified webhook
  // => owner_accounts status 'active', plan and period_start/period_end set, exactly ONE ledger row
  // with provider_ref = tx_ref, intent 'succeeded', exactly one billing.received notification.
  it('D1 first purchase: activates trialing account, sets periods, writes ledger row and notification', async () => {
    const txRef = `d1-sub-${randomUUID()}`;
    createdTxRefs.push(txRef);

    // Initial account state: trialing
    await globalDb().owner_accounts.upsert({
      where: { user_id: ownerId },
      create: {
        user_id: ownerId,
        plan: 'monthly',
        status: 'trialing',
        trial_used: true,
        currency: 'NGN',
      },
      update: {
        plan: 'monthly',
        status: 'trialing',
        trial_used: true,
        period_start: null,
        period_end: null,
      },
    });

    // Create pending account_subscribe intent
    await globalDb().payment_intents.create({
      data: {
        id: randomUUID(),
        team_id: teamId,
        tx_ref: txRef,
        purpose: 'account_action',
        amount_minor: BigInt(650000),
        currency: 'NGN',
        status: 'pending',
        idempotency_key: `idem-${txRef}`,
        created_by: ownerId,
        plan: 'monthly',
        seats: 0,
        interval: 'month',
        kind: 'account_subscribe',
      },
    });
    await globalDb().webhook_events.create({
      data: {
        provider: 'flutterwave',
        provider_event_id: `evt-${txRef}`,
        event_type: 'charge.completed',
        tx_ref: txRef,
        status: 'received',
      },
    });

    // Stub provider verification returning successful NGN 6500 (Naira = 650000 kobo)
    const stubResult = {
      status: 'succeeded' as const,
      amountMinor: 6500, // Provider major unit for NGN
      currency: 'NGN',
      txRef,
    };
    vi.spyOn(simulatorProvider, 'verifyTransaction').mockResolvedValue(stubResult);
    vi.spyOn(flutterwaveProvider, 'verifyTransaction').mockResolvedValue(stubResult);

    const result = await processWebhookJob(webhookJob(txRef));
    expect(result.processed).toBe(true);

    // 1. owner_accounts status 'active', plan and periods set
    const account = await globalDb().owner_accounts.findUnique({ where: { user_id: ownerId } });
    expect(account).not.toBeNull();
    expect(account!.status).toBe('active');
    expect(account!.plan).toBe('monthly');
    expect(account!.period_start).toBeInstanceOf(Date);
    expect(account!.period_end).toBeInstanceOf(Date);
    expect(account!.cancel_at_period_end).toBe(false);

    // 2. Exactly ONE ledger row with provider_ref = tx_ref
    const ledgers = await forTeam(teamId).ledger_entries.findMany({ where: { provider_ref: txRef } });
    expect(ledgers.length).toBe(1);
    expect(ledgers[0]!.amount_minor).toBe(BigInt(650000));
    expect(ledgers[0]!.kind).toBe('charge');

    // 3. Intent marked succeeded
    const intent = await globalDb().payment_intents.findUnique({ where: { tx_ref: txRef } });
    expect(intent?.status).toBe('succeeded');

    // 4. Exactly one billing.received notification
    const notifs = await forTeam(teamId).notification_outbox.findMany({
      where: { recipient_user_id: ownerId, category: 'billing.received' },
    });
    expect(notifs.length).toBe(1);
  });

  // D2 duplicate: the same webhook processed a second time => returns processed:false,
  // ledger row count still 1, owner_accounts period fields unchanged, notification count still 1.
  it('D2 duplicate: second webhook for same tx_ref returns false and changes nothing', async () => {
    const txRef = `d2-dup-${randomUUID()}`;
    createdTxRefs.push(txRef);

    await globalDb().payment_intents.create({
      data: {
        id: randomUUID(),
        team_id: teamId,
        tx_ref: txRef,
        purpose: 'account_action',
        amount_minor: BigInt(650000),
        currency: 'NGN',
        status: 'pending',
        idempotency_key: `idem-${txRef}`,
        created_by: ownerId,
        plan: 'monthly',
        seats: 0,
        interval: 'month',
        kind: 'account_subscribe',
      },
    });
    await globalDb().webhook_events.create({
      data: {
        provider: 'flutterwave',
        provider_event_id: `evt-${txRef}`,
        event_type: 'charge.completed',
        tx_ref: txRef,
        status: 'received',
      },
    });

    const stubResult = {
      status: 'succeeded' as const,
      amountMinor: 6500,
      currency: 'NGN',
      txRef,
    };
    vi.spyOn(simulatorProvider, 'verifyTransaction').mockResolvedValue(stubResult);
    vi.spyOn(flutterwaveProvider, 'verifyTransaction').mockResolvedValue(stubResult);

    // First run completes
    const run1 = await processWebhookJob(webhookJob(txRef));
    expect(run1.processed).toBe(true);

    const accountAfterRun1 = await globalDb().owner_accounts.findUnique({ where: { user_id: ownerId } });
    const periodStart1 = accountAfterRun1!.period_start?.getTime();
    const periodEnd1 = accountAfterRun1!.period_end?.getTime();

    const notifsAfterRun1 = await forTeam(teamId).notification_outbox.count({
      where: { recipient_user_id: ownerId, category: 'billing.received' },
    });

    // Duplicate run
    const run2 = await processWebhookJob(webhookJob(txRef));
    expect(run2.processed).toBe(false);

    // Ledger count still 1
    const ledgers = await forTeam(teamId).ledger_entries.findMany({ where: { provider_ref: txRef } });
    expect(ledgers.length).toBe(1);

    // Periods unchanged
    const accountAfterRun2 = await globalDb().owner_accounts.findUnique({ where: { user_id: ownerId } });
    expect(accountAfterRun2!.period_start?.getTime()).toBe(periodStart1);
    expect(accountAfterRun2!.period_end?.getTime()).toBe(periodEnd1);

    // Notification count still unchanged
    const notifsAfterRun2 = await forTeam(teamId).notification_outbox.count({
      where: { recipient_user_id: ownerId, category: 'billing.received' },
    });
    expect(notifsAfterRun2).toBe(notifsAfterRun1);
  });

  // D3 upgrade only after payment: account_add_team intent: before the webhook the registry
  // row is still pending_payment; after it is active. account_switch_interval intent: plan
  // unchanged before the webhook, changed after.
  it('D3 upgrade only after payment: team registry and interval switch update only after webhook', async () => {
    // 1. account_add_team
    const extraTeamId = await createTeamFor(ownerAuth, 'Extra Pending Team');
    createdTeamIds.push(extraTeamId);

    // Mark extra team pending_payment
    await globalDb().owner_team_registry.update({
      where: { team_id: extraTeamId },
      data: { status: 'pending_payment', is_extra: true },
    });

    const txRefTeam = `d3-team-${randomUUID()}`;
    createdTxRefs.push(txRefTeam);

    await globalDb().payment_intents.create({
      data: {
        id: randomUUID(),
        team_id: extraTeamId,
        tx_ref: txRefTeam,
        purpose: 'account_action',
        amount_minor: BigInt(200000),
        currency: 'NGN',
        status: 'pending',
        idempotency_key: `idem-${txRefTeam}`,
        created_by: ownerId,
        plan: 'monthly',
        seats: 0,
        interval: 'month',
        kind: 'account_add_team',
      },
    });

    // Before webhook: registry row is still pending_payment
    const regBefore = await globalDb().owner_team_registry.findUnique({ where: { team_id: extraTeamId } });
    expect(regBefore?.status).toBe('pending_payment');

    const stubResultTeam = {
      status: 'succeeded' as const,
      amountMinor: 2000, // ₦2000 in provider units = 200,000 kobo
      currency: 'NGN',
      txRef: txRefTeam,
    };
    vi.spyOn(simulatorProvider, 'verifyTransaction').mockResolvedValue(stubResultTeam);
    vi.spyOn(flutterwaveProvider, 'verifyTransaction').mockResolvedValue(stubResultTeam);

    const runTeam = await processWebhookJob(webhookJob(txRefTeam));
    expect(runTeam.processed).toBe(true);

    // After webhook: registry row is active
    const regAfter = await globalDb().owner_team_registry.findUnique({ where: { team_id: extraTeamId } });
    expect(regAfter?.status).toBe('active');

    // 2. account_switch_interval
    await globalDb().owner_accounts.update({
      where: { user_id: ownerId },
      data: { plan: 'monthly', status: 'active' },
    });

    const txRefSwitch = `d3-switch-${randomUUID()}`;
    createdTxRefs.push(txRefSwitch);

    await globalDb().payment_intents.create({
      data: {
        id: randomUUID(),
        team_id: teamId,
        tx_ref: txRefSwitch,
        purpose: 'account_action',
        amount_minor: BigInt(7800000),
        currency: 'NGN',
        status: 'pending',
        idempotency_key: `idem-${txRefSwitch}`,
        created_by: ownerId,
        plan: 'yearly',
        seats: 0,
        interval: 'year',
        kind: 'account_switch_interval',
      },
    });

    // Before webhook: plan is still monthly
    const acctBefore = await globalDb().owner_accounts.findUnique({ where: { user_id: ownerId } });
    expect(acctBefore?.plan).toBe('monthly');

    const stubResultSwitch = {
      status: 'succeeded' as const,
      amountMinor: 78000, // ₦78,000 = 7,800,000 kobo
      currency: 'NGN',
      txRef: txRefSwitch,
    };
    vi.spyOn(simulatorProvider, 'verifyTransaction').mockResolvedValue(stubResultSwitch);
    vi.spyOn(flutterwaveProvider, 'verifyTransaction').mockResolvedValue(stubResultSwitch);

    const runSwitch = await processWebhookJob(webhookJob(txRefSwitch));
    expect(runSwitch.processed).toBe(true);

    // After webhook: plan is changed to yearly
    const acctAfter = await globalDb().owner_accounts.findUnique({ where: { user_id: ownerId } });
    expect(acctAfter?.plan).toBe('yearly');
  });

  // D4 renewal: an account_renewal intent => period_start/period_end advance,
  // grace_ends_at and lapsed_at cleared, one ledger row.
  it('D4 renewal: advances periods, clears grace_ends_at and lapsed_at, writes ledger row', async () => {
    const oldStart = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const oldEnd = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const graceEnd = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
    const lapsedAt = new Date();

    await globalDb().owner_accounts.update({
      where: { user_id: ownerId },
      data: {
        status: 'past_due',
        plan: 'monthly',
        period_start: oldStart,
        period_end: oldEnd,
        grace_ends_at: graceEnd,
        lapsed_at: lapsedAt,
      },
    });

    const txRefRenewal = `d4-renew-${randomUUID()}`;
    createdTxRefs.push(txRefRenewal);

    await globalDb().payment_intents.create({
      data: {
        id: randomUUID(),
        team_id: teamId,
        tx_ref: txRefRenewal,
        purpose: 'renewal',
        amount_minor: BigInt(650000),
        currency: 'NGN',
        status: 'pending',
        idempotency_key: `idem-${txRefRenewal}`,
        created_by: ownerId,
        plan: 'monthly',
        seats: 1,
        interval: 'month',
        kind: 'account_renewal',
      },
    });

    const stubResult = {
      status: 'succeeded' as const,
      amountMinor: 6500,
      currency: 'NGN',
      txRef: txRefRenewal,
    };
    vi.spyOn(simulatorProvider, 'verifyTransaction').mockResolvedValue(stubResult);
    vi.spyOn(flutterwaveProvider, 'verifyTransaction').mockResolvedValue(stubResult);

    const run = await processWebhookJob(webhookJob(txRefRenewal));
    expect(run.processed).toBe(true);

    const account = await globalDb().owner_accounts.findUnique({ where: { user_id: ownerId } });
    expect(account!.status).toBe('active');
    expect(account!.period_start!.getTime()).toBeGreaterThan(oldStart.getTime());
    expect(account!.period_end!.getTime()).toBeGreaterThan(oldEnd.getTime());
    expect(account!.grace_ends_at).toBeNull();
    expect(account!.lapsed_at).toBeNull();

    const ledgers = await forTeam(teamId).ledger_entries.findMany({ where: { provider_ref: txRefRenewal } });
    expect(ledgers.length).toBe(1);
    expect(ledgers[0]!.kind).toBe('charge');
  });

  // D5 failure changes nothing: an underpaid webhook and a failed-status webhook each
  // leave owner_accounts and owner_team_registry unchanged and mark the intent 'failed'.
  it('D5 failure changes nothing: underpayment and failed-status leave account unchanged and mark intent failed', async () => {
    // Baseline state
    await globalDb().owner_accounts.update({
      where: { user_id: ownerId },
      data: { status: 'active', plan: 'monthly', grace_ends_at: null },
    });
    const baselineAcct = await globalDb().owner_accounts.findUnique({ where: { user_id: ownerId } });

    // 1. Underpayment
    const txRefUnderpaid = `d5-under-${randomUUID()}`;
    createdTxRefs.push(txRefUnderpaid);

    await globalDb().payment_intents.create({
      data: {
        id: randomUUID(),
        team_id: teamId,
        tx_ref: txRefUnderpaid,
        purpose: 'account_action',
        amount_minor: BigInt(650000),
        currency: 'NGN',
        status: 'pending',
        idempotency_key: `idem-${txRefUnderpaid}`,
        created_by: ownerId,
        plan: 'monthly',
        seats: 0,
        interval: 'month',
        kind: 'account_subscribe',
      },
    });

    // Provider returns ₦100 (10,000 kobo < 650,000 kobo)
    const underpaidStub = {
      status: 'succeeded' as const,
      amountMinor: 100,
      currency: 'NGN',
      txRef: txRefUnderpaid,
    };
    vi.spyOn(simulatorProvider, 'verifyTransaction').mockResolvedValue(underpaidStub);
    vi.spyOn(flutterwaveProvider, 'verifyTransaction').mockResolvedValue(underpaidStub);

    const runUnderpaid = await processWebhookJob(webhookJob(txRefUnderpaid));
    expect(runUnderpaid.processed).toBe(false);

    const intentUnderpaid = await globalDb().payment_intents.findUnique({ where: { tx_ref: txRefUnderpaid } });
    expect(intentUnderpaid?.status).toBe('failed');

    const acctAfterUnderpaid = await globalDb().owner_accounts.findUnique({ where: { user_id: ownerId } });
    expect(acctAfterUnderpaid?.status).toBe(baselineAcct?.status);
    expect(acctAfterUnderpaid?.plan).toBe(baselineAcct?.plan);

    const ledgersUnderpaid = await forTeam(teamId).ledger_entries.findMany({ where: { provider_ref: txRefUnderpaid } });
    expect(ledgersUnderpaid.length).toBe(0);

    // 2. Failed provider status
    const txRefFailed = `d5-fail-${randomUUID()}`;
    createdTxRefs.push(txRefFailed);

    await globalDb().payment_intents.create({
      data: {
        id: randomUUID(),
        team_id: teamId,
        tx_ref: txRefFailed,
        purpose: 'account_action',
        amount_minor: BigInt(650000),
        currency: 'NGN',
        status: 'pending',
        idempotency_key: `idem-${txRefFailed}`,
        created_by: ownerId,
        plan: 'monthly',
        seats: 0,
        interval: 'month',
        kind: 'account_subscribe',
      },
    });

    const failedStub = {
      status: 'failed' as const,
      amountMinor: 6500,
      currency: 'NGN',
      txRef: txRefFailed,
    };
    vi.spyOn(simulatorProvider, 'verifyTransaction').mockResolvedValue(failedStub);
    vi.spyOn(flutterwaveProvider, 'verifyTransaction').mockResolvedValue(failedStub);

    const runFailed = await processWebhookJob(webhookJob(txRefFailed));
    expect(runFailed.processed).toBe(false);

    const intentFailed = await globalDb().payment_intents.findUnique({ where: { tx_ref: txRefFailed } });
    expect(intentFailed?.status).toBe('failed');

    const acctAfterFailed = await globalDb().owner_accounts.findUnique({ where: { user_id: ownerId } });
    expect(acctAfterFailed?.status).toBe(baselineAcct?.status);
    expect(acctAfterFailed?.plan).toBe(baselineAcct?.plan);

    const ledgersFailed = await forTeam(teamId).ledger_entries.findMany({ where: { provider_ref: txRefFailed } });
    expect(ledgersFailed.length).toBe(0);
  });

  // D6 cancel replay: call POST cancel twice (same Idempotency-Key, then a different key).
  // Assert what the code actually does, with cancel_at_period_end true after the first call
  // and no change in period fields or status after the second.
  it('D6 cancel replay: first call cancels at period end; same key returns cached; new key is idempotent no-op', async () => {
    const fixedPeriodStart = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const fixedPeriodEnd = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000);

    await globalDb().owner_accounts.update({
      where: { user_id: ownerId },
      data: {
        status: 'active',
        plan: 'monthly',
        period_start: fixedPeriodStart,
        period_end: fixedPeriodEnd,
        cancel_at_period_end: false,
      },
    });

    const idemKey1 = `idem-cancel-${randomUUID()}`;

    // Call 1: First cancel with idemKey1
    const res1 = await post(
      app,
      '/billing/account/cancel',
      { confirm: 'cancel' },
      { ...ownerAuth, 'idempotency-key': idemKey1 },
    );
    expect(res1.status).toBe(200);
    const body1 = (await dataOf(res1)) as { cancelled: boolean };
    expect(body1.cancelled).toBe(true);

    const acct1 = await globalDb().owner_accounts.findUnique({ where: { user_id: ownerId } });
    expect(acct1?.cancel_at_period_end).toBe(true);
    expect(acct1?.status).toBe('active');
    expect(acct1?.period_start?.getTime()).toBe(fixedPeriodStart.getTime());
    expect(acct1?.period_end?.getTime()).toBe(fixedPeriodEnd.getTime());

    // Call 2: Replay with same Idempotency-Key
    const res2 = await post(
      app,
      '/billing/account/cancel',
      { confirm: 'cancel' },
      { ...ownerAuth, 'idempotency-key': idemKey1 },
    );
    expect(res2.status).toBe(200);
    const body2 = (await dataOf(res2)) as { cancelled: boolean };
    expect(body2.cancelled).toBe(true);

    const acct2 = await globalDb().owner_accounts.findUnique({ where: { user_id: ownerId } });
    expect(acct2?.cancel_at_period_end).toBe(true);
    expect(acct2?.status).toBe('active');
    expect(acct2?.period_start?.getTime()).toBe(fixedPeriodStart.getTime());
    expect(acct2?.period_end?.getTime()).toBe(fixedPeriodEnd.getTime());

    // Call 3: Call with different Idempotency-Key
    const idemKey2 = `idem-cancel-${randomUUID()}`;
    const res3 = await post(
      app,
      '/billing/account/cancel',
      { confirm: 'cancel' },
      { ...ownerAuth, 'idempotency-key': idemKey2 },
    );
    expect(res3.status).toBe(200);
    const body3 = (await dataOf(res3)) as { cancelled: boolean };
    expect(body3.cancelled).toBe(true);

    const acct3 = await globalDb().owner_accounts.findUnique({ where: { user_id: ownerId } });
    expect(acct3?.cancel_at_period_end).toBe(true);
    expect(acct3?.status).toBe('active');
    expect(acct3?.period_start?.getTime()).toBe(fixedPeriodStart.getTime());
    expect(acct3?.period_end?.getTime()).toBe(fixedPeriodEnd.getTime());
  });

  // Task H20: Make successful first-purchase payments order-independent and never-shrink in the webhook processor
  describe('Task H20: order-independent never-shrink subscribe webhooks', () => {
    const providerAmounts = new Map<string, number>();

    beforeEach(() => {
      providerAmounts.clear();
      const mockVerify = vi.fn().mockImplementation(async (ref: string) => {
        const amount = providerAmounts.get(ref);
        if (amount !== undefined) {
          return {
            status: 'succeeded' as const,
            amountMinor: amount / 100, // Provider major unit (Naira)
            currency: 'NGN',
            txRef: ref,
          };
        }
        return { status: 'failed' as const, amountMinor: 0, currency: '', txRef: ref };
      });
      vi.spyOn(simulatorProvider, 'verifyTransaction').mockImplementation(mockVerify);
      vi.spyOn(flutterwaveProvider, 'verifyTransaction').mockImplementation(mockVerify);
    });

    async function setupSubscribeIntent(opts: {
      userId: string;
      teamId: string;
      plan: 'monthly' | 'yearly';
      amountMinor: number;
    }): Promise<string> {
      const txRef = `h20-${opts.plan}-${randomUUID()}`;
      createdTxRefs.push(txRef);
      providerAmounts.set(txRef, opts.amountMinor);

      await globalDb().payment_intents.create({
        data: {
          id: randomUUID(),
          team_id: opts.teamId,
          tx_ref: txRef,
          purpose: 'account_action',
          amount_minor: BigInt(opts.amountMinor),
          currency: 'NGN',
          status: 'pending',
          idempotency_key: `idem-${txRef}`,
          created_by: opts.userId,
          plan: opts.plan,
          seats: 0,
          interval: opts.plan === 'yearly' ? 'year' : 'month',
          kind: 'account_subscribe',
        },
      });
      await globalDb().webhook_events.create({
        data: {
          provider: 'flutterwave',
          provider_event_id: `evt-${txRef}`,
          event_type: 'charge.completed',
          tx_ref: txRef,
          status: 'received',
        },
      });
      return txRef;
    }

    // 1. yearly active account, then a late monthly intent succeeds:
    // plan stays yearly, period_end unchanged, ledger entry recorded, intent succeeded.
    it('1. yearly active account, late monthly intent: plan stays yearly, period_end unchanged, ledger recorded', async () => {
      const initialStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const initialEnd = new Date(Date.now() + 335 * 24 * 60 * 60 * 1000);

      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: {
          status: 'active',
          plan: 'yearly',
          period_start: initialStart,
          period_end: initialEnd,
          cancel_at_period_end: false,
        },
      });

      const txRef = await setupSubscribeIntent({
        userId: ownerId,
        teamId,
        plan: 'monthly',
        amountMinor: 650000,
      });

      const res = await processWebhookJob(webhookJob(txRef));
      expect(res.processed).toBe(true);

      const acct = await globalDb().owner_accounts.findUnique({ where: { user_id: ownerId } });
      expect(acct?.status).toBe('active');
      expect(acct?.plan).toBe('yearly');
      expect(acct?.period_end?.getTime()).toBe(initialEnd.getTime());
      expect(acct?.period_start?.getTime()).toBe(initialStart.getTime());

      const ledgers = await forTeam(teamId).ledger_entries.findMany({ where: { provider_ref: txRef } });
      expect(ledgers.length).toBe(1);
      expect(ledgers[0]?.amount_minor).toBe(BigInt(650000));

      const intent = await globalDb().payment_intents.findUnique({ where: { tx_ref: txRef } });
      expect(intent?.status).toBe('succeeded');
    });

    // 2. monthly active, yearly intent succeeds: upgraded to yearly, period_end about a year out.
    it('2. monthly active, yearly intent succeeds: upgraded to yearly, period_end ~1 year out', async () => {
      const initialStart = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const initialEnd = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);

      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: {
          status: 'active',
          plan: 'monthly',
          period_start: initialStart,
          period_end: initialEnd,
          cancel_at_period_end: false,
        },
      });

      const txRef = await setupSubscribeIntent({
        userId: ownerId,
        teamId,
        plan: 'yearly',
        amountMinor: 7800000,
      });

      const res = await processWebhookJob(webhookJob(txRef));
      expect(res.processed).toBe(true);

      const acct = await globalDb().owner_accounts.findUnique({ where: { user_id: ownerId } });
      expect(acct?.status).toBe('active');
      expect(acct?.plan).toBe('yearly');
      expect(acct?.period_end?.getTime()).toBeGreaterThan(Date.now() + 350 * 24 * 60 * 60 * 1000);

      const ledgers = await forTeam(teamId).ledger_entries.findMany({ where: { provider_ref: txRef } });
      expect(ledgers.length).toBe(1);
      expect(ledgers[0]?.amount_minor).toBe(BigInt(7800000));

      const intent = await globalDb().payment_intents.findUnique({ where: { tx_ref: txRef } });
      expect(intent?.status).toBe('succeeded');
    });

    // 3. yearly active, second yearly intent succeeds: account unchanged, ledger recorded, flagged.
    it('3. yearly active, second yearly intent succeeds: account unchanged, ledger recorded', async () => {
      const initialStart = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
      const initialEnd = new Date(Date.now() + 360 * 24 * 60 * 60 * 1000);

      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: {
          status: 'active',
          plan: 'yearly',
          period_start: initialStart,
          period_end: initialEnd,
          cancel_at_period_end: false,
        },
      });

      const txRef = await setupSubscribeIntent({
        userId: ownerId,
        teamId,
        plan: 'yearly',
        amountMinor: 7800000,
      });

      const res = await processWebhookJob(webhookJob(txRef));
      expect(res.processed).toBe(true);

      const acct = await globalDb().owner_accounts.findUnique({ where: { user_id: ownerId } });
      expect(acct?.status).toBe('active');
      expect(acct?.plan).toBe('yearly');
      expect(acct?.period_end?.getTime()).toBe(initialEnd.getTime());

      const ledgers = await forTeam(teamId).ledger_entries.findMany({ where: { provider_ref: txRef } });
      expect(ledgers.length).toBe(1);
      expect(ledgers[0]?.amount_minor).toBe(BigInt(7800000));

      const intent = await globalDb().payment_intents.findUnique({ where: { tx_ref: txRef } });
      expect(intent?.status).toBe('succeeded');
    });

    // 4. trialing, subscribe: activates exactly as today.
    it('4. trialing, subscribe: activates exactly as today', async () => {
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: {
          status: 'trialing',
          plan: 'monthly',
          period_start: null,
          period_end: null,
          cancel_at_period_end: false,
        },
      });

      const txRef = await setupSubscribeIntent({
        userId: ownerId,
        teamId,
        plan: 'monthly',
        amountMinor: 650000,
      });

      const res = await processWebhookJob(webhookJob(txRef));
      expect(res.processed).toBe(true);

      const acct = await globalDb().owner_accounts.findUnique({ where: { user_id: ownerId } });
      expect(acct?.status).toBe('active');
      expect(acct?.plan).toBe('monthly');
      expect(acct?.period_start).toBeInstanceOf(Date);
      expect(acct?.period_end?.getTime()).toBeGreaterThan(Date.now() + 25 * 24 * 60 * 60 * 1000);

      const ledgers = await forTeam(teamId).ledger_entries.findMany({ where: { provider_ref: txRef } });
      expect(ledgers.length).toBe(1);

      const intent = await globalDb().payment_intents.findUnique({ where: { tx_ref: txRef } });
      expect(intent?.status).toBe('succeeded');
    });

    // 5. order independence: process {monthly, yearly} intents in both orders for fresh accounts:
    // final plan yearly with the yearly period in both cases.
    it('5. order independence: {monthly, yearly} in both orders produces identical final yearly state', async () => {
      // Case A: Monthly first, then Yearly
      const userAId = await createVerifiedUser(uniqueEmail('h20-order-a'), 'UserAPass123#');
      createdUserIds.push(userAId);
      const authA = { authorization: `Bearer ${await signAccessToken(userAId)}` };
      const teamAId = await createTeamFor(authA, 'Team Order A');
      createdTeamIds.push(teamAId);

      const txA_m = await setupSubscribeIntent({ userId: userAId, teamId: teamAId, plan: 'monthly', amountMinor: 650000 });
      const txA_y = await setupSubscribeIntent({ userId: userAId, teamId: teamAId, plan: 'yearly', amountMinor: 7800000 });

      // Process monthly first, then yearly
      await processWebhookJob(webhookJob(txA_m));
      await processWebhookJob(webhookJob(txA_y));

      const acctA = await globalDb().owner_accounts.findUnique({ where: { user_id: userAId } });
      expect(acctA?.status).toBe('active');
      expect(acctA?.plan).toBe('yearly');
      expect(acctA?.period_end?.getTime()).toBeGreaterThan(Date.now() + 350 * 24 * 60 * 60 * 1000);

      // Case B: Yearly first, then Monthly
      const userBId = await createVerifiedUser(uniqueEmail('h20-order-b'), 'UserBPass123#');
      createdUserIds.push(userBId);
      const authB = { authorization: `Bearer ${await signAccessToken(userBId)}` };
      const teamBId = await createTeamFor(authB, 'Team Order B');
      createdTeamIds.push(teamBId);

      const txB_y = await setupSubscribeIntent({ userId: userBId, teamId: teamBId, plan: 'yearly', amountMinor: 7800000 });
      const txB_m = await setupSubscribeIntent({ userId: userBId, teamId: teamBId, plan: 'monthly', amountMinor: 650000 });

      // Process yearly first, then monthly
      await processWebhookJob(webhookJob(txB_y));
      await processWebhookJob(webhookJob(txB_m));

      const acctB = await globalDb().owner_accounts.findUnique({ where: { user_id: userBId } });
      expect(acctB?.status).toBe('active');
      expect(acctB?.plan).toBe('yearly');
      expect(acctB?.period_end?.getTime()).toBeGreaterThan(Date.now() + 350 * 24 * 60 * 60 * 1000);

      // Both orders end in identical active yearly state
      expect(acctA?.status).toBe(acctB?.status);
      expect(acctA?.plan).toBe(acctB?.plan);
      const diffMs = Math.abs(acctA!.period_end!.getTime() - acctB!.period_end!.getTime());
      expect(diffMs).toBeLessThan(5000); // Created within seconds of each other
    });

    // 6. status 'past_due' (or 'cancelled') with a future period: a subscribe payment re-activates as today.
    it('6. past_due or cancelled with future period: subscribe re-activates as today', async () => {
      // 6a. past_due with future period
      const futurePastDueEnd = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: {
          status: 'past_due',
          plan: 'monthly',
          period_start: new Date(Date.now() - 27 * 24 * 60 * 60 * 1000),
          period_end: futurePastDueEnd,
          cancel_at_period_end: false,
        },
      });

      const txRefPastDue = await setupSubscribeIntent({
        userId: ownerId,
        teamId,
        plan: 'monthly',
        amountMinor: 650000,
      });

      const resPastDue = await processWebhookJob(webhookJob(txRefPastDue));
      expect(resPastDue.processed).toBe(true);

      const acctPastDue = await globalDb().owner_accounts.findUnique({ where: { user_id: ownerId } });
      expect(acctPastDue?.status).toBe('active');
      expect(acctPastDue?.plan).toBe('monthly');
      expect(acctPastDue?.period_end?.getTime()).toBeGreaterThan(Date.now() + 25 * 24 * 60 * 60 * 1000);

      // 6b. cancelled with future period
      const futureCancelledEnd = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      await globalDb().owner_accounts.update({
        where: { user_id: ownerId },
        data: {
          status: 'cancelled',
          plan: 'monthly',
          period_start: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000),
          period_end: futureCancelledEnd,
          cancel_at_period_end: true,
        },
      });

      const txRefCancelled = await setupSubscribeIntent({
        userId: ownerId,
        teamId,
        plan: 'yearly',
        amountMinor: 7800000,
      });

      const resCancelled = await processWebhookJob(webhookJob(txRefCancelled));
      expect(resCancelled.processed).toBe(true);

      const acctCancelled = await globalDb().owner_accounts.findUnique({ where: { user_id: ownerId } });
      expect(acctCancelled?.status).toBe('active');
      expect(acctCancelled?.plan).toBe('yearly');
      expect(acctCancelled?.cancel_at_period_end).toBe(false);
      expect(acctCancelled?.period_end?.getTime()).toBeGreaterThan(Date.now() + 350 * 24 * 60 * 60 * 1000);
    });

    // 7. concurrency: two intents for the same account processed together end in a consistent state.
    it('7. concurrency: concurrent monthly and yearly intents settle into yearly plan', async () => {
      const userCId = await createVerifiedUser(uniqueEmail('h20-concurrent'), 'UserCPass123#');
      createdUserIds.push(userCId);
      const authC = { authorization: `Bearer ${await signAccessToken(userCId)}` };
      const teamCId = await createTeamFor(authC, 'Team Concurrency');
      createdTeamIds.push(teamCId);

      const txC_m = await setupSubscribeIntent({ userId: userCId, teamId: teamCId, plan: 'monthly', amountMinor: 650000 });
      const txC_y = await setupSubscribeIntent({ userId: userCId, teamId: teamCId, plan: 'yearly', amountMinor: 7800000 });

      // Run both webhook jobs concurrently
      const [resM, resY] = await Promise.all([
        processWebhookJob(webhookJob(txC_m)),
        processWebhookJob(webhookJob(txC_y)),
      ]);

      expect(resM.processed).toBe(true);
      expect(resY.processed).toBe(true);

      // Verify intents both succeeded
      const intentM = await globalDb().payment_intents.findUnique({ where: { tx_ref: txC_m } });
      const intentY = await globalDb().payment_intents.findUnique({ where: { tx_ref: txC_y } });
      expect(intentM?.status).toBe('succeeded');
      expect(intentY?.status).toBe('succeeded');

      // Verify both ledger entries were recorded
      const ledgers = await forTeam(teamCId).ledger_entries.findMany({
        where: { provider_ref: { in: [txC_m, txC_y] } },
      });
      expect(ledgers.length).toBe(2);

      // Verify final account state is yearly and active (row lock prevented monthly from overwriting yearly)
      const acct = await globalDb().owner_accounts.findUnique({ where: { user_id: userCId } });
      expect(acct?.status).toBe('active');
      expect(acct?.plan).toBe('yearly');
      expect(acct?.period_end?.getTime()).toBeGreaterThan(Date.now() + 350 * 24 * 60 * 60 * 1000);
    });
  });
});

