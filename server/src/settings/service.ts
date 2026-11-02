// Settings service (PRD 7.1, 8.8; rules S7, C9, V1).
// Zero logging of values or settings content; routes all DB access through globalDb() (data-access layering).
import { globalDb } from '../db/clients.ts';
import { HttpError } from '../middleware/error.ts';
import { isValidTimeZone } from '../notifications/quiet-hours.ts';
import {
  DEFAULT_USER_SETTINGS,
  type UpdateSettingsInput,
  type UserSettingsView,
} from '@rowta/shared';

/**
 * Converts a database Date (or time string) representing a PostgreSQL time column to 'HH:MM'.
 */
export function formatTimeFromDb(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    const hours = String(value.getUTCHours()).padStart(2, '0');
    const minutes = String(value.getUTCMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }
  if (typeof value === 'string') {
    if (/^\d{2}:\d{2}/.test(value)) {
      return value.slice(0, 5);
    }
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      const hours = String(d.getUTCHours()).padStart(2, '0');
      const minutes = String(d.getUTCMinutes()).padStart(2, '0');
      return `${hours}:${minutes}`;
    }
  }
  return null;
}

/**
 * Converts a 24-hour 'HH:MM' string to a Date object anchored at 1970-01-01 UTC for Prisma @db.Time(6).
 */
export function parseTimeToDb(value: string | null): Date | null {
  if (value === null) return null;
  return new Date(`1970-01-01T${value}:00.000Z`);
}

function toView(row: {
  quiet_start: Date | string | null;
  quiet_end: Date | string | null;
  time_zone: string;
  notify_shift_changes: boolean;
  notify_swaps: boolean;
  notify_billing: boolean;
  language: string;
  theme: string;
  updated_at: Date | string | null;
}): UserSettingsView {
  return {
    quietStart: formatTimeFromDb(row.quiet_start),
    quietEnd: formatTimeFromDb(row.quiet_end),
    timeZone: row.time_zone,
    notifyShiftChanges: row.notify_shift_changes,
    notifySwaps: row.notify_swaps,
    notifyBilling: row.notify_billing,
    language: row.language,
    theme: row.theme as 'system' | 'light' | 'dark',
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : (row.updated_at ?? null),
  };
}

/**
 * Reads settings for the signed-in user.
 * If no row exists, returns defaults without creating a row in the database.
 */
export async function getSettings(userId: string): Promise<UserSettingsView> {
  const db = globalDb();
  const row = await db.user_settings.findUnique({
    where: { user_id: userId },
  });
  if (!row) {
    return DEFAULT_USER_SETTINGS;
  }
  return toView(row);
}

/**
 * Updates or creates settings for the signed-in user in one atomic statement (upsert).
 * Unsent fields retain their stored value (or DB defaults upon initial insert).
 */
export async function updateSettings(
  userId: string,
  input: UpdateSettingsInput,
): Promise<UserSettingsView> {
  if (input.timeZone !== undefined && !isValidTimeZone(input.timeZone)) {
    throw new HttpError(422, 'validation.invalid', 'Validation failed.', undefined, {
      timeZone: 'settings.time_zone_invalid',
    });
  }

  const db = globalDb();

  const dataFields: {
    quiet_start?: Date | null;
    quiet_end?: Date | null;
    time_zone?: string;
    notify_shift_changes?: boolean;
    notify_swaps?: boolean;
    notify_billing?: boolean;
    language?: string;
    theme?: string;
  } = {};

  if (input.quietStart !== undefined) dataFields.quiet_start = parseTimeToDb(input.quietStart);
  if (input.quietEnd !== undefined) dataFields.quiet_end = parseTimeToDb(input.quietEnd);
  if (input.timeZone !== undefined) dataFields.time_zone = input.timeZone;
  if (input.notifyShiftChanges !== undefined) dataFields.notify_shift_changes = input.notifyShiftChanges;
  if (input.notifySwaps !== undefined) dataFields.notify_swaps = input.notifySwaps;
  if (input.notifyBilling !== undefined) dataFields.notify_billing = input.notifyBilling;
  if (input.language !== undefined) dataFields.language = input.language;
  if (input.theme !== undefined) dataFields.theme = input.theme;

  const row = await db.user_settings.upsert({
    where: { user_id: userId },
    create: {
      user_id: userId,
      ...dataFields,
    },
    update: dataFields,
  });

  return toView(row);
}

