// Teams service: teams, memberships, invites, and settings (rules S6, S7, S8, D2, C3, C4, A6, A7).
import { randomUUID } from 'node:crypto';
import {
  INVITE_TTL_SECONDS,
  STARTER_SEAT_CAP,
  normaliseEmail,
  authMessage,
  type CreateTeamInput,
  type InviteMemberInput,
  type ChangeMemberRoleInput,
  type UpdateTeamSettingsInput,
  type DeleteTeamInput,
  type TransferTeamInput,
  type DeleteTeamResponse,
  type TransferTeamResponse,
  type DeletedTeamsResponse,
  type RestoreTeamResponse,
} from '@rowta/shared';
import {
  forTeam,
  globalDb,
  shardTransaction,
  teamTransaction,
  writeDb,
  type AnyPrismaClient,
  type ShardTx,
} from '../db/clients.ts';
import { shardFor, type Shard } from '../db/shard.ts';
import { getDummyHash, hashSecret, verifySecret } from '../security/argon2.ts';
import { fingerprint } from '../security/fingerprint.ts';
import { can, type Role } from '../security/policy.ts';
import { createTokenParts, formatToken } from '../security/tokens.ts';
import { enqueueEmail } from '../jobs/email/enqueue.ts';
import { HttpError } from '../middleware/error.ts';

/** Assert teamId is present and non-empty; Rule S7: every query is scoped by teamId. */
function assertTeamId(teamId: string): void {
  if (typeof teamId !== 'string' || teamId.trim().length === 0) {
    throw new Error('teamId is required for team-scoped data access (rule S7)');
  }
}

/** Require caller's active membership and non-deleted team row (rules S7, Phase C). */
async function requireActiveMemberAndTeam(client: AnyPrismaClient, teamId: string, userId: string) {
  assertTeamId(teamId);
  const membership = await client.memberships.findUnique({
    where: { team_id_user_id: { team_id: teamId, user_id: userId } },
  });
  if (!membership || membership.removed_at !== null) {
    throw new HttpError(404, 'team.notFound', 'Team not found.');
  }
  const team = await client.teams.findUnique({ where: { id: teamId } });
  if (!team || team.deleted_at !== null) {
    throw new HttpError(404, 'team.notFound', 'Team not found.');
  }
  return { membership, team };
}

/** Timing decoy against dummy hash (Rule A7: equal cost when selector is not found). */
async function dummyVerify(): Promise<void> {
  const dummy = await getDummyHash();
  await verifySecret(dummy, 'invalid-verifier-timing-decoy');
}

/** Calculate seat cap for team (Owner decision 1; PRD section 5). */
export async function getSeatCap(teamId: string, client: AnyPrismaClient | ShardTx): Promise<number> {
  assertTeamId(teamId);
  const sub = await client.subscriptions.findUnique({
    where: { team_id: teamId },
  });
  if (!sub) {
    // New team has NO subscription row: returns 5 (Starter), owner not counted.
    return STARTER_SEAT_CAP;
  }
  if (sub.plan === 'starter') return STARTER_SEAT_CAP;
  if (sub.plan === 'team' || sub.plan === 'business') {
    return sub.seats;
  }
  throw new Error(`PRD gives no seat cap for subscription plan "${sub.plan}"`);
}

/**
 * Create a new team with idempotency (C4, PRD 9.9).
 * Idempotency key fingerprint allowlists ONLY the `name` field.
 */
export async function createTeam(
  userId: string,
  input: CreateTeamInput,
  idempotencyKey?: string,
): Promise<{ id: string; name: string; role: Role; managersCanRevokeInvites: boolean }> {
  if (!idempotencyKey || idempotencyKey.trim().length === 0) {
    throw new HttpError(400, 'idempotency.missing', 'Idempotency-Key header is required for team creation.');
  }

  const db0 = globalDb();
  const scope = `create_team:${userId}`;
  const allowlistPayload = JSON.stringify({ name: input.name });
  const reqFingerprint = fingerprint(allowlistPayload);

  // Check existing idempotency key
  const existingKey = await db0.idempotency_keys.findUnique({
    where: { scope_key: { scope, key: idempotencyKey } },
  });

  if (existingKey) {
    if (existingKey.request_fingerprint !== reqFingerprint) {
      throw new HttpError(
        422,
        'idempotency.fingerprint_mismatch',
        'Idempotency key was previously used with different request parameters.',
      );
    }
    if (existingKey.state === 'in_flight') {
      throw new HttpError(409, 'idempotency.in_flight', 'A request with this idempotency key is already in progress.');
    }
    if (existingKey.state === 'done' && existingKey.response) {
      return existingKey.response as { id: string; name: string; role: Role; managersCanRevokeInvites: boolean };
    }
  }

  // Insert in_flight record
  await db0.idempotency_keys.create({
    data: {
      scope,
      key: idempotencyKey,
      request_fingerprint: reqFingerprint,
      state: 'in_flight',
    },
  });

  const teamId = randomUUID();
  const shard = shardFor(teamId);

  try {
    // 1. One shard transaction: create team + owner membership
    await shardTransaction(shard, async (tx) => {
      await tx.teams.create({
        data: {
          id: teamId,
          name: input.name,
          managers_can_revoke_invites: true,
          created_by: userId,
        },
      });
      await tx.memberships.create({
        data: {
          team_id: teamId,
          user_id: userId,
          role: 'owner',
        },
      });
    });

    // 2. Global directory and user_team_index writes in DB0
    await db0.team_directory.create({
      data: {
        team_id: teamId,
        shard,
      },
    });

    await db0.user_team_index.create({
      data: {
        user_id: userId,
        team_id: teamId,
      },
    });

    const result = {
      id: teamId,
      name: input.name,
      role: 'owner' as Role,
      managersCanRevokeInvites: true,
    };

    // 3. Mark idempotency key done
    await db0.idempotency_keys.update({
      where: { scope_key: { scope, key: idempotencyKey } },
      data: {
        state: 'done',
        status_code: 201,
        response: result,
      },
    });

    return result;
  } catch (err) {
    // Delete in_flight record so retry can succeed
    await db0.idempotency_keys
      .delete({
        where: { scope_key: { scope, key: idempotencyKey } },
      })
      .catch(() => undefined);
    throw err;
  }
}

/** List teams for the authenticated user (S8: role read from memberships on each request). */
export async function listTeams(
  userId: string,
): Promise<{ id: string; name: string; role: Role; managersCanRevokeInvites: boolean; createdBy?: { userId: string; displayName: string } | null }[]> {
  const db0 = globalDb();
  const indexRows = await db0.user_team_index.findMany({
    where: { user_id: userId },
  });

  const teams: { id: string; name: string; role: Role; managersCanRevokeInvites: boolean; createdBy?: { userId: string; displayName: string } | null }[] = [];

  for (const row of indexRows) {
    const shardClient = forTeam(row.team_id);
    const membership = await shardClient.memberships.findUnique({
      where: { team_id_user_id: { team_id: row.team_id, user_id: userId } },
    });
    if (!membership || membership.removed_at !== null) continue;

    const team = await shardClient.teams.findUnique({
      where: { id: row.team_id },
    });
    if (!team || team.deleted_at !== null) continue;

    let createdBy: { userId: string; displayName: string } | null = null;
    if (team.created_by) {
      const creatorUser = await db0.users.findUnique({
        where: { id: team.created_by },
        select: { id: true, display_name: true },
      });
      if (creatorUser) {
        createdBy = { userId: creatorUser.id, displayName: creatorUser.display_name };
      }
    }

    teams.push({
      id: team.id,
      name: team.name,
      role: membership.role as Role,
      managersCanRevokeInvites: team.managers_can_revoke_invites,
      createdBy,
    });
  }

  return teams;
}

/** Get team details if caller is an active member. S7: Cross-team returns 404. */
export async function getTeam(
  userId: string,
  teamId: string,
): Promise<{ id: string; name: string; role: Role; managersCanRevokeInvites: boolean; createdBy?: { userId: string; displayName: string } | null }> {
  assertTeamId(teamId);
  const shardClient = forTeam(teamId);

  const membership = await shardClient.memberships.findUnique({
    where: { team_id_user_id: { team_id: teamId, user_id: userId } },
  });
  if (!membership || membership.removed_at !== null) {
    throw new HttpError(404, 'team.notFound', 'Team not found.');
  }

  const team = await shardClient.teams.findUnique({
    where: { id: teamId },
  });
  if (!team || team.deleted_at !== null) {
    throw new HttpError(404, 'team.notFound', 'Team not found.');
  }

  let createdBy: { userId: string; displayName: string } | null = null;
  if (team.created_by) {
    const creatorUser = await globalDb().users.findUnique({
      where: { id: team.created_by },
      select: { id: true, display_name: true },
    });
    if (creatorUser) {
      createdBy = { userId: creatorUser.id, displayName: creatorUser.display_name };
    }
  }

  return {
    id: team.id,
    name: team.name,
    role: membership.role as Role,
    managersCanRevokeInvites: team.managers_can_revoke_invites,
    createdBy,
  };
}

/** List active members of the team. */
export async function listMembers(
  userId: string,
  teamId: string,
): Promise<{ userId: string; role: Role; displayName: string; email: string; createdAt: Date }[]> {
  const shardClient = forTeam(teamId);
  const { membership: callerMembership } = await requireActiveMemberAndTeam(shardClient, teamId, userId);

  if (!can({ id: userId }, { ...callerMembership, role: callerMembership.role as Role }, 'view_team')) {
    throw new HttpError(403, 'team.forbidden', 'You do not have permission to perform this action.');
  }

  const members = await shardClient.memberships.findMany({
    where: { team_id: teamId, removed_at: null },
    orderBy: { created_at: 'asc' },
  });

  const db0 = globalDb();
  const users = await db0.users.findMany({
    where: { id: { in: members.map((m) => m.user_id) } },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  const isStaff = callerMembership.role === 'staff';

  return members.map((m) => {
    const u = userMap.get(m.user_id);
    const rawEmail = u?.email ?? '';
    // Staff members cannot see other members' email addresses (rules S9, PRD Section 4)
    const email = isStaff && m.user_id !== userId ? '' : rawEmail;
    return {
      userId: m.user_id,
      role: m.role as Role,
      displayName: u?.display_name ?? '',
      email,
      createdAt: m.created_at,
    };
  });
}

/** Change a member's role (Owner only; can set to manager or staff, never owner). */
export async function changeMemberRole(
  userId: string,
  teamId: string,
  targetUserId: string,
  input: ChangeMemberRoleInput,
): Promise<{ userId: string; role: Role }> {
  const shardClient = forTeam(teamId);
  const { membership: callerMembership } = await requireActiveMemberAndTeam(shardClient, teamId, userId);

  const targetMembership = await shardClient.memberships.findUnique({
    where: { team_id_user_id: { team_id: teamId, user_id: targetUserId } },
  });
  if (!targetMembership || targetMembership.removed_at !== null) {
    throw new HttpError(404, 'team.notFound', 'Member not found.');
  }

  const allowed = can(
    { id: userId },
    { ...callerMembership, role: callerMembership.role as Role },
    'change_role',
    {
      targetRole: input.role,
      targetMemberRole: targetMembership.role as Role,
      targetUserId,
    },
  );
  if (!allowed) {
    throw new HttpError(403, 'team.forbidden', 'You do not have permission to perform this action.');
  }

  await shardClient.memberships.update({
    where: { id: targetMembership.id },
    data: { role: input.role },
  });

  return { userId: targetUserId, role: input.role };
}

/** Remove a member from the team. Sets removed_at and deletes from user_team_index. */
export async function removeMember(
  userId: string,
  teamId: string,
  targetUserId: string,
): Promise<{ removed: boolean }> {
  const shardClient = forTeam(teamId);
  const { membership: callerMembership } = await requireActiveMemberAndTeam(shardClient, teamId, userId);

  const targetMembership = await shardClient.memberships.findUnique({
    where: { team_id_user_id: { team_id: teamId, user_id: targetUserId } },
  });
  if (!targetMembership || targetMembership.removed_at !== null) {
    throw new HttpError(404, 'team.notFound', 'Member not found.');
  }

  if (targetMembership.role === 'owner') {
    throw new HttpError(400, 'auth.deleteOwner.blocked', 'Transfer or delete your team first.');
  }

  const allowed = can(
    { id: userId },
    { ...callerMembership, role: callerMembership.role as Role },
    'remove_member',
    {
      targetMemberRole: targetMembership.role as Role,
      targetUserId,
    },
  );
  if (!allowed) {
    throw new HttpError(403, 'team.forbidden', 'You do not have permission to perform this action.');
  }

  await shardClient.memberships.update({
    where: { id: targetMembership.id },
    data: { removed_at: new Date() },
  });

  const db0 = globalDb();
  await db0.user_team_index.deleteMany({
    where: { user_id: targetUserId, team_id: teamId },
  });

  return { removed: true };
}

/** Leave a team (Managers and Staff only; Owner cannot leave). */
export async function leaveTeam(userId: string, teamId: string): Promise<{ left: boolean }> {
  const shardClient = forTeam(teamId);
  const { membership: callerMembership } = await requireActiveMemberAndTeam(shardClient, teamId, userId);

  if (callerMembership.role === 'owner') {
    throw new HttpError(400, 'auth.deleteOwner.blocked', 'Transfer or delete your team first.');
  }

  const allowed = can({ id: userId }, { ...callerMembership, role: callerMembership.role as Role }, 'leave_team');
  if (!allowed) {
    throw new HttpError(403, 'team.forbidden', 'You do not have permission to perform this action.');
  }

  await shardClient.memberships.update({
    where: { id: callerMembership.id },
    data: { removed_at: new Date() },
  });

  const db0 = globalDb();
  await db0.user_team_index.deleteMany({
    where: { user_id: userId, team_id: teamId },
  });

  return { left: true };
}

/** Create invite with seat cap enforcement and open-invite replacement. */
export async function createInvite(
  userId: string,
  teamId: string,
  input: InviteMemberInput,
): Promise<{ message: string }> {
  const shardClient = forTeam(teamId);
  const { membership: callerMembership } = await requireActiveMemberAndTeam(shardClient, teamId, userId);

  const allowed = can(
    { id: userId },
    { ...callerMembership, role: callerMembership.role as Role },
    'invite_member',
    { targetRole: input.role },
  );
  if (!allowed) {
    throw new HttpError(403, 'team.forbidden', 'You do not have permission to perform this action.');
  }

  const emailNorm = normaliseEmail(input.email);
  const parts = createTokenParts();
  const verifierHash = await hashSecret(parts.verifier);
  const expiresAt = new Date(Date.now() + INVITE_TTL_SECONDS * 1_000);

  let teamName = '';

  await teamTransaction(teamId, async (tx) => {
    // 1. Lock team row (SELECT ... FOR UPDATE)
    const lockedTeams = await tx.$queryRaw<{ id: string; name: string }[]>`
      SELECT id::text, name FROM teams WHERE id = ${teamId}::uuid FOR UPDATE
    `;
    if (!lockedTeams || lockedTeams.length === 0) {
      throw new HttpError(404, 'team.notFound', 'Team not found.');
    }
    const lockedTeam = lockedTeams[0]!;
    teamName = lockedTeam.name;

    // 2. Count active non-owner members plus open unexpired invites for OTHER emails
    const activeMembersRes = await tx.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM memberships
      WHERE team_id = ${teamId}::uuid AND role != 'owner' AND removed_at IS NULL
    `;
    const activeNonOwnerCount = activeMembersRes[0]?.count ?? 0;

    const openInvitesRes = await tx.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM invites
      WHERE team_id = ${teamId}::uuid
        AND email != ${emailNorm}
        AND accepted_at IS NULL
        AND revoked_at IS NULL
        AND expires_at > now()
    `;
    const openInvitesCount = openInvitesRes[0]?.count ?? 0;

    const cap = await getSeatCap(teamId, tx);
    if (activeNonOwnerCount + openInvitesCount >= cap) {
      throw new HttpError(422, 'team.seatLimit', 'Seat limit reached.');
    }

    // 3. A resend replaces any existing open invite (invites_one_open_idx)
    await tx.$executeRaw`
      UPDATE invites
      SET revoked_at = now()
      WHERE team_id = ${teamId}::uuid
        AND email = ${emailNorm}
        AND accepted_at IS NULL
        AND revoked_at IS NULL
    `;

    // 4. Insert new invite row (storing ONLY the Argon2id hash of the verifier)
    await tx.invites.create({
      data: {
        team_id: teamId,
        email: emailNorm,
        role: input.role,
        selector: parts.selector,
        verifier_hash: verifierHash,
        invited_by: userId,
        expires_at: expiresAt,
      },
    });
  });

  // Enqueue email job
  const inviter = await globalDb().users.findUnique({ where: { id: userId } });
  const rawToken = formatToken(parts);
  await enqueueEmail({
    kind: 'teamInvite',
    email: emailNorm,
    teamName,
    inviterName: inviter?.display_name ?? null,
    role: input.role,
    token: rawToken,
  });

  // Always uniform response (A6)
  return { message: 'Invitation sent.' };
}

/** List open pending invites for the team. */
export async function listInvites(
  userId: string,
  teamId: string,
): Promise<{ id: string; email: string; role: Role; createdAt: Date; expiresAt: Date; invitedBy?: string }[]> {
  const shardClient = forTeam(teamId);
  const { membership: callerMembership } = await requireActiveMemberAndTeam(shardClient, teamId, userId);

  if (!can({ id: userId }, { ...callerMembership, role: callerMembership.role as Role }, 'view_invites')) {
    throw new HttpError(403, 'team.forbidden', 'You do not have permission to perform this action.');
  }

  const openInvites = await shardClient.invites.findMany({
    where: {
      team_id: teamId,
      accepted_at: null,
      revoked_at: null,
      expires_at: { gt: new Date() },
    },
    orderBy: { created_at: 'desc' },
  });

  return openInvites.map((inv) => ({
    id: inv.id,
    email: inv.email,
    role: inv.role as Role,
    createdAt: inv.created_at,
    expiresAt: inv.expires_at,
    invitedBy: inv.invited_by,
  }));
}

/** Revoke an open invite (Owner, or Manager for staff invites if managers_can_revoke_invites is true). */
export async function revokeInvite(userId: string, teamId: string, inviteId: string): Promise<{ revoked: boolean }> {
  const shardClient = forTeam(teamId);
  const { membership: callerMembership, team } = await requireActiveMemberAndTeam(shardClient, teamId, userId);

  const invite = await shardClient.invites.findUnique({
    where: { id: inviteId },
  });
  if (!invite || invite.team_id !== teamId) {
    throw new HttpError(404, 'team.notFound', 'Invite not found.');
  }

  const allowed = can(
    { id: userId },
    { ...callerMembership, role: callerMembership.role as Role },
    'revoke_invite',
    {
      targetRole: invite.role as Role,
      managersCanRevokeInvites: team.managers_can_revoke_invites,
      invitedBy: invite.invited_by,
    },
  );
  if (!allowed) {
    throw new HttpError(403, 'team.forbidden', 'You do not have permission to perform this action.');
  }

  await shardClient.invites.update({
    where: { id: inviteId },
    data: { revoked_at: new Date() },
  });

  return { revoked: true };
}

/**
 * Accept invite:
 * - Looks up selector across BOTH databases.
 * - Missing row, wrong verifier, wrong email, expired, revoked, and reused tokens all return identical error.
 * - Enforces seat cap on accept.
 */
export async function acceptInvite(
  userId: string,
  userEmail: string,
  rawToken: string,
): Promise<{ teamId: string; role: Role }> {
  const dotIndex = rawToken.indexOf('.');
  if (dotIndex <= 0 || dotIndex >= rawToken.length - 1) {
    await dummyVerify();
    throw new HttpError(400, 'auth.link.invalid', 'This link is invalid or has expired. Request a new one.');
  }

  const selector = rawToken.slice(0, dotIndex);
  const verifier = rawToken.slice(dotIndex + 1);

  // Look up selector across BOTH databases
  let foundInvite: {
    id: string;
    team_id: string;
    email: string;
    role: string;
    verifier_hash: string;
    accepted_at: Date | null;
    revoked_at: Date | null;
    expires_at: Date;
    shard: Shard;
  } | null = null;

  for (const s of [0, 1] as Shard[]) {
    const client = writeDb(s);
    const inv = await client.invites.findUnique({
      where: { selector },
    });
    if (inv) {
      foundInvite = { ...inv, shard: s };
      break;
    }
  }

  if (!foundInvite) {
    await dummyVerify();
    throw new HttpError(400, 'auth.link.invalid', 'This link is invalid or has expired. Request a new one.');
  }

  // Verify verifier against Argon2id hash
  const validVerifier = await verifySecret(foundInvite.verifier_hash, verifier);
  if (!validVerifier) {
    throw new HttpError(400, 'auth.link.invalid', 'This link is invalid or has expired. Request a new one.');
  }

  // Check email matches (Owner Decision 2: wrong email returns identical error)
  if (normaliseEmail(userEmail) !== normaliseEmail(foundInvite.email)) {
    throw new HttpError(400, 'auth.link.invalid', 'This link is invalid or has expired. Request a new one.');
  }

  const teamId = foundInvite.team_id;

  await teamTransaction(teamId, async (tx) => {
    // 1. Lock invite row and team row (FOR UPDATE)
    const lockedInvites = await tx.$queryRaw<{ id: string; accepted_at: Date | null; revoked_at: Date | null; expires_at: Date }[]>`
      SELECT id::text, accepted_at, revoked_at, expires_at
      FROM invites
      WHERE id = ${foundInvite.id}::uuid
      FOR UPDATE
    `;
    const lockedInvite = lockedInvites[0];
    if (!lockedInvite) {
      throw new HttpError(400, 'auth.link.invalid', 'This link is invalid or has expired. Request a new one.');
    }

    if (
      lockedInvite.accepted_at !== null ||
      lockedInvite.revoked_at !== null ||
      new Date(lockedInvite.expires_at).getTime() <= Date.now()
    ) {
      throw new HttpError(400, 'auth.link.invalid', 'This link is invalid or has expired. Request a new one.');
    }

    const lockedTeams = await tx.$queryRaw<{ id: string; deleted_at: Date | null }[]>`
      SELECT id::text, deleted_at FROM teams WHERE id = ${teamId}::uuid FOR UPDATE
    `;
    if (!lockedTeams || lockedTeams.length === 0 || lockedTeams[0]?.deleted_at !== null) {
      throw new HttpError(400, 'auth.link.invalid', 'This link is invalid or has expired. Request a new one.');
    }

    // 2. Count active non-owner members against cap
    const activeMembersRes = await tx.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM memberships
      WHERE team_id = ${teamId}::uuid AND role != 'owner' AND removed_at IS NULL
    `;
    const activeCount = activeMembersRes[0]?.count ?? 0;
    const cap = await getSeatCap(teamId, tx);

    if (activeCount >= cap) {
      throw new HttpError(422, 'team.seatLimit', 'Seat limit reached.');
    }

    // 3. Upsert membership
    const existingMembership = await tx.memberships.findUnique({
      where: { team_id_user_id: { team_id: teamId, user_id: userId } },
    });

    if (existingMembership) {
      if (existingMembership.removed_at === null) {
        // Already active member
        throw new HttpError(400, 'auth.link.invalid', 'This link is invalid or has expired. Request a new one.');
      }
      await tx.memberships.update({
        where: { id: existingMembership.id },
        data: {
          role: foundInvite.role,
          removed_at: null,
        },
      });
    } else {
      await tx.memberships.create({
        data: {
          team_id: teamId,
          user_id: userId,
          role: foundInvite.role,
        },
      });
    }

    // 4. Mark invite accepted
    await tx.invites.update({
      where: { id: foundInvite.id },
      data: { accepted_at: new Date() },
    });
  });

  // 5. Update user_team_index in DB0
  const db0 = globalDb();
  await db0.$executeRaw`
    INSERT INTO user_team_index (user_id, team_id)
    VALUES (${userId}::uuid, ${teamId}::uuid)
    ON CONFLICT (user_id, team_id) DO NOTHING
  `;

  return { teamId, role: foundInvite.role as Role };
}

/** Update team settings (Owner only: managers_can_revoke_invites). */
export async function updateTeamSettings(
  userId: string,
  teamId: string,
  input: UpdateTeamSettingsInput,
): Promise<{ managersCanRevokeInvites: boolean }> {
  const shardClient = forTeam(teamId);
  const { membership: callerMembership } = await requireActiveMemberAndTeam(shardClient, teamId, userId);

  const allowed = can({ id: userId }, { ...callerMembership, role: callerMembership.role as Role }, 'manage_settings');
  if (!allowed) {
    throw new HttpError(403, 'team.forbidden', 'You do not have permission to perform this action.');
  }

  const updated = await shardClient.teams.update({
    where: { id: teamId },
    data: { managers_can_revoke_invites: input.managers_can_revoke_invites },
  });

  return { managersCanRevokeInvites: updated.managers_can_revoke_invites };
}

/**
 * Delete a team (Owner only; soft delete, sets deleted_at and deleted_by).
 * Verified team name match on server (Phase C).
 * Order of checks: team exists / active member, permission (403 team.forbidden for non-Owner),
 * then name match (422 team.nameMismatch).
 */
export async function deleteTeam(
  userId: string,
  teamId: string,
  input: DeleteTeamInput,
): Promise<DeleteTeamResponse> {
  assertTeamId(teamId);
  const shardClient = forTeam(teamId);
  const { membership: callerMembership, team } = await requireActiveMemberAndTeam(shardClient, teamId, userId);

  const allowed = can({ id: userId }, { ...callerMembership, role: callerMembership.role as Role }, 'delete_team');
  if (!allowed) {
    throw new HttpError(403, 'team.forbidden', 'You do not have permission to perform this action.');
  }

  if (input.confirmName !== team.name) {
    throw new HttpError(422, 'team.nameMismatch', 'The team name does not match.');
  }

  await shardTransaction(shardFor(teamId), async (tx) => {
    await tx.teams.update({
      where: { id: teamId },
      data: {
        deleted_at: new Date(),
        deleted_by: userId,
      },
    });
    await tx.activity_events.create({
      data: {
        team_id: teamId,
        actor_user_id: userId,
        kind: 'team.deleted',
        audience: 'managers',
        subject_id: teamId,
        data: { name: team.name },
      },
    });
  });

  const db0 = globalDb();
  await db0.user_team_index.deleteMany({
    where: { team_id: teamId },
  });

  return { success: true, teamId };
}

/**
 * Transfer team ownership to an active colleague (Owner only).
 * Target becomes Owner, former Owner becomes Manager, in one transaction.
 * created_by is NOT altered.
 * Order of checks: team exists / active member, permission (403 team.forbidden for non-Owner),
 * target validation (422 team.transferTargetInvalid for self or non-member).
 */
export async function transferTeam(
  userId: string,
  teamId: string,
  input: TransferTeamInput,
): Promise<TransferTeamResponse> {
  assertTeamId(teamId);
  const shardClient = forTeam(teamId);
  const { membership: callerMembership } = await requireActiveMemberAndTeam(shardClient, teamId, userId);

  const allowed = can({ id: userId }, { ...callerMembership, role: callerMembership.role as Role }, 'transfer_ownership');
  if (!allowed) {
    throw new HttpError(403, 'team.forbidden', 'You do not have permission to perform this action.');
  }

  if (input.targetUserId === userId) {
    throw new HttpError(422, 'team.transferTargetInvalid', 'Cannot transfer ownership to yourself.');
  }

  const targetMembership = await shardClient.memberships.findUnique({
    where: { team_id_user_id: { team_id: teamId, user_id: input.targetUserId } },
  });
  if (!targetMembership || targetMembership.removed_at !== null) {
    throw new HttpError(422, 'team.transferTargetInvalid', 'Target user is not an active member of this team.');
  }

  await teamTransaction(teamId, async (tx) => {
    // 1. Lock team row and both membership rows (FOR UPDATE) in consistent user_id order
    await tx.$queryRaw`
      SELECT id::text FROM teams WHERE id = ${teamId}::uuid FOR UPDATE
    `;

    const lockedMemberships = await tx.$queryRaw<{ id: string; user_id: string; role: string; removed_at: Date | null }[]>`
      SELECT id::text, user_id::text, role, removed_at
      FROM memberships
      WHERE team_id = ${teamId}::uuid AND user_id IN (${userId}::uuid, ${input.targetUserId}::uuid)
      ORDER BY user_id ASC
      FOR UPDATE
    `;

    const lockedCaller = lockedMemberships.find((m) => m.user_id === userId);
    const lockedTarget = lockedMemberships.find((m) => m.user_id === input.targetUserId);

    if (!lockedCaller || lockedCaller.removed_at !== null || lockedCaller.role !== 'owner') {
      throw new HttpError(403, 'team.forbidden', 'Caller is no longer the active owner of this team.');
    }

    if (!lockedTarget || lockedTarget.removed_at !== null) {
      throw new HttpError(422, 'team.transferTargetInvalid', 'Target user is not an active member of this team.');
    }

    // 2. Former owner becomes manager FIRST (freeing the single-owner slot for memberships_one_owner_idx)
    await tx.memberships.update({
      where: { id: lockedCaller.id },
      data: { role: 'manager' },
    });

    // 3. Target becomes owner SECOND
    await tx.memberships.update({
      where: { id: lockedTarget.id },
      data: { role: 'owner' },
    });

    // 4. Activity audit row
    await tx.activity_events.create({
      data: {
        team_id: teamId,
        actor_user_id: userId,
        kind: 'team.transferred',
        audience: 'managers',
        subject_id: input.targetUserId,
        data: {
          previousOwnerId: userId,
          newOwnerId: input.targetUserId,
        },
      },
    });
  });

  return { success: true, teamId, newOwnerId: input.targetUserId };
}

export const TEAM_RESTORE_WINDOW_DAYS = 30;
export const TEAM_RESTORE_WINDOW_MS = TEAM_RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1_000;

/**
 * List the caller's own soft-deleted teams within the 30-day retention window.
 * Queries both shard databases without exposing user emails or display names.
 */
export async function listDeletedTeams(
  userId: string,
): Promise<DeletedTeamsResponse> {
  const windowStart = new Date(Date.now() - TEAM_RESTORE_WINDOW_MS);
  const client0 = writeDb(0) as AnyPrismaClient;
  const client1 = writeDb(1) as AnyPrismaClient;

  const [db0Teams, db1Teams] = await Promise.all([
    client0.teams.findMany({
      where: {
        deleted_by: userId,
        deleted_at: { gte: windowStart },
      },
      select: {
        id: true,
        name: true,
        deleted_at: true,
      },
    }),
    client1.teams.findMany({
      where: {
        deleted_by: userId,
        deleted_at: { gte: windowStart },
      },
      select: {
        id: true,
        name: true,
        deleted_at: true,
      },
    }),
  ]);

  const allDeleted = [...db0Teams, ...db1Teams]
    .filter((t): t is typeof t & { deleted_at: Date } => t.deleted_at !== null)
    .sort((a, b) => b.deleted_at.getTime() - a.deleted_at.getTime());

  return {
    teams: allDeleted.map((t) => ({
      id: t.id,
      name: t.name,
      deletedAt: t.deleted_at.toISOString(),
      restoreUntil: new Date(t.deleted_at.getTime() + TEAM_RESTORE_WINDOW_MS).toISOString(),
    })),
  };
}

/**
 * Restore a soft-deleted team (Admin who deleted it only).
 * In one locked transaction on the team's shard:
 * 1. Locks the team row (SELECT ... FOR UPDATE).
 * 2. If not deleted or not the deleter: throws 404 (existence not leaked).
 * 3. If deleted_at is older than 30 days: throws 410 team.restoreExpired.
 * 4. Clears deleted_at and deleted_by.
 * 5. Rebuilds user_team_index in globalDb for every active member at delete time.
 * 6. Records team.restored activity row with audience 'managers', IDs only (no names or emails).
 */
export async function restoreTeam(
  userId: string,
  teamId: string,
): Promise<RestoreTeamResponse> {
  assertTeamId(teamId);
  const shard = shardFor(teamId);
  const shardClient = forTeam(teamId);

  // 1. Unlocked pre-check on shard: team must be soft-deleted by this Admin within the window
  const preTeam = await shardClient.teams.findUnique({
    where: { id: teamId },
    select: { id: true, deleted_at: true, deleted_by: true },
  });
  if (!preTeam || preTeam.deleted_at === null || preTeam.deleted_by !== userId) {
    throw new HttpError(404, 'team.notFound', authMessage('team.notFound'));
  }

  const windowStart = new Date(Date.now() - TEAM_RESTORE_WINDOW_MS);
  if (preTeam.deleted_at.getTime() < windowStart.getTime()) {
    throw new HttpError(410, 'team.restoreExpired', authMessage('team.restoreExpired'));
  }

  const activeMembers = await shardClient.memberships.findMany({
    where: { team_id: teamId, removed_at: null },
    select: { user_id: true },
  });
  const restoredMemberIds = activeMembers.map((m) => m.user_id);

  // 2. Idempotent index rebuild in db0 BEFORE clearing deleted_at on the shard.
  // If db0 fails, shard transaction never runs, deleted_at remains set, and retry works.
  // If shard fails, stray index rows are harmless because listTeams ignores teams with deleted_at != null.
  const db0 = globalDb();
  if (restoredMemberIds.length > 0) {
    await db0.user_team_index.createMany({
      data: restoredMemberIds.map((memberId) => ({
        user_id: memberId,
        team_id: teamId,
      })),
      skipDuplicates: true,
    });
  }

  // 3. Locked shard transaction: re-validates under FOR UPDATE lock and clears deleted_at
  await shardTransaction(shard, async (tx) => {
    const lockedTeams = await tx.$queryRaw<{
      id: string;
      deleted_at: Date | null;
      deleted_by: string | null;
    }[]>`
      SELECT id::text, deleted_at, deleted_by::text
      FROM teams
      WHERE id = ${teamId}::uuid
      FOR UPDATE
    `;

    const team = lockedTeams[0];
    if (!team || team.deleted_at === null || team.deleted_by !== userId) {
      throw new HttpError(404, 'team.notFound', authMessage('team.notFound'));
    }

    if (team.deleted_at.getTime() < windowStart.getTime()) {
      throw new HttpError(410, 'team.restoreExpired', authMessage('team.restoreExpired'));
    }

    await tx.teams.update({
      where: { id: teamId },
      data: {
        deleted_at: null,
        deleted_by: null,
      },
    });

    await tx.activity_events.create({
      data: {
        team_id: teamId,
        actor_user_id: userId,
        kind: 'team.restored',
        subject_id: teamId,
        audience: 'managers',
        data: {
          restoredBy: userId,
          restoredMemberCount: restoredMemberIds.length,
        },
      },
    });
  });

  return { success: true, teamId };
}

