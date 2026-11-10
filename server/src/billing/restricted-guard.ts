// Restricted-state guard (Task 7, PRD 8.6).
// One guard function applied to write endpoints: shift create/edit/delete,
// swap request/decide, invite create, member role change, team settings update,
// and member removal. When a subscription is 'restricted' (legacy per-team),
// an account is inactive (cancelled, cancel_at_period_end passed, or trial
// ended unpaid), or a team's coverage is 'pending_payment' (account-level),
// members can still VIEW shifts but creating/editing shifts, sending invites,
// approving swaps, changing roles, updating settings, and removing members are
// blocked. Payment restores 'active' and clears the grace date.
// Viewing shifts is always allowed (no guard needed on read routes).
// Always allowed (never gated): leave team, transfer team, delete/restore team,
// sign-in/sign-out, device registration, personal settings, billing/account/move routes.

import { forTeam } from '../db/clients.ts';
import { HttpError } from '../middleware/error.ts';
import { entitlementsFor } from './entitlements.ts';
import { accountWriteState, loadOwnerAccount, loadTeamRegistry } from './entitlements.ts';

/**
 * Check whether the team's billing is restricted. Throws 403 if so.
 * Called by write routes for shifts, swaps, invites, member role changes,
 * team settings updates, and member removal.
 * Viewing shifts is always allowed (no guard needed on read routes).
 */
export async function requireBillingNotRestricted(teamId: string): Promise<void> {
  const client = forTeam(teamId);
  const sub = await client.subscriptions.findUnique({ where: { team_id: teamId } });
  // No subscription row = no legacy per-team restriction (Starter free tier);
  // account-level checks below still apply.
  if (sub?.status === 'restricted') {
    throw new HttpError(403, 'billing.restricted', 'Billing is restricted. Pay the overdue amount to restore full access.');
  }

  // Account-level restriction: check the owner account status using the shared helper.
  const registry = await loadTeamRegistry(teamId);
  const ownerUserId = registry?.ownerUserId ?? null;
  if (ownerUserId) {
    const account = await loadOwnerAccount(ownerUserId);
    if (account) {
      const state = accountWriteState({
        status: account.status,
        cancel_at_period_end: account.cancelAtPeriodEnd,
        period_end: account.periodEnd,
        trialEndsAt: account.trialEndsAt,
      });
      if (state.blocked) {
        throw new HttpError(403, 'billing.account_inactive', 'This team is read-only because its plan ended.');
      }
    }
  }

  // Account-level restriction: a pending_payment team is read-only for everyone
  // until its payer pays. entitlementsFor reads the cached coverage_status.
  const ent = await entitlementsFor(teamId);
  if (ent.coverageStatus === 'pending_payment') {
    throw new HttpError(403, 'billing.team_restricted', 'This team is read-only until its payer pays.');
  }
}
