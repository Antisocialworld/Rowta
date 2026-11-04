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
import { enqueueNotification } from '../notifications/outbox.ts';
import {
  decideShiftNotifications,
  shiftNotificationDedupeKey,
} from '../notifications/shift-notifications.ts';

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

      // Enqueue shift.assigned notification for the new assignee inside the same transaction
      const createNotifications = decideShiftNotifications({
        actorUserId: userId,
        action: 'create',
        currentAssigneeId: null,
        newAssigneeId: input.assignedUserId,
        relevantFieldsChanged: false,
      });
      for (const n of createNotifications) {
        await enqueueNotification(tx, {
          recipientUserId: n.recipientUserId,
          category: n.category,
          payload: {
            type: 'shift',
            shiftId: created.id,
            teamId,
            label: created.label,
          },
          dedupeKey: shiftNotificationDedupeKey({
            shiftId: created.id,
            category: n.category,
            recipientUserId: n.recipientUserId,
            eventTimestampIso: iso(created.created_at),
          }),
        });
      }

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
    // Record what changed on the shift (additive, never stores notes text).
    const changes: Record<string, { from: unknown; to: unknown } | boolean> = {};
    if (input.label !== current.label) {
      changes.label = { from: current.label, to: input.label };
    }
    if (input.startsAt !== iso(current.starts_at)) {
      changes.startsAt = { from: iso(current.starts_at), to: input.startsAt };
    }
    if (input.endsAt !== iso(current.ends_at)) {
      changes.endsAt = { from: iso(current.ends_at), to: input.endsAt };
    }
    if (input.assignedUserId !== current.assigned_user_id) {
      changes.assignedUserId = { from: current.assigned_user_id, to: input.assignedUserId };
    }
    if ((input.notes ?? null) !== current.notes) {
      changes.notesChanged = true;
    }

    await writeActivity(tx, teamId, userId, 'shift.updated', updated.id, {
      label: updated.label,
      startsAt: iso(updated.starts_at),
      endsAt: iso(updated.ends_at),
      changes,
    });

    // Enqueue shift change notifications for the assignee(s) inside the same transaction
    const assigneeChanged = input.assignedUserId !== current.assigned_user_id;
    const relevantFieldsChanged =
      input.label !== current.label ||
      input.startsAt !== iso(current.starts_at) ||
      input.endsAt !== iso(current.ends_at);
    const updateNotifications = decideShiftNotifications({
      actorUserId: userId,
      action: 'update',
      currentAssigneeId: current.assigned_user_id,
      newAssigneeId: input.assignedUserId,
      relevantFieldsChanged: assigneeChanged || relevantFieldsChanged,
    });
    for (const n of updateNotifications) {
      await enqueueNotification(tx, {
        recipientUserId: n.recipientUserId,
        category: n.category,
        payload: {
          type: 'shift',
          shiftId: updated.id,
          teamId,
          label: updated.label,
        },
          dedupeKey: shiftNotificationDedupeKey({
            shiftId: updated.id,
            category: n.category,
            recipientUserId: n.recipientUserId,
            eventTimestampIso: iso(updated.updated_at),
          }),
        });
      }

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

    // Enqueue shift.cancelled notification for the assignee inside the same transaction
    const deleteNotifications = decideShiftNotifications({
      actorUserId: userId,
      action: 'delete',
      currentAssigneeId: current.assigned_user_id,
      newAssigneeId: null,
      relevantFieldsChanged: false,
    });
    for (const n of deleteNotifications) {
      await enqueueNotification(tx, {
        recipientUserId: n.recipientUserId,
        category: n.category,
        payload: {
          type: 'shift',
          shiftId: current.id,
          teamId,
          label: current.label,
        },
          dedupeKey: shiftNotificationDedupeKey({
            shiftId: current.id,
            category: n.category,
            recipientUserId: n.recipientUserId,
            eventTimestampIso: iso(current.updated_at),
          }),
        });
      }
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
  // Reuse the role names from policy.ts (Role = 'owner' | 'manager' | 'staff').
  const role = membership.role;
  // Audience enforcement (owner decision):
  //   'team'       -> every member
  //   'managers'   -> owner or manager only
  //   'involved'   -> owner or manager, or the actor themselves
  //   anything else -> managers-only (fail closed)

  const rows: ActivityRow[] = cursor
    ? await client.$queryRaw<ActivityRow[]>`
        SELECT id::text, kind, actor_user_id::text, subject_id::text, data, created_at
        FROM activity_events
        WHERE team_id = ${teamId}::uuid
        AND (
          audience = 'team'
          OR (audience = 'managers' AND ${role} IN ('owner', 'manager'))
          OR (audience = 'involved' AND (${role} IN ('owner', 'manager') OR actor_user_id = ${userId}::uuid))
          OR (audience NOT IN ('team', 'managers', 'involved') AND ${role} IN ('owner', 'manager'))
        )
          AND (created_at, id) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)
        ORDER BY created_at DESC, id DESC
        LIMIT ${fetchLimit}
      `
    : await client.$queryRaw<ActivityRow[]>`
        SELECT id::text, kind, actor_user_id::text, subject_id::text, data, created_at
        FROM activity_events
        WHERE team_id = ${teamId}::uuid
        AND (
          audience = 'team'
          OR (audience = 'managers' AND ${role} IN ('owner', 'manager'))
          OR (audience = 'involved' AND (${role} IN ('owner', 'manager') OR actor_user_id = ${userId}::uuid))
          OR (audience NOT IN ('team', 'managers', 'involved') AND ${role} IN ('owner', 'manager'))
        )
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
  created_at: Date;
  updated_at: Date;
}

const FUZZY_MIN_QUERY_LENGTH = 4;
const FUZZY_WORD_SIMILARITY_THRESHOLD = 0.3;

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, '\\$&');
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
  const escapedQ = escapeLike(q);
  const likePrefix = `${escapedQ}%`;
  const likeContains = `%${escapedQ}%`;
  // Same audience filter as listActivity (owner decision): reuse role names from policy.ts.
  const role = membership.role;

  const memberships = await client.memberships.findMany({
    where: { team_id: teamId, removed_at: null },
    orderBy: { created_at: 'asc' },
  });
  const memberIds = memberships.map((m) => m.user_id);

  let userRows: Array<{ id: string; display_name: string }> = [];
  if (memberIds.length > 0) {
    userRows = await globalDb().$queryRaw<Array<{ id: string; display_name: string }>>`
      SELECT id::text, display_name
      FROM users
      WHERE id = ANY(${memberIds}::uuid[])
        AND (
          display_name ILIKE ${likeContains}
          OR (char_length(${q}) >= ${FUZZY_MIN_QUERY_LENGTH} AND word_similarity(${q}, display_name) >= ${FUZZY_WORD_SIMILARITY_THRESHOLD})
        )
      ORDER BY
        CASE
          WHEN lower(display_name) = lower(${q}) THEN 1
          WHEN lower(display_name) LIKE lower(${likePrefix}) THEN 2
          WHEN lower(display_name) LIKE lower(${likeContains}) THEN 3
          ELSE 4
        END ASC,
        CASE
          WHEN char_length(${q}) >= ${FUZZY_MIN_QUERY_LENGTH} THEN word_similarity(${q}, display_name)
          ELSE 0
        END DESC,
        CASE
          WHEN char_length(${q}) >= ${FUZZY_MIN_QUERY_LENGTH} THEN similarity(${q}, display_name)
          ELSE 0
        END DESC,
        display_name ASC
      LIMIT ${SEARCH_RESULT_LIMIT}
    `;
  }

  const roleById = new Map(memberships.map((m) => [m.user_id, roleOf(m)]));
  const members = userRows.map((u) => ({
    userId: u.id,
    displayName: u.display_name,
    role: roleById.get(u.id) ?? 'staff',
  }));

  const shiftRows = await client.$queryRaw<ShiftSearchRow[]>`
    SELECT id::text, team_id::text, assigned_user_id::text, starts_at, ends_at, label, notes, created_at, updated_at
    FROM shifts
    WHERE team_id = ${teamId}::uuid
      AND deleted_at IS NULL
      AND (
        search @@ plainto_tsquery('simple', ${q})
        OR label ILIKE ${likeContains}
        OR coalesce(notes, '') ILIKE ${likeContains}
        OR (char_length(${q}) >= ${FUZZY_MIN_QUERY_LENGTH} AND word_similarity(${q}, label) >= ${FUZZY_WORD_SIMILARITY_THRESHOLD})
      )
    ORDER BY
      CASE
        WHEN lower(label) = lower(${q}) THEN 1
        WHEN lower(label) LIKE lower(${likePrefix}) THEN 2
        WHEN lower(label) LIKE lower(${likeContains}) OR lower(coalesce(notes, '')) LIKE lower(${likeContains}) OR search @@ plainto_tsquery('simple', ${q}) THEN 3
        ELSE 4
      END ASC,
      CASE
        WHEN char_length(${q}) >= ${FUZZY_MIN_QUERY_LENGTH} THEN word_similarity(${q}, label)
        ELSE ts_rank_cd(search, plainto_tsquery('simple', ${q}))
      END DESC,
      CASE
        WHEN char_length(${q}) >= ${FUZZY_MIN_QUERY_LENGTH} THEN similarity(${q}, label)
        ELSE 0
      END DESC,
      starts_at DESC
    LIMIT ${SEARCH_RESULT_LIMIT}
  `;

  const activityRows = await client.$queryRaw<ActivityRow[]>`
    SELECT id::text, kind, actor_user_id::text, subject_id::text, data, created_at
    FROM activity_events
    WHERE team_id = ${teamId}::uuid
    AND (
      audience = 'team'
      OR (audience = 'managers' AND ${role} IN ('owner', 'manager'))
      OR (audience = 'involved' AND (${role} IN ('owner', 'manager') OR actor_user_id = ${userId}::uuid))
      OR (audience NOT IN ('team', 'managers', 'involved') AND ${role} IN ('owner', 'manager'))
    )
    AND (
      search @@ plainto_tsquery('simple', ${q})
      OR coalesce(data ->> 'label', '') ILIKE ${likeContains}
      OR (char_length(${q}) >= ${FUZZY_MIN_QUERY_LENGTH} AND word_similarity(${q}, coalesce(data ->> 'label', '')) >= ${FUZZY_WORD_SIMILARITY_THRESHOLD})
    )
    ORDER BY
      CASE
        WHEN lower(coalesce(data ->> 'label', '')) = lower(${q}) THEN 1
        WHEN lower(coalesce(data ->> 'label', '')) LIKE lower(${likePrefix}) THEN 2
        WHEN lower(coalesce(data ->> 'label', '')) LIKE lower(${likeContains}) OR search @@ plainto_tsquery('simple', ${q}) THEN 3
        ELSE 4
      END ASC,
      CASE
        WHEN char_length(${q}) >= ${FUZZY_MIN_QUERY_LENGTH} THEN word_similarity(${q}, coalesce(data ->> 'label', ''))
        ELSE ts_rank_cd(search, plainto_tsquery('simple', ${q}))
      END DESC,
      CASE
        WHEN char_length(${q}) >= ${FUZZY_MIN_QUERY_LENGTH} THEN similarity(${q}, coalesce(data ->> 'label', ''))
        ELSE 0
      END DESC,
      created_at DESC
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
