// Dev-only localhost CORS allow-list (Phase 2 app views; rules S11, P7).
//
// Proves: (1) the pure predicate allows only http://localhost / 127.0.0.1 / [::1] with an
// optional port, and NEVER when NODE_ENV=production; (2) through the real app, a localhost
// preview origin gets Access-Control-Allow-Origin WITHOUT Access-Control-Allow-Credentials
// and without a wildcard; (3) a preflight from a localhost origin is answered 204 with the
// method/header list; (4) a non-localhost origin gets NO CORS headers from the dev branch;
// (5) an env-allow-listed origin keeps the configured credentials behaviour.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { env } from '../src/config/env.ts';
import { createApp, isDevPreviewOrigin } from '../src/index.ts';
import { logger } from '../src/lib/logger.ts';

let app: Hono;

beforeAll(() => {
  app = createApp({ log: logger.child({ test: 'cors-dev' }), redis: { ping: () => Promise.resolve('PONG') } });
});

describe('isDevPreviewOrigin (pure predicate)', () => {
  it('accepts localhost, 127.0.0.1 and [::1] with any port outside production', () => {
    expect(isDevPreviewOrigin('http://localhost:8082', 'development')).toBe(true);
    expect(isDevPreviewOrigin('http://localhost:5173', 'test')).toBe(true);
    expect(isDevPreviewOrigin('http://127.0.0.1:3000', 'development')).toBe(true);
    expect(isDevPreviewOrigin('http://[::1]:8082', 'development')).toBe(true);
    expect(isDevPreviewOrigin('http://localhost', 'development')).toBe(true);
  });

  it('rejects https, other hosts and production', () => {
    expect(isDevPreviewOrigin('https://localhost:8082', 'development')).toBe(false);
    expect(isDevPreviewOrigin('http://localhost.evil.example', 'development')).toBe(false);
    expect(isDevPreviewOrigin('http://127.0.0.2:8082', 'development')).toBe(false);
    expect(isDevPreviewOrigin('https://rowta.example', 'development')).toBe(false);
    expect(isDevPreviewOrigin('http://localhost:8082', 'production')).toBe(false);
    expect(isDevPreviewOrigin('*', 'development')).toBe(false);
  });
});

describe('dev preview CORS through the real app', () => {
  it('allows a localhost origin WITHOUT credentials and without a wildcard', async () => {
    const res = await app.request('/health/deep', {
      method: 'GET',
      headers: { origin: 'http://localhost:8082' },
    });
    // The route itself answers (deep health may be 200 or 503 depending on deps; CORS headers are what matter).
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:8082');
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
  });

  it('answers a preflight with the method and header list, still no credentials', async () => {
    const res = await app.request('/auth/signin', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://127.0.0.1:8082',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:8082');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-headers')).toContain('authorization');
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('a non-localhost origin not in the allow-list gets NO dev CORS headers', async () => {
    const res = await app.request('/health/deep', {
      method: 'GET',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('an env-allow-listed origin keeps the configured credentials behaviour', async () => {
    const listed = env.CORS_ALLOWED_ORIGINS.split(',')
      .map((o) => o.trim())
      .find((o) => o.startsWith('http'));
    expect(listed).toBeTruthy();
    const res = await app.request('/health/deep', {
      method: 'GET',
      headers: { origin: listed as string },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe(listed);
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });
});
