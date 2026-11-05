// Shared HTTP envelope schemas (rules V1, V3, S5; PRD 9.3).
//
// The server answers EVERY endpoint with one of these two shapes ({ data, meta } on success,
// { error: { code, message, requestId, fields? } } on failure). They are written once here and
// imported by the app's API client, which safeParses every response with them — a body that does
// not match is rejected instead of reaching a screen (V1, S5). Error `message` text is server
// catalog text; the app maps the error CODE to its own catalog key and never renders raw text.
import { z } from 'zod';

/** Success envelope: `meta` carries extra context (code timers, etc.). */
export function successEnvelopeSchema<T extends z.ZodType>(data: T) {
  return z.strictObject({
    data,
    meta: z.record(z.string(), z.unknown()).optional(),
  });
}

export const errorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    code: z.string().min(1),
    message: z.string(),
    requestId: z.string(),
    // 422 only: per-field catalog codes (V3), never raw Zod text.
    fields: z.record(z.string(), z.string()).optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
