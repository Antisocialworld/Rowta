// Env validation fails fast by NAME, never by value (S1, S2). The production simulator guard (P7)
// refuses to boot when PAYMENT_SIMULATOR_ENABLED is true in production.
import { describe, expect, it } from 'vitest';
import { assertNotProductionSimulator, parseEnv, type Env } from '../src/config/env.ts';

// A complete, obviously fake env. Never derived from the real .env (S2).
function completeEnv(): Record<string, string> {
  return {
    NODE_ENV: 'development',
    LOG_LEVEL: 'info',
    API_PORT: '3000',
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
    PUBLIC_WEB_URL: 'http://localhost:5173',
    CACHE_ENABLED: 'true',
    CRON_ENABLED: 'true',
    MAX_SEATS_CEILING: '200',
    ARGON2_MAX_CONCURRENCY: '2',
    TRUST_PROXY_HOPS: '0',
    DB0_NAME: 'rowta_db0',
    DB0_USER: 'rowta',
    DB0_PORT: '5442',
    DB0_PASSWORD: 'fake-db0-password',
    DB1_NAME: 'rowta_db1',
    DB1_USER: 'rowta',
    DB1_PORT: '5443',
    DB1_PASSWORD: 'fake-db1-password',
    DB_APP_USER: 'rowta_app',
    DB_APP_PASSWORD: 'fake-app-password',
    DB0_ADMIN_URL: 'postgresql://user:pass@localhost:5442/rowta_db0',
    DB1_ADMIN_URL: 'postgresql://user:pass@localhost:5443/rowta_db1',
    DB0_WRITE_URL: 'postgresql://user:pass@localhost:5442/rowta_db0',
    DB0_READ_URL: 'postgresql://user:pass@localhost:5442/rowta_db0',
    DB1_WRITE_URL: 'postgresql://user:pass@localhost:5443/rowta_db1',
    DB1_READ_URL: 'postgresql://user:pass@localhost:5443/rowta_db1',
    REDIS_PORT: '6390',
    REDIS_PASSWORD: 'fake-redis-password',
    REDIS_URL: 'redis://:pass@localhost:6390',
    JWT_ACCESS_SECRET: 'y'.repeat(64),
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    SMTP_SECURE: 'false',
    MAILPIT_UI_PORT: '8025',
    MAIL_FROM: 'Rowta <no-reply@example.test>',
    SMTP_USER: '',
    SMTP_PASSWORD: '',
    PAYMENT_PROVIDER: 'flutterwave',
    PAYMENT_MODE: 'test',
    FLW_PUBLIC_KEY: '',
    FLW_SECRET_KEY: '',
    FLW_ENCRYPTION_KEY: '',
    FLW_WEBHOOK_SECRET_HASH: '',
    PAYMENT_SIMULATOR_ENABLED: 'true',
    EXPO_ACCESS_TOKEN: '',
    SENTRY_DSN_SERVER: '',
    SENTRY_ENVIRONMENT: 'development',
    EXPO_PUBLIC_API_URL: 'http://10.0.2.2:3000',
    EXPO_PUBLIC_SENTRY_DSN: '',
    EXPO_PUBLIC_EAS_PROJECT_ID: '',
  };
}

function tryParse(overrides: Record<string, string | undefined>): { ok: true; value: Env } | { ok: false; error: Error } {
  try {
    return { ok: true, value: parseEnv({ ...completeEnv(), ...overrides }) };
  } catch (err) {
    return { ok: false, error: err as Error };
  }
}

describe('env validation', () => {
  it('accepts a complete valid env', () => {
    expect(tryParse({}).ok).toBe(true);
  });

  it('reports a missing variable by NAME and never by value', () => {
    const result = tryParse({ DB0_PASSWORD: undefined });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('DB0_PASSWORD');
    expect(result.error.message).not.toContain('fake-db1-password');
  });

  it('does not echo a malformed value in the error text', () => {
    const result = tryParse({ API_PORT: 'this-is-not-a-port-xyz' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('API_PORT');
    expect(result.error.message).not.toContain('this-is-not-a-port-xyz');
  });

  it('rejects a wildcard in CORS_ALLOWED_ORIGINS (S11)', () => {
    const result = tryParse({ CORS_ALLOWED_ORIGINS: 'http://localhost:5173,*' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('CORS_ALLOWED_ORIGINS');
  });

  it('rejects a JWT_ACCESS_SECRET shorter than 64 characters (A4)', () => {
    const result = tryParse({ JWT_ACCESS_SECRET: 'short' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('JWT_ACCESS_SECRET');
  });

  it('requires the FLW keys when PAYMENT_MODE is live', () => {
    const result = tryParse({ PAYMENT_MODE: 'live', FLW_SECRET_KEY: '' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('FLW_SECRET_KEY');
  });

  it('refuses to boot with the simulator on in production (P7)', () => {
    const parsed = parseEnv({ ...completeEnv(), NODE_ENV: 'production', PAYMENT_SIMULATOR_ENABLED: 'true' });
    expect(() => assertNotProductionSimulator(parsed)).toThrow(/PAYMENT_SIMULATOR_ENABLED/);
    expect(() => assertNotProductionSimulator(parsed)).toThrow(/production/);
  });
});
