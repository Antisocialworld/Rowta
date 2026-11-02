// Shared Zod schemas and types for user settings (PRD 7.1, 8.8; rules V1 to V4, S7, S14).
import { z } from 'zod';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const LANGUAGE_REGEX = /^[a-z]{2}(-[A-Z]{2})?$/;

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const userSettingsViewSchema = z.object({
  quietStart: z.string().regex(TIME_REGEX).nullable(),
  quietEnd: z.string().regex(TIME_REGEX).nullable(),
  timeZone: z.string().min(1).max(64),
  notifyShiftChanges: z.boolean(),
  notifySwaps: z.boolean(),
  notifyBilling: z.boolean(),
  language: z.string().regex(LANGUAGE_REGEX),
  theme: z.enum(THEMES),
  updatedAt: z.string().nullable(),
});

export type UserSettingsView = z.infer<typeof userSettingsViewSchema>;

export const DEFAULT_USER_SETTINGS: UserSettingsView = {
  quietStart: null,
  quietEnd: null,
  timeZone: 'UTC',
  notifyShiftChanges: true,
  notifySwaps: true,
  notifyBilling: true,
  language: 'en',
  theme: 'system',
  updatedAt: null,
};

export const updateSettingsSchema = z
  .object({
    quietStart: z
      .string()
      .regex(TIME_REGEX, { message: 'settings.quiet_invalid' })
      .nullable()
      .optional(),
    quietEnd: z
      .string()
      .regex(TIME_REGEX, { message: 'settings.quiet_invalid' })
      .nullable()
      .optional(),
    timeZone: z
      .string()
      .trim()
      .min(1, { message: 'settings.time_zone_invalid' })
      .max(64, { message: 'settings.time_zone_invalid' })
      .optional(),
    notifyShiftChanges: z.boolean().optional(),
    notifySwaps: z.boolean().optional(),
    notifyBilling: z.boolean().optional(),
    language: z
      .string()
      .regex(LANGUAGE_REGEX, { message: 'settings.language_invalid' })
      .optional(),
    theme: z.enum(THEMES, { message: 'settings.theme_invalid' }).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    // 1. A request with NO fields is invalid
    const keys = Object.keys(data);
    if (keys.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['form'],
        message: 'settings.empty',
      });
      return;
    }

    // 2. quietStart and quietEnd must be present together
    const hasStart = data.quietStart !== undefined;
    const hasEnd = data.quietEnd !== undefined;

    if (hasStart !== hasEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasStart ? 'quietEnd' : 'quietStart'],
        message: 'settings.quiet_pair',
      });
      return;
    }

    if (hasStart && hasEnd) {
      const isStartNull = data.quietStart === null;
      const isEndNull = data.quietEnd === null;

      if (isStartNull !== isEndNull) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['quietEnd'],
          message: 'settings.quiet_pair',
        });
        return;
      }

      if (!isStartNull && !isEndNull && data.quietStart === data.quietEnd) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['quietEnd'],
          message: 'settings.quiet_equal',
        });
      }
    }
  });

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

