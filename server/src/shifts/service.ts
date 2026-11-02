// Shifts, calendar, activity feed and search (PRD 4, 6.1, 8.3, 8.4; rules S6, S7, S8, C4, D4).
//
// Every read and write is scoped by teamId (S7), authorisation goes through the central `can()`
// policy and its pure-DATA matrix, and every shift change writes its activity event in the SAME
// transaction. Deleting a shift is a soft delete: rows stay, reads filter `deleted_at IS NULL`.
import {
  ACTIVITY_PAGE_DEFAULT,
  SEARCH_RESULT_LIMIT,
  activityCursorSchema,
  type ActivityEventView,
  type ActivityPageView,
  type ActivityQuery,
  type CalendarQuery,
  type CreateShiftInput,
  type SearchQuery,
  type SearchResultsView,
  type ShiftDetailView,
  type ShiftView,
  type UpdateShiftInput,
} from '@rowta/shared';
import {
  forTeam,
  globalDb,
  teamTransaction,
  type AnyPrismaClient,
  type JsonInput,
  type ShardTx,
} from '../db/clients.ts';
import { fingerprint } from '../security/fingerprint.ts';
import { can, type Role } from '../security/policy.ts';
import { HttpError } from '../middleware/error.ts';
import { cancelPendingSwapsForShift } from '../swaps/service.ts';

const FORBIDDEN = 'You do not have permission to perform this action.';

function assertTeamId(teamId: string): void {
  if (typeof teamId !== 'string' || teamId.trim().length === 0) {
    throw new Error('teamId is required for team-scoped data access (rule S7)');
  }
}

function iso(value: Date): string {
  return value.toISOString();
}

function roleOf(membership: { role: string }): Role {
  if (membership.role === 'owner' || membership.role === 'manager' || membership.role === 'staff') {
    return membership.role;
  }
  throw new Error(`unknown membership role "${membership.role}"`);
}

/** Caller's active membership or 404 (S7: never reveal that another team's resource exists). */
async function requireMember(client: AnyPrismaClient, teamId: string, userId: string) {
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
  return membership;
}

function requireAction(
  userId: string,
  membership: { role: string; user_id: string },
  action: 'view_shifts' | 'manage_shifts' | 'view_team',
): void {
  if (!can({ id: userId }, { user_id: membership.user_id, role: roleOf(membership) }, action)) {
    throw new HttpError(403, 'team.forbidden', FORBIDDEN);
  }
}

/** Every shift change writes its activity event here, inside the caller's transaction. */
async function writeActivity(
  tx: ShardTx,
  teamId: string,
  actorUserId: string,
  kind: 'shift.created' | 'shift.updated' | 'shift.deleted',
  subjectId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await tx.activity_events.create({
    data: {
      team_id: teamId,
      kind,
      audience: 'team',
      actor_user_id: actorUserId,
      subject_id: subjectId,
      data: data as JsonInput,
    },
  });
}

function toShiftView(shift: {
  id: string;
  team_id: string;
  assigned_user_id: string;
  starts_at: Date;
  ends_at: Date;
  label: string;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}): ShiftView {
  return {
    id: shift.id,
    teamId: shift.team_id,
    assignedUserId: shift.assigned_user_id,
    startsAt: iso(shift.starts_at),
    endsAt: iso(shift.ends_at),
    label: shift.label,
    notes: shift.notes,
    createdAt: iso(shift.created_at),
    updatedAt: iso(shift.updated_at),
  };
}

async function assertActiveAssignee(
  client: AnyPrismaClient | ShardTx,
  teamId: string,
  assignedUserId: string,
): Promise<void> {
  const assignee = await client.memberships.findUnique({
    where: { team_id_user_id: { team_id: teamId, user_id: assignedUserId } },
  });
  if (!assignee || assignee.removed_at !== null) {
    throw new HttpError(422, 'validation.invalid', 'Validation failed.', undefined, {
      assignedUserId: 'shift.assignee.invalid',
    });
  }
}

function normalisedIdempotencyPayload(input: CreateShiftInput): string {
  return JSON.stringify({
    assignedUserId: input.assignedUserId,
    startsAt: iso(new Date(input.startsAt)),
    endsAt: iso(new Date(input.endsAt)),
    label: input.label,
    notes: input.notes ?? null,
  });
}

async function assertShiftReadable(
  client: AnyPrismaClient,
  teamId: string,
  shiftId: string,
): Promise<{
  id: string;
  team_id: string;
  assigned_user_id: string;
  starts_at: Date;
  ends_at: Date;
  label: string;
  notes: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}> {
  const shift = await client.shifts.findFirst({
    where: { id: shiftId, team_id: teamId, deleted_at: null },
  });
  if (!shift) throw new HttpError(404, 'shift.notFound', 'Shift not found.');
  return shift;
}

export async function createShift(
  userId: string,
  teamId: string,
  input: CreateShiftInput,
  idempotencyKey: string | undefined,
): Promise<ShiftView> {
  if (!idempotencyKey || idempotencyKey.trim().length === 0) {
    throw new HttpError(400, 'idempotency.missing', 'Idempotency-Key header is required for shift creation.');
  }

  const client = forTeam(teamId);
  const membership = await requireMember(client, teamId, userId);
  requireAction(userId, membership, 'manage_shifts');
  await assertActiveAssignee(client, teamId, input.assignedUserId);

  const scope = `create_shift:${teamId}:${userId}`;
  const reqFingerprint = fingerprint(normalisedIdempotencyPayload(input));

  const existingKey = await client.idempotency_keys.findUnique({
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
      return existingKey.response as unknown as ShiftView;
    }
  }

  await client.idempotency_keys.create({
    data: {
      scope,
      key: idempotencyKey,
      request_fingerprint: reqFingerprint,
      state: 'in_flight',
    },
  });

  try {
    const shift = await teamTransaction(teamId, async (tx) => {
      await assertActiveAssignee(tx, teamId, input.assignedUserId);
      const created = await tx.shifts.create({
        data: {
          team_id: teamId,
          assigned_user_id: input.assignedUserId,
          starts_at: new Date(input.startsAt),
          ends_at: new Date(input.endsAt),
          label: input.label,
          notes: input.notes ?? null,
          created_by: userId,
        },
      });
      await writeActivity(tx, teamId, userId, 'shift.created', created.id, {
        label: created.label,
        startsAt: iso(created.starts_at),
        endsAt: iso(created.ends_at),
      });
      return created;
    });

    const view = toShiftView(shift);
    await client.idempotency_keys.update({
      where: { scope_key: { scope, key: idempotencyKey } },
      data: { state: 'done', status_code: 201, response: view as unknown as JsonInput },
    });
    return view;
  } catch (err) {
    await client.idempotency_keys
      .delete({ where: { scope_key: { scope, key: idempotencyKey } } })
      .catch(() => undefined);
    throw err;
  }
}

export async function getShift(userId: string, teamId: string, shiftId: string): Promise<ShiftDetailView> {
  const client = forTeam(teamId);
  const membership = await requireMember(client, teamId, userId);
  requireAction(userId, membership, 'view_shifts');
  const shift = await assertShiftReadable(client, teamId, shiftId);

  const assigneeUser = await globalDb().users.findUnique({ where: { id: shift.assigned_user_id } });

  // Creator resolution: name + current role in this team (D9)
  const creatorUser = await globalDb().users.findUnique({ where: { id: shift.created_by } });
  const creatorMembership = await client.memberships.findUnique({
    where: { team_id_user_id: { team_id: teamId, user_id: shift.created_by } },
  });
  const creatorRole =
    creatorMembership && creatorMembership.removed_at === null
      ? (creatorMembership.role as 'owner' | 'manager' | 'staff')
      : null;

  return {
    ...toShiftView(shift),
    assignee: {
      userId: shift.assigned_user_id,
      displayName: assigneeUser?.display_name ?? '',
    },
    createdBy: {
      userId: shift.created_by,
      displayName: creatorUser?.display_name ?? '',
      role: creatorRole,
    },
  };
}

export async function listCalendar(
  userId: string,
  teamId: string,
  range: CalendarQuery,
): Promise<{ shifts: ShiftView[] }> {
  const client = forTeam(teamId);
  const membership = await requireMember(client, teamId, userId);
  requireAction(userId, membership, 'view_shifts');

  const from = new Date(range.from);
  const to = new Date(range.to);
  const rows = await client.shifts.findMany({
    where: {
      team_id: teamId,
      deleted_at: null,
      starts_at: { lt: to },
      ends_at: { gt: from },
    },
    orderBy: [{ starts_at: 'asc' }, { id: 'asc' }],
  });
  return { shifts: rows.map(toShiftView) };
}

export async function updateShift(
  userId: string,
  teamId: string,
  shiftId: string,
  input: UpdateShiftInput,
): Promise<ShiftView> {
  const client = forTeam(teamId);
  const membership = await requireMember(client, teamId, userId);
  requireAction(userId, membership, 'manage_shifts');
  await assertActiveAssignee(client, teamId, input.assignedUserId);

  const shift = await teamTransaction(teamId, async (tx) => {
    const current = await tx.shifts.findFirst({
      where: { id: shiftId, team_id: teamId, deleted_at: null },
    });
    if (!current) throw new HttpError(404, 'shift.notFound', 'Shift not found.');

    if (input.assignedUserId !== current.assigned_user_id) {
      await cancelPendingSwapsForShift(tx, teamId, current.id, userId, 'shift_reassigned');
    }

    const updated = await tx.shifts.update({
      where: { id: current.id },
      data: {
        assigned_user_id: input.assignedUserId,
        starts_at: new Date(input.startsAt),
        ends_at: new Date(input.endsAt),
        label: input.label,
        notes: input.notes ?? null,
      },
    });
    await writeActivity(tx, teamId, userId, 'shift.updated', updated.id, {
      label: updated.label,
      startsAt: iso(updated.starts_at),
      endsAt: iso(updated.ends_at),
    });
    return updated;
  });

  return toShiftView(shift);
}

export async function deleteShift(userId: string, teamId: string, shiftId: string): Promise<{ deleted: true }> {
  const client = forTeam(teamId);
  const membership = await requireMember(client, teamId, userId);
  requireAction(userId, membership, 'manage_shifts');

  await teamTransaction(teamId, async (tx) => {
    const current = await tx.shifts.findFirst({
      where: { id: shiftId, team_id: teamId, deleted_at: null },
    });
    if (!current) throw new HttpError(404, 'shift.notFound', 'Shift not found.');

    await cancelPendingSwapsForShift(tx, teamId, current.id, userId, 'shift_deleted');

    await tx.shifts.update({
      where: { id: current.id },
      data: { deleted_at: new Date(), deleted_by: userId },
    });
    await writeActivity(tx, teamId, userId, 'shift.deleted', current.id, {
      label: current.label,
      startsAt: iso(current.starts_at),
      endsAt: iso(current.ends_at),
    });
  });

  return { deleted: true };
}

interface Cursor {
  t: string;
  id: string;
}

function encodeCursor(t: string, id: string): string {
  return Buffer.from(JSON.stringify({ t, id }), 'utf8').toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  try {
    const text = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = activityCursorSchema.safeParse(JSON.parse(text) as unknown);
    if (!parsed.success) throw new Error('bad cursor');
    return parsed.data;
  } catch {
    throw new HttpError(400, 'activity.cursor.invalid', 'This page link is not valid. Refresh the list.');
  }
}

interface ActivityRow {
  id: string;
  kind: string;
  actor_user_id: string | null;
  subject_id: string | null;
  data: unknown;
  created_at: Date;
}

async function actorNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const users = await globalDb().users.findMany({ where: { id: { in: unique } } });
  return new Map(users.map((u) => [u.id, u.display_name]));
}

function toEventView(row: ActivityRow, names: Map<string, string>): ActivityEventView {
  return {
    id: row.id,
    kind: row.kind,
    actor:
      row.actor_user_id === null
        ? null
        : { userId: row.actor_user_id, displayName: names.get(row.actor_user_id) ?? '' },
    subjectId: row.subject_id,
    data: (row.data ?? {}) as Record<string, unknown>,
    createdAt: iso(row.created_at),
  };
}

export async function listActivity(
  userId: string,
  teamId: string,
  query: ActivityQuery,
): Promise<ActivityPageView> {
  const client = forTeam(teamId);
  const membership = await requireMember(client, teamId, userId);
  requireAction(userId, membership, 'view_shifts');

  const limit = query.limit ?? ACTIVITY_PAGE_DEFAULT;
  const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor);
  const fetchLimit = limit + 1;

  const rows: ActivityRow[] = cursor
    ? await client.$queryRaw<ActivityRow[]>`
        SELECT id::text, kind, actor_user_id::text, subject_id::text, data, created_at
        FROM activity_events
        WHERE team_id = ${teamId}::uuid
          AND (created_at, id) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)
        ORDER BY created_at DESC, id DESC
        LIMIT ${fetchLimit}
      `
    : await client.$queryRaw<ActivityRow[]>`
        SELECT id::text, kind, actor_user_id::text, subject_id::text, data, created_at
        FROM activity_events
        WHERE team_id = ${teamId}::uuid
        ORDER BY created_at DESC, id DESC
        LIMIT ${fetchLimit}
      `;

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const names = await actorNames(
    page.map((row) => row.actor_user_id).filter((id): id is string => id !== null),
  );

  return {
    events: page.map((row) => toEventView(row, names)),
    nextCursor: rows.length > limit && last ? encodeCursor(iso(last.created_at), last.id) : null,
  };
}

interface ShiftSearchRow {
  id: string;
  team_id: string;
  assigned_user_id: string;
  starts_at: Date;
  ends_at: Date;
  label: string;
  notes: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export async function searchTeam(
  userId: string,
  teamId: string,
  query: SearchQuery,
): Promise<SearchResultsView> {
  const client = forTeam(teamId);
  const membership = await requireMember(client, teamId, userId);
  requireAction(userId, membership, 'view_team');
  const q = query.q;

  const memberships = await client.memberships.findMany({
    where: { team_id: teamId, removed_at: null },
    orderBy: { created_at: 'asc' },
  });
  const memberIds = memberships.map((m) => m.user_id);
  const users = await globalDb().users.findMany({
    where: {
      id: { in: memberIds },
      display_name: { contains: q, mode: 'insensitive' },
    },
    take: SEARCH_RESULT_LIMIT,
  });
  const roleById = new Map(memberships.map((m) => [m.user_id, roleOf(m)]));
  const members = users
    .map((u) => ({
      userId: u.id,
      displayName: u.display_name,
      role: roleById.get(u.id) ?? 'staff',
    }))
    .sort((a, b) => {
      const aPrefix = a.displayName.toLowerCase().startsWith(q.toLowerCase()) ? 0 : 1;
      const bPrefix = b.displayName.toLowerCase().startsWith(q.toLowerCase()) ? 0 : 1;
      return aPrefix - bPrefix || a.displayName.localeCompare(b.displayName);
    })
    .slice(0, SEARCH_RESULT_LIMIT);

  const shiftRows = await client.$queryRaw<ShiftSearchRow[]>`
    SELECT id::text, team_id::text, assigned_user_id::text, starts_at, ends_at, label, notes, created_at, updated_at
    FROM shifts
    WHERE team_id = ${teamId}::uuid
      AND deleted_at IS NULL
      AND (
        search @@ plainto_tsquery('simple', ${q})
        OR label ILIKE ${`%${q}%`}
        OR coalesce(notes, '') ILIKE ${`%${q}%`}
      )
    ORDER BY ts_rank_cd(search, plainto_tsquery('simple', ${q})) DESC, starts_at DESC
    LIMIT ${SEARCH_RESULT_LIMIT}
  `;

  const activityRows = await client.$queryRaw<ActivityRow[]>`
    SELECT id::text, kind, actor_user_id::text, subject_id::text, data, created_at
    FROM activity_events
    WHERE team_id = ${teamId}::uuid
      AND (
        search @@ plainto_tsquery('simple', ${q})
        OR coalesce(data ->> 'label', '') ILIKE ${`%${q}%`}
      )
    ORDER BY ts_rank_cd(search, plainto_tsquery('simple', ${q})) DESC, created_at DESC
    LIMIT ${SEARCH_RESULT_LIMIT}
  `;

  const names = await actorNames(
    activityRows.map((row) => row.actor_user_id).filter((id): id is string => id !== null),
  );

  return {
    members,
    shifts: shiftRows.map(toShiftView),
    activity: activityRows.map((row) => toEventView(row, names)),
  };
}
