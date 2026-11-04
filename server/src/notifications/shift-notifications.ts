// Pure decision logic for shift change notifications (PRD 7.1, 8.7).
// Decides who receives which shift notification category.
// Zero I/O, zero database; testable in plain Node.

export type ShiftNotificationAction = 'create' | 'update' | 'delete';

export interface ShiftNotificationInput {
  actorUserId: string;
  action: ShiftNotificationAction;
  /** Assignee before the change (null for create). */
  currentAssigneeId: string | null;
  /** Assignee after the change (null for delete). */
  newAssigneeId: string | null;
  /** Whether label, start or end changed (relevant for update only). */
  relevantFieldsChanged: boolean;
}

export interface ShiftNotificationDecision {
  recipientUserId: string;
  category: 'shift.assigned' | 'shift.changed' | 'shift.cancelled';
}

/**
 * Decides who receives which shift notification category.
 *
 * Rules:
 * - Create: the new assignee gets shift.assigned.
 * - Update, assignee changed: the NEW assignee gets shift.assigned and the OLD assignee gets shift.cancelled.
 * - Update, assignee unchanged but label/start/end changed: the assignee gets shift.changed.
 * - Update, nothing relevant changed: nothing.
 * - Delete: the assignee gets shift.cancelled.
 * - Rule 4: never notify the actor about their own action (recipient === actorUserId → skip).
 */
export function decideShiftNotifications(input: ShiftNotificationInput): ShiftNotificationDecision[] {
  const {
    actorUserId,
    action,
    currentAssigneeId,
    newAssigneeId,
    relevantFieldsChanged,
  } = input;

  const decisions: ShiftNotificationDecision[] = [];

  const notify = (
    recipientUserId: string | null,
    category: ShiftNotificationDecision['category'],
  ): void => {
    if (!recipientUserId) return;
    if (recipientUserId === actorUserId) return; // Rule 4: never notify the actor about their own action
    decisions.push({ recipientUserId, category });
  };

  if (action === 'create') {
    notify(newAssigneeId, 'shift.assigned');
  } else if (action === 'update') {
    if (newAssigneeId !== currentAssigneeId) {
      // Assignee changed: new assignee assigned, old assignee cancelled
      notify(newAssigneeId, 'shift.assigned');
      notify(currentAssigneeId, 'shift.cancelled');
    } else if (relevantFieldsChanged) {
      // Assignee unchanged, but label/start/end changed
      notify(newAssigneeId ?? currentAssigneeId, 'shift.changed');
    }
    // nothing relevant changed → nothing
  } else if (action === 'delete') {
    notify(currentAssigneeId, 'shift.cancelled');
  }

  return decisions;
}

/**
 * Builds a per-write unique dedupe key for a shift notification outbox row.
 * The dedupe_key column is `text UNIQUE` (server/prisma/sql/061-notification-outbox.sql:16),
 * so the ISO timestamp component has no length limit.
 *
 * The timestamp component comes from the activity event written in the same transaction:
 * created.created_at for create, updated.updated_at for update, current.updated_at for delete
 * (service.ts:234, :365, :421). Because a retry of the same write reuses the same shift row's
 * timestamp, the same write twice produces the SAME key (deduped), while two different writes
 * to the same shift produce DIFFERENT keys.
 */
export function shiftNotificationDedupeKey({
  shiftId,
  category,
  recipientUserId,
  eventTimestampIso,
}: {
  shiftId: string;
  category: string;
  recipientUserId: string;
  eventTimestampIso: string;
}): string {
  return `shift:${shiftId}:${category}:${recipientUserId}:${eventTimestampIso}`;
}
