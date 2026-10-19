// Error envelope and the ONE error handler (skill rowta-server-foundation-recipes section 4,
// PRD 9.3, S10, V3, V5).
//
// Errors are { "error": { "code", "message", "requestId" } }. Success is { "data", "meta" }.
// No stack trace, SQL, file path or library name ever leaves the server: unknown errors become
// generic.error and the real cause is logged server-side only.
//
// Status map used here and by later phases: 400 malformed, 401 not authenticated, 403 not allowed,
// 404 for cross-team resources and unknown paths, 409 conflict, 413 body too large, 422 validation,
// 429 rate limited with Retry-After, 504 timeout.
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { logger, type AppLogger } from '../lib/logger.ts';

export interface ErrorBody {
  error: { code: string; message: string; requestId: string };
}

export interface SuccessBody<T> {
  data: T;
  meta?: Record<string, unknown>;
}

/** An error a handler can throw with a known status and a catalog code. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function ok<T>(data: T, meta?: Record<string, unknown>): SuccessBody<T> {
  return meta === undefined ? { data } : { data, meta };
}

export function errorBody(code: string, message: string, requestId: string): ErrorBody {
  return { error: { code, message, requestId } };
}

function requestIdOf(c: Context): string {
  const id = c.get('requestId');
  return typeof id === 'string' && id.length > 0 ? id : 'unknown';
}

/** Map an HTTPException status onto a stable catalog code. Later phases add 401/403/422/429. */
function codeForStatus(status: number): string {
  switch (status) {
    case 404:
      return 'not.found';
    case 413:
      return 'request.too_large';
    case 504:
      return 'request.timeout';
    default:
      return 'generic.error';
  }
}

/**
 * The single error handler. Registered with app.onError; nothing else may format an error body.
 * HttpError and HTTPException keep their status; everything else becomes generic.error (500) with
 * the real cause logged server-side only.
 */
export function createErrorHandler(log: AppLogger = logger) {
  return (err: unknown, c: Context): Response => {
    const requestId = requestIdOf(c);

    if (err instanceof HttpError) {
      log.warn({ requestId, code: err.code, status: err.status }, 'request failed');
      return c.json(errorBody(err.code, err.message, requestId), err.status as never);
    }

    // Hono's timeout middleware throws HTTPException(504) and body-limit throws HTTPException(413);
    // both land here and get their own codes via codeForStatus.
    if (err instanceof HTTPException) {
      const code = codeForStatus(err.status);
      log.warn({ requestId, status: err.status, code }, 'http exception');
      return c.json(errorBody(code, err.message, requestId), err.status as never);
    }

    // Unknown: log everything server-side, tell the client nothing but generic.error (S10).
    log.error({ requestId, err }, 'unhandled error');
    return c.json(errorBody('generic.error', 'Something went wrong. Try again.', requestId), 500 as never);
  };
}

export function createNotFoundHandler() {
  return (c: Context): Response => c.json(errorBody('not.found', 'Not found.', requestIdOf(c)), 404 as never);
}
