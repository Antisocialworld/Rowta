// Shared Zod schemas for shifts, the calendar, the activity feed and search (rules V1 to V3;
// PRD 4, 6.1, 8.3, 8.4). Strict objects reject unknown fields; the server validates again.
import { z } from 'zod';

export const SHIFT_LABEL_MAX_LENGTH = 100;
export const SHIFT_NOTES_MAX_LENGTH = 2_000;
export const CALENDAR_RANGE_MAX_DAYS = 42;
export const ACTIVITY_PAGE_DEFAULT = 20;
export const ACTIVITY_PAGE_MAX = 50;
export const SEARCH_QUERY_MIN_LENGTH = 2;
export const SEARCH_QUERY_MAX_LENGTH = 100;
export const SEARCH_RESULT_LIMIT = 20;

const isoDateTime = z.iso.datetime({ offset: true });

const shiftFields = {
  assignedUserId: z.string().uuid('shift.assignee.invalid'),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  label: z.string().trim().min(1, 'shift.label.required').max(SHIFT_LABEL_MAX_LENGTH, 'shift.label.tooLong'),
  notes: z
    .string()
    .trim()
    .max(SHIFT_NOTES_MAX_LENGTH, 'shift.notes.tooLong')
    .nullable()
    .optional(),
};

function timeOrderOk(value: { startsAt: string; endsAt: string }): boolean {
  return new Date(value.endsAt).getTime() > new Date(value.startsAt).getTime();
}

export const createShiftSchema = z
  .object(shiftFields)
  .strict()
  .refine(timeOrderOk, { path: ['endsAt'], message: 'shift.timeOrder' });
export type CreateShiftInput = z.infer<typeof createShiftSchema>;

export const updateShiftSchema = z
  .object(shiftFields)
  .strict()
  .refine(timeOrderOk, { path: ['endsAt'], message: 'shift.timeOrder' });
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;

export const calendarQuerySchema = z
  .object({
    from: isoDateTime,
    to: isoDateTime,
  })
  .strict()
  .refine((value) => new Date(value.to).getTime() > new Date(value.from).getTime(), {
    path: ['to'],
    message: 'shift.range.invalid',
  })
  .refine(
    (value) =>
      new Date(value.to).getTime() - new Date(value.from).getTime() <=
      CALENDAR_RANGE_MAX_DAYS * 24 * 60 * 60 * 1_000,
    { path: ['to'], message: 'shift.range.tooLong' },
  );
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;

export const activityQuerySchema = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(ACTIVITY_PAGE_MAX).default(ACTIVITY_PAGE_DEFAULT),
  })
  .strict();
export type ActivityQuery = z.infer<typeof activityQuerySchema>;

export const searchQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .min(SEARCH_QUERY_MIN_LENGTH, 'search.query.tooShort')
      .max(SEARCH_QUERY_MAX_LENGTH, 'search.query.tooShort'),
  })
  .strict();
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const activityCursorSchema = z
  .object({
    t: isoDateTime,
    id: z.string().uuid(),
  })
  .strict();
export type ActivityCursorPayload = z.infer<typeof activityCursorSchema>;

export interface ShiftView {
  id: string;
  teamId: string;
  assignedUserId: string;
  startsAt: string;
  endsAt: string;
  label: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShiftDetailView extends ShiftView {
  assignee: { userId: string; displayName: string };
}

export interface ActivityEventView {
  id: string;
  kind: string;
  actor: { userId: string; displayName: string } | null;
  subjectId: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface ActivityPageView {
  events: ActivityEventView[];
  nextCursor: string | null;
}

export interface SearchResultsView {
  members: { userId: string; displayName: string; role: 'owner' | 'manager' | 'staff' }[];
  shifts: ShiftView[];
  activity: ActivityEventView[];
}

// Runtime response schemas: the app safeParses every byte it trusts (S5, V1). They mirror the
// server's view serialisers above; changes here and in the server must land together.
export const shiftViewSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  assignedUserId: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  label: z.string(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const shiftDetailViewSchema = shiftViewSchema.extend({
  assignee: z.object({ userId: z.string(), displayName: z.string() }),
});

export const calendarResponseSchema = z.object({ shifts: z.array(shiftViewSchema) });

export const activityEventViewSchema = z.object({
  id: z.string(),
  kind: z.string(),
  actor: z.object({ userId: z.string(), displayName: z.string() }).nullable(),
  subjectId: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

export const activityPageSchema = z.object({
  events: z.array(activityEventViewSchema),
  nextCursor: z.string().nullable(),
});

export const searchResultsSchema = z.object({
  members: z.array(
    z.object({
      userId: z.string(),
      displayName: z.string(),
      role: z.enum(['owner', 'manager', 'staff']),
    }),
  ),
  shifts: z.array(shiftViewSchema),
  activity: z.array(activityEventViewSchema),
});

export type CalendarResponse = z.infer<typeof calendarResponseSchema>;
export type ShiftDetailPayload = z.infer<typeof shiftDetailViewSchema>;
export type ActivityEventPayload = z.infer<typeof activityEventViewSchema>;
export type ActivityPagePayload = z.infer<typeof activityPageSchema>;
export type SearchResultsPayload = z.infer<typeof searchResultsSchema>;
