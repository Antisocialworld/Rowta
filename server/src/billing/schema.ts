// Billing Zod schemas (Task 5).
// Shared validation for checkout, plan change, seats change, cancel, and status.
import { z } from 'zod';

export type PlanId = 'starter' | 'team' | 'business';

export const billingPlanSchema = z.enum(['starter', 'team', 'business']);

export const billingIntervalSchema = z.enum(['month', 'year']);

export const startCheckoutSchema = z.object({
  plan: billingPlanSchema,
  seats: z.coerce.number().int().min(1),
  interval: billingIntervalSchema.default('month'),
});

export const changePlanSchema = z.object({
  plan: billingPlanSchema,
});

export const changeSeatsSchema = z.object({
  seats: z.coerce.number().int().min(1),
});

export const cancelSchema = z.object({
  // Confirmation string to avoid accidental cancel
  confirm: z.literal('cancel'),
});
