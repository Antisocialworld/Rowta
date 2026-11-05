// Request-ID middleware (skill rowta-server-foundation-recipes section 3, rule S9).
//
// Wraps Hono's built-in requestId middleware (verified against the installed hono@4.13.13 source:
// it accepts an inbound X-Request-Id only when it is non-empty, within limitLength, and contains
// only word characters, '-' or '='; anything else is replaced by the generator). We tighten the
// limit to 64 and generate with node:crypto. Importing this module also augments Hono's
// ContextVariableMap with `requestId`, so c.get('requestId') is typed as string everywhere.
import { randomUUID } from 'node:crypto';
import { requestId, type RequestIdVariables } from 'hono/request-id';

export const REQUEST_ID_HEADER = 'x-request-id';

export type { RequestIdVariables };

export const requestIdMiddleware = requestId({
  limitLength: 64,
  headerName: REQUEST_ID_HEADER,
  generator: () => randomUUID(),
});
