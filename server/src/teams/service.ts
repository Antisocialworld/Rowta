// Teams service: teams, memberships, invites, and settings (rules S6, S7, S8, D2, C3, C4, A6, A7).
import { randomUUID } from 'node:crypto';
import {
  INVITE_TTL_SECONDS,
  STARTER_SEAT_CAP,
  normaliseEmail,
  type CreateTeamInput,
  type InviteMemberInput,
  type ChangeMemberRoleInput,
  type UpdateTeamSettingsInput,
} from '@rowta/shared';
import {
  forTeam,
  globalDb,
  shardTransaction,
  teamTransaction,
  writeDb,
  type AnyPrismaClient,
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

/** Timing decoy against dummy hash (Rule A7: equal cost when selector is not found). */
async function dummyVerify(): Promise<void> {
  const dummy = await getDummyHash();
  await verifySecret(dummy, 'invalid-verifier-timing-decoy');
}

/** Calculate seat cap for team (Owner decision 1; PRD section 5). */
export async function getSeatCap(teamId: string, client: AnyPrismaClient): Promise<number> {
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
): Promise<{ id: string; name: string; role: Role; managersCanRevokeInvites: boolean }[]> {
  const db0 = globalDb();
  const indexRows = await db0.user_team_index.findMany({
    where: { user_id: userId },
  });

  const teams: { id: string; name: string; role: Role; managersCanRevokeInvites: boolean }[] = [];

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

    teams.push({
      id: team.id,
      name: team.name,
      role: membership.role as Role,
      managersCanRevokeInvites: team.managers_can_revoke_invites,
    });
  }

  return teams;
}

/** Get team details if caller is an active member. S7: Cross-team returns 404. */
export async function getTeam(
  userId: string,
  teamId: string,
): Promise<{ id: string; name: string; role: Role; managersCanRevokeInvites: boolean }> {
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

  return {
    id: team.id,
    name: team.name,
    role: membership.role as Role,
    managersCanRevokeInvites: team.managers_can_revoke_invites,
  };
}

/** List active members of the team. */
export async function listMembers(
  userId: string,
  teamId: string,
): Promise<{ userId: string; role: Role; displayName: string; email: string; createdAt: Date }[]> {
  assertTeamId(teamId);
  const shardClient = forTeam(teamId);

  const callerMembership = await shardClient.memberships.findUnique({
    where: { team_id_user_id: { team_id: teamId, user_id: userId } },
  });
  if (!callerMembership || callerMembership.removed_at !== null) {
    throw new HttpError(404, 'team.notFound', 'Team not found.');
  }

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

  return members.map((m) => {
    const u = userMap.get(m.user_id);
    return {
      userId: m.user_id,
      role: m.role as Role,
      displayName: u?.display_name ?? '',
      email: u?.email ?? '',
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
  assertTeamId(teamId);
  const shardClient = forTeam(teamId);

  const callerMembership = await shardClient.memberships.findUnique({
    where: { team_id_user_id: { team_id: teamId, user_id: userId } },
  });
  if (!callerMembership || callerMembership.removed_at !== null) {
    throw new HttpError(404, 'team.notFound', 'Team not found.');
  }

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
  assertTeamId(teamId);
  const shardClient = forTeam(teamId);

  const callerMembership = await shardClient.memberships.findUnique({
    where: { team_id_user_id: { team_id: teamId, user_id: userId } },
  });
  if (!callerMembership || callerMembership.removed_at !== null) {
    throw new HttpError(404, 'team.notFound', 'Team not found.');
  }

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
  assertTeamId(teamId);
  const shardClient = forTeam(teamId);

  const callerMembership = await shardClient.memberships.findUnique({
    where: { team_id_user_id: { team_id: teamId, user_id: userId } },
  });
  if (!callerMembership || callerMembership.removed_at !== null) {
    throw new HttpError(404, 'team.notFound', 'Team not found.');
  }

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
  assertTeamId(teamId);
  const shardClient = forTeam(teamId);

  const callerMembership = await shardClient.memberships.findUnique({
    where: { team_id_user_id: { team_id: teamId, user_id: userId } },
  });
  if (!callerMembership || callerMembership.removed_at !== null) {
    throw new HttpError(404, 'team.notFound', 'Team not found.');
  }

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
): Promise<{ id: string; email: string; role: Role; createdAt: Date; expiresAt: Date }[]> {
  assertTeamId(teamId);
  const shardClient = forTeam(teamId);

  const callerMembership = await shardClient.memberships.findUnique({
    where: { team_id_user_id: { team_id: teamId, user_id: userId } },
  });
  if (!callerMembership || callerMembership.removed_at !== null) {
    throw new HttpError(404, 'team.notFound', 'Team not found.');
  }

  if (!can({ id: userId }, { ...callerMembership, role: callerMembership.role as Role }, 'view_team')) {
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
  }));
}

/** Revoke an open invite (Owner, or Manager for staff invites if managers_can_revoke_invites is true). */
export async function revokeInvite(userId: string, teamId: string, inviteId: string): Promise<{ revoked: boolean }> {
  assertTeamId(teamId);
  const shardClient = forTeam(teamId);

  const callerMembership = await shardClient.memberships.findUnique({
    where: { team_id_user_id: { team_id: teamId, user_id: userId } },
  });
  if (!callerMembership || callerMembership.removed_at !== null) {
    throw new HttpError(404, 'team.notFound', 'Team not found.');
  }

  const team = await shardClient.teams.findUnique({
    where: { id: teamId },
  });
  if (!team || team.deleted_at !== null) {
    throw new HttpError(404, 'team.notFound', 'Team not found.');
  }

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

    await tx.$queryRaw`
      SELECT id::text FROM teams WHERE id = ${teamId}::uuid FOR UPDATE
    `;

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
  assertTeamId(teamId);
  const shardClient = forTeam(teamId);

  const callerMembership = await shardClient.memberships.findUnique({
    where: { team_id_user_id: { team_id: teamId, user_id: userId } },
  });
  if (!callerMembership || callerMembership.removed_at !== null) {
    throw new HttpError(404, 'team.notFound', 'Team not found.');
  }

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
