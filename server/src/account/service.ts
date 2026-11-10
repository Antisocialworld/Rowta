// Account deletion service (Task D2; PRD 8.10; rules S1, S5, S6, S7, D2).
import { globalDb, writeDb } from '../db/clients.ts';
import { shardFor, type Shard } from '../db/shard.ts';
import { verifySecret } from '../security/argon2.ts';
import { loadOwnerAccount } from '../billing/entitlements.ts';
import { logoutAll } from '../auth/service.ts';
import { HttpError } from '../middleware/error.ts';
import {
  AUTH_MESSAGES,
  type DeleteAccountInput,
  type DeletePreviewResponse,
} from '@rowta/shared';

/**
 * Preview what happens upon account deletion (GET /account/delete-preview).
 * Reports active teams where user is Admin, sole-member teams, teams paid for,
 * and active subscription presence.
 */
export async function getDeletePreview(userId: string): Promise<DeletePreviewResponse> {
  const db0 = globalDb();
  const indexRows = await db0.user_team_index.findMany({ where: { user_id: userId } });

  // Group team IDs by shard
  const shardTeamIds = new Map<Shard, string[]>();
  for (const row of indexRows) {
    const shard = shardFor(row.team_id);
    const list = shardTeamIds.get(shard) ?? [];
    list.push(row.team_id);
    shardTeamIds.set(shard, list);
  }

  const adminTeamsWithOthers: Array<{ id: string; name: string; otherMembers: number }> = [];
  let soleMemberTeams = 0;

  for (const [shard, teamIds] of shardTeamIds.entries()) {
    const client = writeDb(shard);
    const ownerMemberships = await client.memberships.findMany({
      where: {
        team_id: { in: teamIds },
        user_id: userId,
        role: 'owner',
        removed_at: null,
      },
    });

    if (ownerMemberships.length === 0) continue;
    const ownerTeamIds = ownerMemberships.map((m) => m.team_id);

    const activeTeams = await client.teams.findMany({
      where: {
        id: { in: ownerTeamIds },
        deleted_at: null,
      },
    });

    for (const team of activeTeams) {
      const otherMembers = await client.memberships.count({
        where: {
          team_id: team.id,
          user_id: { not: userId },
          removed_at: null,
        },
      });

      if (otherMembers > 0) {
        adminTeamsWithOthers.push({
          id: team.id,
          name: team.name,
          otherMembers,
        });
      } else {
        soleMemberTeams++;
      }
    }
  }

  const paysForTeams = await db0.owner_team_registry.count({
    where: { owner_user_id: userId },
  });

  const account = await loadOwnerAccount(userId);
  const hasActiveSubscription = Boolean(
    account &&
    (account.status === 'active' || account.status === 'trialing') &&
    !account.cancel_at_period_end,
  );

  return {
    adminTeamsWithOthers,
    soleMemberTeams,
    paysForTeams,
    hasActiveSubscription,
  };
}

/**
 * Request account deletion (POST /account/delete).
 * Verifies password with Argon2id verifySecret.
 * Enforces block rule: Admin of active teams with other members cannot delete account.
 * Cancels owner subscription immediately (clearing provider auth ref).
 * Marks users.status='pending_deletion', deletion_requested_at=now().
 * Revokes all sessions and deletes push devices.
 */
export async function deleteAccount(
  userId: string,
  input: DeleteAccountInput,
): Promise<{ deleted: boolean }> {
  const db0 = globalDb();
  const user = await db0.users.findUnique({ where: { id: userId } });
  if (!user || user.status === 'pending_deletion' || user.status === 'deleted') {
    throw new HttpError(401, 'auth.not_authenticated', 'Not authenticated.');
  }

  // 1. Verify password with Argon2id verifySecret
  const passwordOk = await verifySecret(user.password_hash, input.password);
  if (!passwordOk) {
    throw new HttpError(401, 'auth.failed', AUTH_MESSAGES['auth.signIn.failed']);
  }

  // 2. Block rule: Admin of active team with at least one other active member
  const preview = await getDeletePreview(userId);
  if (preview.adminTeamsWithOthers.length > 0) {
    throw new HttpError(409, 'auth.deleteOwner.blocked', AUTH_MESSAGES['auth.deleteOwner.blocked']);
  }

  // 3. Cancel owner subscription immediately (no refund, clear saved payment authorization)
  await db0.owner_accounts.updateMany({
    where: { user_id: userId },
    data: {
      status: 'cancelled',
      cancel_at_period_end: true,
      provider_authorization_ref: null,
      updated_at: new Date(),
    },
  });

  // 4. Set users.status='pending_deletion', deletion_requested_at=now()
  await db0.users.update({
    where: { id: userId },
    data: {
      status: 'pending_deletion',
      deletion_requested_at: new Date(),
    },
  });

  // 5. Revoke ALL sessions (reuse logout-all service)
  await logoutAll(userId);

  // 6. Delete user's push device rows
  await db0.devices.deleteMany({ where: { user_id: userId } });

  return { deleted: true };
}

