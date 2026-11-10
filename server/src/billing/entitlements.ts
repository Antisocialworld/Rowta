// Account-level entitlements and capacity services (C3).
// NOT wired into live paths yet — pure functions called by tests and by C4-C7.
// Every limit and gate reads entitlementsFor(teamId). Coverage is cached on the team row
// and refreshed by applyCoverage(ownerUserId) on billing events (idempotent).
// Money is integer kobo; BigInt in DB; no floats. NAIRA ONLY.
import { forTeam, globalDb } from '../db/clients.ts';
import { HttpError } from '../middleware/error.ts';

export type PlanInterval = 'monthly' | 'yearly';

export interface PlanEntitlements {
  readonly interval: PlanInterval;
  readonly basePriceMinor: number;
  readonly freeTeams: number;
  readonly extraTeamPriceMinor: number;
  readonly peoplePerTeam: number;
  readonly extraPersonPriceMinor: number;
  readonly maxTeams: number;
  readonly maxPeoplePerTeam: number;
  readonly trialDays: number;
  readonly trialTeams: number;
  readonly trialPeople: number;
  readonly minAddonChargeMinor: number;
}

export interface EntitlementResult {
  readonly teamId: string;
  readonly ownerUserId: string;
  readonly coverageStatus: string; // 'covered' | 'read_only' | 'past_due' | 'cancelled' | 'pending_payment'
  readonly isExtra: boolean;
  readonly extraPeople: number;
  readonly planEntitlements: PlanEntitlements | null; // null when no active plan/trial
  readonly teamsUsed: number;
  readonly freeTeamsRemaining: number;
  readonly canCreateTeam: boolean;
  readonly seatsUsed: number; // active non-owner members + pending invites
  readonly seatsIncluded: number;
  readonly seatsRemaining: number;
  readonly canAddPerson: boolean;
  readonly accountStatus: string; // 'trialing' | 'active' | 'past_due' | 'read_only' | 'cancelled'
  readonly readOnlyReason: 'payer_unpaid' | 'plan_ended' | undefined;
}

/** Load the plan entitlements row for an interval. Null when no row (not configured). */
export async function loadPlanEntitlements(interval: PlanInterval): Promise<PlanEntitlements | null> {
  const db0 = globalDb();
  const row = await db0.plan_entitlements.findUnique({ where: { interval } });
  if (!row) return null;
  return {
    interval: row.interval as PlanInterval,
    basePriceMinor: Number(row.base_price_minor),
    freeTeams: row.free_teams,
    extraTeamPriceMinor: Number(row.extra_team_price_minor),
    peoplePerTeam: row.people_per_team,
    extraPersonPriceMinor: Number(row.extra_person_price_minor),
    maxTeams: row.max_teams,
    maxPeoplePerTeam: row.max_people_per_team,
    trialDays: row.trial_days,
    trialTeams: row.trial_teams,
    trialPeople: row.trial_people,
    minAddonChargeMinor: Number(row.min_addon_charge_minor),
  };
}

/** Count seats used on a team: active non-owner members + pending (non-revoked, non-expired) invites. */
export async function seatsUsed(teamId: string): Promise<number> {
  const client = forTeam(teamId);
  const [members, invites] = await Promise.all([
    client.memberships.count({
      where: { team_id: teamId, role: { not: 'owner' }, removed_at: null },
    }),
    client.invites.count({
      where: { team_id: teamId, accepted_at: null, revoked_at: null, expires_at: { gt: new Date() } },
    }),
  ]);
  return members + invites;
}

/** accountWriteState: determine whether an account's teams should be write-restricted.
 * Returns { blocked: true, reason: 'plan_ended' } when any of:
 *   - account.status === 'cancelled'
 *   - account.status === 'read_only' (trial ended unpaid)
   - cancel_at_period_end === true and period_end <= now
   - account.status === 'trialing' and trialEndsAt <= now (no paid plan)
 * Otherwise returns { blocked: false }.
 * This is the single source of truth for "account-level billing write restriction",
 * shared between requireBillingNotRestricted and entitlementsFor readOnlyReason.
 */
export function accountWriteState(account: {
  status: string;
  cancel_at_period_end: boolean | null;
  period_end: Date | null;
  trialEndsAt: Date | null;
}): { blocked: boolean; reason: 'plan_ended' | undefined } {
  const now = new Date();
  // Account cancelled → read-only immediately.
  if (account.status === 'cancelled') {
    return { blocked: true, reason: 'plan_ended' };
  }
  // Trial ended unpaid (job set status read_only) → read-only.
  if (account.status === 'read_only') {
    return { blocked: true, reason: 'plan_ended' };
  }
  // Cancel at period end and period has ended → read-only.
  if (account.cancel_at_period_end && account.period_end && new Date(account.period_end) <= now) {
    return { blocked: true, reason: 'plan_ended' };
  }
  // Trial ended unpaid → read-only.
  if (account.status === 'trialing' && account.trialEndsAt && new Date(account.trialEndsAt) <= now) {
    return { blocked: true, reason: 'plan_ended' };
  }
  return { blocked: false, reason: undefined };
}

/** Load the owner account row for a user. Null when no account exists. */
export async function loadOwnerAccount(userId: string): Promise<({
  userId: string;
  plan: PlanInterval;
  status: string;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  trialUsed: boolean;
  periodStart: Date | null;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  currency: string;
}) | null> {
  const db0 = globalDb();
  const row = await db0.owner_accounts.findUnique({ where: { user_id: userId } });
  if (!row) return null;
  return {
    userId: row.user_id,
    plan: row.plan as PlanInterval,
    status: row.status,
    trialStartedAt: row.trial_started_at ?? null,
    trialEndsAt: row.trial_ends_at ?? null,
    trialUsed: row.trial_used,
    periodStart: row.period_start ?? null,
    periodEnd: row.period_end ?? null,
    cancelAtPeriodEnd: row.cancel_at_period_end ?? false,
    currency: row.currency,
  };
}

/** Load the owner_team_registry row for a team. Null when not registered. */
export async function loadTeamRegistry(teamId: string): Promise<{
  teamId: string;
  ownerUserId: string;
  status: string;
  isExtra: boolean;
  createdAt: Date;
} | null> {
  const db0 = globalDb();
  const row = await db0.owner_team_registry.findUnique({ where: { team_id: teamId } });
  if (!row) return null;
  return {
    teamId: row.team_id,
    ownerUserId: row.owner_user_id,
    status: row.status,
    isExtra: row.is_extra,
    createdAt: row.created_at,
  };
}

/**
 * entitlementsFor(teamId): team -> its owner account -> plan_entitlements.
 * EVERY limit and gate reads this result. Coverage is cached on the team row and
 * refreshed by applyCoverage; this function reads the cache plus live seat counts.
 */
export async function entitlementsFor(teamId: string): Promise<EntitlementResult> {
  const client = forTeam(teamId);
  const db0 = globalDb();

  // Team row (shard): coverage cache + owner.
  const team = await client.teams.findUnique({ where: { id: teamId } });
  if (!team) throw new HttpError(404, 'team.notFound', 'Team not found.');

  // A pending_payment team is restricted: no new content until the charge is confirmed.
  const restricted = (team.coverage_status ?? 'covered') === 'pending_payment';

  // Registry (db0): owner + is_extra.
  const registry = await loadTeamRegistry(teamId);
  const ownerUserId = registry?.ownerUserId ?? team.created_by ?? '';
  const isExtra = registry?.isExtra ?? team.is_extra;

  // Account (db0): status + plan.
  const account = ownerUserId ? await loadOwnerAccount(ownerUserId) : null;
  const accountStatus = account?.status ?? 'cancelled';

  // G4b-1: Read-only reason from account state (single source of truth).
  let readOnlyReason: 'payer_unpaid' | 'plan_ended' | undefined;
  if (account) {
    const accountState = accountWriteState({
      status: account.status,
      cancel_at_period_end: account.cancelAtPeriodEnd,
      period_end: account.periodEnd,
      trialEndsAt: account.trialEndsAt,
    });
    if (accountState.blocked) {
      readOnlyReason = accountState.reason;
    }
  }

  // Plan entitlements (db0): only when account is active or trialing.
  let entitlements: PlanEntitlements | null = null;
  if (account && (account.status === 'active' || account.status === 'trialing')) {
    entitlements = await loadPlanEntitlements(account.plan);
  }

  // Trial limits override plan entitlements during the trial.
  let effective: PlanEntitlements | null = null;
  if (entitlements) {
    if (accountStatus === 'trialing' && account?.trialEndsAt && account.trialEndsAt > new Date()) {
      effective = {
        ...entitlements,
        freeTeams: entitlements.trialTeams,
        peoplePerTeam: entitlements.trialPeople,
        extraTeamPriceMinor: 0, // no extras during trial
        extraPersonPriceMinor: 0,
        minAddonChargeMinor: 0,
      };
    } else {
      effective = entitlements;
    }
  }

  // Seats used: live count (members + pending invites).
  const used = await seatsUsed(teamId);
  const included = effective ? effective.peoplePerTeam : 0;
  const maxPeople = effective ? effective.maxPeoplePerTeam : 50;
  // During a trial no extra people are allowed: ignore team.extra_people.
  const extraPeople = accountStatus === 'trialing' ? 0 : (team.extra_people ?? 0);
  const totalPeopleLimit = included + extraPeople;
  const canAdd = restricted ? false : used < totalPeopleLimit && used < maxPeople;

  // Teams used: count this owner's teams from registry.
  let teamsUsed = 0;
  let freeTeamsRemaining = 0;
  let canCreate = false;
  if (ownerUserId && effective) {
    teamsUsed = await db0.owner_team_registry.count({
      where: { owner_user_id: ownerUserId },
    });
    const freeAllowance = accountStatus === 'trialing' ? effective.trialTeams : effective.freeTeams;
    freeTeamsRemaining = Math.max(0, freeAllowance - teamsUsed);
    canCreate =
      (accountStatus === 'active' || accountStatus === 'trialing') &&
      !restricted &&
      teamsUsed < effective.maxTeams &&
      freeTeamsRemaining >= 0;
  }

  // Coverage status: from cache, adjusted for account state.
  let coverageStatus = team.coverage_status ?? 'covered';
  if (accountStatus === 'past_due' || accountStatus === 'read_only') {
    coverageStatus = accountStatus;
  } else if (accountStatus === 'cancelled') {
    coverageStatus = 'cancelled';
  } else if (!effective && accountStatus !== 'trialing') {
    coverageStatus = 'read_only';
  }

  return {
    teamId,
    ownerUserId,
    coverageStatus,
    isExtra,
    extraPeople: team.extra_people ?? 0,
    planEntitlements: effective,
    teamsUsed,
    freeTeamsRemaining,
    canCreateTeam: canCreate,
    seatsUsed: used,
    seatsIncluded: included,
    seatsRemaining: Math.max(0, totalPeopleLimit - used),
    canAddPerson: canAdd,
    accountStatus,
    readOnlyReason,
  };
}

/**
 * applyCoverage(ownerUserId): recalculate coverage for every team owned by this user.
 * Idempotent: safe to call on every billing event. Updates coverage_status, is_extra,
 * extra_people, coverage_updated_at on each team row (on its shard).
 */
export async function applyCoverage(ownerUserId: string): Promise<void> {
  const db0 = globalDb();
  const account = await loadOwnerAccount(ownerUserId);
  if (!account) return;

  const entitlements = account.status === 'active' || account.status === 'trialing'
    ? await loadPlanEntitlements(account.plan)
    : null;

  const registries = await db0.owner_team_registry.findMany({
    where: { owner_user_id: ownerUserId },
    orderBy: { created_at: 'asc' },
  });

  const freeAllowance = account.status === 'trialing'
    ? (entitlements?.trialTeams ?? 1)
    : (entitlements?.freeTeams ?? 0);

  for (let i = 0; i < registries.length; i++) {
    const reg = registries[i];
    if (!reg) continue;
    const isExtra = i >= freeAllowance;
    const shardClient = forTeam(reg.team_id);

    // Determine coverage status.
    // A pending_payment team (extra team awaiting its add_team charge) stays restricted
    // even while the account is active; only the add_team webhook flips it to active.
    let coverage: string;
    if (reg.status === 'pending_payment') {
      coverage = 'pending_payment';
    } else if (account.status === 'past_due') {
      coverage = 'past_due';
    } else if (account.status === 'read_only') {
      coverage = 'read_only';
    } else if (account.status === 'cancelled') {
      coverage = 'cancelled';
    } else if (!entitlements && account.status !== 'trialing') {
      coverage = 'read_only';
    } else {
      coverage = 'covered';
    }

    await shardClient.teams.update({
      where: { id: reg.team_id },
      data: {
        coverage_status: coverage,
        is_extra: isExtra,
        coverage_updated_at: new Date(),
      },
    });

    // Update registry is_extra if changed.
    if (reg.is_extra !== isExtra) {
      await db0.owner_team_registry.update({
        where: { team_id: reg.team_id },
        data: { is_extra: isExtra },
      });
    }
  }
}

/** canCreateTeam(ownerUserId): whether the owner may create a new team right now. */
export async function canCreateTeam(ownerUserId: string): Promise<boolean> {
  // Use direct queries instead (entitlementsFor needs a teamId).
  const account = await loadOwnerAccount(ownerUserId);
  if (!account || (account.status !== 'active' && account.status !== 'trialing')) return false;

  const entitlements = await loadPlanEntitlements(account.plan);
  if (!entitlements) return false;

  const teamsUsed = await globalDb().owner_team_registry.count({
    where: { owner_user_id: ownerUserId },
  });

  const freeAllowance = account.status === 'trialing' ? entitlements.trialTeams : entitlements.freeTeams;
  return teamsUsed < entitlements.maxTeams && teamsUsed < freeAllowance;
}

/**
 * reserveTeamSlot(ownerUserId, teamId): reserve a capacity slot inside a db0 transaction
 * that holds a row lock on the owner's owner_accounts row (SELECT ... FOR UPDATE).
 * The team is then created on its shard by the caller; if the shard write fails, the
 * caller must call releaseTeamSlot(teamId).
 * Returns the reserved registry row or throws if capacity is unavailable.
 */
export async function reserveTeamSlot(ownerUserId: string, teamId: string): Promise<void> {
  const db0 = globalDb();

  const account = await db0.owner_accounts.findUnique({
    where: { user_id: ownerUserId },
  });
  if (!account) {
    throw new HttpError(422, 'billing.no_account', 'No owner account. Subscribe first.');
  }
  if (account.status !== 'active' && account.status !== 'trialing') {
    throw new HttpError(422, 'billing.account_not_active', 'Owner account is not active.');
  }

  const plan = account.plan;
  if (plan !== 'monthly' && plan !== 'yearly') {
    throw new HttpError(422, 'billing.invalid_plan', `Invalid plan: ${plan}`);
  }
  const entitlements = await loadPlanEntitlements(plan);
  if (!entitlements) {
    throw new HttpError(422, 'billing.no_entitlements', 'Plan entitlements not configured.');
  }

  await db0.$transaction(async (tx) => {
    // Row lock on the owner's account (prevents concurrent slot reservations).
    const locked = await tx.$queryRaw<{ user_id: string }[]>`
      SELECT user_id FROM owner_accounts WHERE user_id = ${ownerUserId}::uuid FOR UPDATE
    `;
    if (!locked || locked.length === 0) {
      throw new HttpError(422, 'billing.no_account', 'No owner account.');
    }

    // Count existing teams for this owner.
    const teamsUsed = await tx.owner_team_registry.count({
      where: { owner_user_id: ownerUserId },
    });

    const freeAllowance = account.status === 'trialing'
      ? entitlements.trialTeams
      : entitlements.freeTeams;

    if (teamsUsed >= entitlements.maxTeams) {
      throw new HttpError(422, 'billing.team_cap_reached', `Team limit reached (${entitlements.maxTeams} per account).`);
    }
    if (teamsUsed >= freeAllowance) {
      // Beyond free allowance: create as pending_payment until the webhook confirms the charge.
      // This is allowed; the team is created but billing is pending.
    }

    await tx.owner_team_registry.create({
      data: {
        team_id: teamId,
        owner_user_id: ownerUserId,
        status: teamsUsed >= freeAllowance ? 'pending_payment' : 'active',
        is_extra: teamsUsed >= freeAllowance,
        created_at: new Date(),
      },
    });
  });
}

/** releaseTeamSlot(teamId): release a reserved slot (caller-side rollback when shard write fails). */
export async function releaseTeamSlot(teamId: string): Promise<void> {
  await globalDb().owner_team_registry.delete({ where: { team_id: teamId } }).catch(() => undefined);
}

/** canAddPerson(teamId): whether another person (member or invite) can be added to the team. */
export async function canAddPerson(teamId: string): Promise<boolean> {
  const result = await entitlementsFor(teamId);
  return result.canAddPerson;
}

/**
 * checkTeamCapacity(teamId): throws 422 billing.seat_limit_reached (NO prices) when the team
 * cannot add another person. Limit = peoplePerTeam included + extra_people, hard cap 50.
 * During a trial, extra_people is ignored (limit = trialPeople).
 */
export async function checkTeamCapacity(teamId: string): Promise<void> {
  const result = await entitlementsFor(teamId);
  if (!result.canAddPerson) {
    throw new HttpError(422, 'billing.seat_limit_reached', 'This team is at capacity.');
  }
}

