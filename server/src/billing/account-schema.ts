// Account-level billing Zod schemas (C4).
// Shared validation for quote, checkout, cancel at the account level.
// No prices are hard-coded here; prices come from plan_entitlements (db0).
import { z } from 'zod';

export type AccountAction = 'subscribe' | 'add_team' | 'add_people' | 'switch_interval';

export const accountActionSchema = z.enum(['subscribe', 'add_team', 'add_people', 'switch_interval']);

export const quoteSchema = z.object({
  action: accountActionSchema,
  plan: z.enum(['starter', 'team', 'business']).optional(), // legacy plan (not used for account-level, kept for compat)
  interval: z.enum(['monthly', 'yearly']).optional(),
  teamId: z.string().uuid().optional(), // team for add_team / add_people
  people: z.coerce.number().int().min(0).optional(), // total people for add_people
});

export const checkoutSchema = z.object({
  action: accountActionSchema,
  interval: z.enum(['monthly', 'yearly']).optional(),
  teamId: z.string().uuid().optional(),
  people: z.coerce.number().int().min(0).optional(),
});

export const cancelSchema = z.object({
  confirm: z.literal('cancel'),
});

export const verifyIntentSchema = z.object({
  txRef: z.string().min(1),
}).strict();
