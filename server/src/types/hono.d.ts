// Hono type augmentation for variables this codebase sets on the context.
// `requestId` is already declared by hono/request-id's own augmentation; `userId` is set by the
// authentication middleware and `parsedBody` by the shared body-parse step of the route helper
// (Phase 2). Declaring them here keeps src/index.ts's request log typed without reaching for a cast.
import 'hono';

declare module 'hono' {
  interface ContextVariableMap {
    userId: string | undefined;
    parsedBody: unknown;
  }
}
