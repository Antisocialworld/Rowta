// Request ID: accepted when safe, regenerated when not, echoed in the header and in every error
// body (skill rowta-server-foundation-recipes section 3, rule S9).
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createErrorHandler, createNotFoundHandler, HttpError } from '../src/middleware/error.ts';
import { requestIdMiddleware } from '../src/middleware/request-id.ts';
import { logger } from '../src/lib/logger.ts';

// A minimal app wired exactly like createApp's request-ID + error layers, so the test does not
// need Redis just to check header behaviour.
function tinyApp(): Hono {
  const app = new Hono();
  app.use('*', requestIdMiddleware);
  app.get('/ok', (c) => c.json({ data: { requestId: c.get('requestId') } }));
  app.get('/boom', () => {
    throw new HttpError(409, 'conflict.example', 'That conflicts with something already saved.');
  });
  app.get('/unknown-boom', () => {
    throw new Error('internal detail that must not leak');
  });
  app.onError(createErrorHandler(logger.child({ test: 'request-id' })));
  app.notFound(createNotFoundHandler());
  return app;
}

async function request(app: Hono, path: string, headers: Record<string, string> = {}) {
  const res = await app.request(path, { headers });
  const body = (await res.json()) as Record<string, unknown>;
  return { res, body };
}

describe('request id', () => {
  it('generates an id when the inbound header is absent', async () => {
    const { res, body } = await request(tinyApp(), '/ok');
    const header = res.headers.get('x-request-id');
    expect(header).toMatch(/^[0-9a-f-]{36}$/);
    expect((body.data as { requestId: string }).requestId).toBe(header);
  });

  it('accepts a safe inbound id', async () => {
    const { res, body } = await request(tinyApp(), '/ok', { 'x-request-id': 'req-ABC_123' });
    expect(res.headers.get('x-request-id')).toBe('req-ABC_123');
    expect((body.data as { requestId: string }).requestId).toBe('req-ABC_123');
  });

  it('regenerates when the inbound id contains unsafe characters', async () => {
    const { res } = await request(tinyApp(), '/ok', { 'x-request-id': 'bad id with spaces' });
    expect(res.headers.get('x-request-id')).not.toBe('bad id with spaces');
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('regenerates when the inbound id is too long', async () => {
    const long = 'a'.repeat(200);
    const { res } = await request(tinyApp(), '/ok', { 'x-request-id': long });
    expect(res.headers.get('x-request-id')).not.toBe(long);
  });

  it('includes the request id in an HttpError body', async () => {
    const { res, body } = await request(tinyApp(), '/boom', { 'x-request-id': 'trace-me-1' });
    expect(res.status).toBe(409);
    expect(body).toEqual({
      error: { code: 'conflict.example', message: 'That conflicts with something already saved.', requestId: 'trace-me-1' },
    });
  });

  it('never leaks an internal message from an unknown error', async () => {
    const { res, body } = await request(tinyApp(), '/unknown-boom', { 'x-request-id': 'trace-me-2' });
    expect(res.status).toBe(500);
    expect(body).toEqual({
      error: { code: 'generic.error', message: 'Something went wrong. Try again.', requestId: 'trace-me-2' },
    });
    expect(JSON.stringify(body)).not.toContain('internal detail');
  });

  it('returns the 404 envelope with a request id', async () => {
    const { res, body } = await request(tinyApp(), '/nope', { 'x-request-id': 'trace-me-3' });
    expect(res.status).toBe(404);
    const error = (body as { error: { code: string; requestId: string } }).error;
    expect(error.code).toBe('not.found');
    expect(error.requestId).toBe('trace-me-3');
  });
});
