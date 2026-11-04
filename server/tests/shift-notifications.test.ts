// Pure unit tests for shift notification decision logic (PRD 7.1, 8.7; rules V1).
// Zero I/O, zero database; all decisions are pure functions of the input.
import { describe, expect, it } from 'vitest';
import {
  decideShiftNotifications,
  shiftNotificationDedupeKey,
} from '../src/notifications/shift-notifications.ts';

const ACTOR = 'actor-user-id';

describe('decideShiftNotifications', () => {
  describe('create', () => {
    it('notifies the new assignee with shift.assigned', () => {
      const decisions = decideShiftNotifications({
        actorUserId: ACTOR,
        action: 'create',
        currentAssigneeId: null,
        newAssigneeId: 'assignee-user-id',
        relevantFieldsChanged: false,
      });
      expect(decisions).toEqual([
        { recipientUserId: 'assignee-user-id', category: 'shift.assigned' },
      ]);
    });

    it('sends nothing when the actor is also the assignee', () => {
      const decisions = decideShiftNotifications({
        actorUserId: ACTOR,
        action: 'create',
        currentAssigneeId: null,
        newAssigneeId: ACTOR,
        relevantFieldsChanged: false,
      });
      expect(decisions).toEqual([]);
    });
  });

  describe('update', () => {
    it('notifies new assignee with shift.assigned and old assignee with shift.cancelled when assignee changes', () => {
      const decisions = decideShiftNotifications({
        actorUserId: ACTOR,
        action: 'update',
        currentAssigneeId: 'old-assignee-user-id',
        newAssigneeId: 'new-assignee-user-id',
        relevantFieldsChanged: false,
      });
      expect(decisions).toEqual([
        { recipientUserId: 'new-assignee-user-id', category: 'shift.assigned' },
        { recipientUserId: 'old-assignee-user-id', category: 'shift.cancelled' },
      ]);
    });

    it('skips the actor when the actor is the new assignee on reassignment', () => {
      const decisions = decideShiftNotifications({
        actorUserId: ACTOR,
        action: 'update',
        currentAssigneeId: 'old-assignee-user-id',
        newAssigneeId: ACTOR,
        relevantFieldsChanged: false,
      });
      expect(decisions).toEqual([
        { recipientUserId: 'old-assignee-user-id', category: 'shift.cancelled' },
      ]);
    });

    it('skips the actor when the actor is the old assignee on reassignment', () => {
      const decisions = decideShiftNotifications({
        actorUserId: ACTOR,
        action: 'update',
        currentAssigneeId: ACTOR,
        newAssigneeId: 'new-assignee-user-id',
        relevantFieldsChanged: false,
      });
      expect(decisions).toEqual([
        { recipientUserId: 'new-assignee-user-id', category: 'shift.assigned' },
      ]);
    });

    it('notifies the assignee with shift.changed when only relevant fields change', () => {
      const decisions = decideShiftNotifications({
        actorUserId: ACTOR,
        action: 'update',
        currentAssigneeId: 'assignee-user-id',
        newAssigneeId: 'assignee-user-id',
        relevantFieldsChanged: true,
      });
      expect(decisions).toEqual([
        { recipientUserId: 'assignee-user-id', category: 'shift.changed' },
      ]);
    });

    it('skips the actor when the actor is the assignee and relevant fields change', () => {
      const decisions = decideShiftNotifications({
        actorUserId: ACTOR,
        action: 'update',
        currentAssigneeId: ACTOR,
        newAssigneeId: ACTOR,
        relevantFieldsChanged: true,
      });
      expect(decisions).toEqual([]);
    });

    it('sends nothing when nothing relevant changed', () => {
      const decisions = decideShiftNotifications({
        actorUserId: ACTOR,
        action: 'update',
        currentAssigneeId: 'assignee-user-id',
        newAssigneeId: 'assignee-user-id',
        relevantFieldsChanged: false,
      });
      expect(decisions).toEqual([]);
    });
  });

  describe('delete', () => {
    it('notifies the assignee with shift.cancelled', () => {
      const decisions = decideShiftNotifications({
        actorUserId: ACTOR,
        action: 'delete',
        currentAssigneeId: 'assignee-user-id',
        newAssigneeId: null,
        relevantFieldsChanged: false,
      });
      expect(decisions).toEqual([
        { recipientUserId: 'assignee-user-id', category: 'shift.cancelled' },
      ]);
    });

    it('sends nothing when the actor is the assignee being deleted', () => {
      const decisions = decideShiftNotifications({
        actorUserId: ACTOR,
        action: 'delete',
        currentAssigneeId: ACTOR,
        newAssigneeId: null,
        relevantFieldsChanged: false,
      });
      expect(decisions).toEqual([]);
    });

    it('sends nothing when there is no assignee', () => {
      const decisions = decideShiftNotifications({
        actorUserId: ACTOR,
        action: 'delete',
        currentAssigneeId: null,
        newAssigneeId: null,
        relevantFieldsChanged: false,
      });
      expect(decisions).toEqual([]);
    });
  });

  describe('shiftNotificationDedupeKey', () => {
    it('produces the same key for the same write retried twice', () => {
      const key1 = shiftNotificationDedupeKey({
        shiftId: 'shift-user-id',
        category: 'shift.assigned',
        recipientUserId: 'recipient-user-id',
        eventTimestampIso: '2026-01-15T10:00:00.000Z',
      });
      const key2 = shiftNotificationDedupeKey({
        shiftId: 'shift-user-id',
        category: 'shift.assigned',
        recipientUserId: 'recipient-user-id',
        eventTimestampIso: '2026-01-15T10:00:00.000Z',
      });
      expect(key1).toBe(key2);
      expect(key1).toBe(
        'shift:shift-user-id:shift.assigned:recipient-user-id:2026-01-15T10:00:00.000Z',
      );
    });

    it('produces different keys for two different writes to the same shift for the same recipient', () => {
      const key1 = shiftNotificationDedupeKey({
        shiftId: 'shift-user-id',
        category: 'shift.changed',
        recipientUserId: 'recipient-user-id',
        eventTimestampIso: '2026-01-15T10:00:00.000Z',
      });
      const key2 = shiftNotificationDedupeKey({
        shiftId: 'shift-user-id',
        category: 'shift.changed',
        recipientUserId: 'recipient-user-id',
        eventTimestampIso: '2026-01-15T11:00:00.000Z',
      });
      expect(key1).not.toBe(key2);
    });

    it('produces different keys for the same shift when category differs', () => {
      const key1 = shiftNotificationDedupeKey({
        shiftId: 'shift-user-id',
        category: 'shift.assigned',
        recipientUserId: 'recipient-user-id',
        eventTimestampIso: '2026-01-15T10:00:00.000Z',
      });
      const key2 = shiftNotificationDedupeKey({
        shiftId: 'shift-user-id',
        category: 'shift.changed',
        recipientUserId: 'recipient-user-id',
        eventTimestampIso: '2026-01-15T10:00:00.000Z',
      });
      expect(key1).not.toBe(key2);
    });

    it('produces different keys for different recipients on the same shift', () => {
      const key1 = shiftNotificationDedupeKey({
        shiftId: 'shift-user-id',
        category: 'shift.assigned',
        recipientUserId: 'recipient-a',
        eventTimestampIso: '2026-01-15T10:00:00.000Z',
      });
      const key2 = shiftNotificationDedupeKey({
        shiftId: 'shift-user-id',
        category: 'shift.assigned',
        recipientUserId: 'recipient-b',
        eventTimestampIso: '2026-01-15T10:00:00.000Z',
      });
      expect(key1).not.toBe(key2);
    });
  });
});
