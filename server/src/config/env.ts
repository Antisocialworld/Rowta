// Env module — the ONLY place that reads process.env (skill rowta-server-foundation-recipes section 1).
//
// Fail-fast: every missing or malformed variable is reported by NAME, never by value (S1, S2).
// A test (tests/env-parity.test.ts) asserts that the schema keys and the names in .env.example are
// the same set, so the two can never drift apart.
//
// Boot guard (P7): if PAYMENT_SIMULATOR_ENABLED is true while NODE_ENV is production the process
// must not start. `loadEnv()` enforces that; the standalone `assertNotProductionSimulator()` is
// exported so tests and scripts can check it without booting the whole app.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
// server/src/config -> server/src -> server -> repo root (three levels up).
const repoRoot = resolve(here, '..', '..', '..');

// A program loads .env into this process; nothing is ever printed (S2).
try {
  process.loadEnvFile(resolve(repoRoot, '.env'));
} catch {
  // No .env yet: the schema below reports the missing NAMES and the process stops.
}

const boolish = (defaultValue: boolean) =>
  z
    .enum(['true', 'false'])
    .default(defaultValue ? 'true' : 'false')
    .transform((v) => v === 'true');

const intIn = (min: number, max: number, defaultValue: number) =>
  z.coerce.number().int().min(min).max(max).default(defaultValue);

const nonEmpty = z.string().min(1, 'must not be empty');

// Shape check only: the value itself is never echoed back in an error message.
const postgresUrl = nonEmpty.refine(
  (v) => v.startsWith('postgres://') || v.startsWith('postgresql://'),
  'must be a postgres:// or postgresql:// URL',
);

const EnvObject = z.object({
  // ---- General ---------------------------------------------------------------------------------
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  API_PORT: intIn(1, 65535, 3000),
  // No wildcard allowed anywhere (S11).
  CORS_ALLOWED_ORIGINS: z
    .string()
    .min(1)
    .refine((v) => !v.split(',').some((part) => part.trim() === '*'), 'must not contain a wildcard origin')
    .refine(
      (v) => v.split(',').every((part) => {
        const p = part.trim();
        return p === '' || p.startsWith('http://') || p.startsWith('https://');
      }),
      'must be a comma-separated list of http(s) origins',
    ),
  PUBLIC_WEB_URL: z.string().min(1),

  // ---- Feature switches and limits (not secrets) -----------------------------------------------
  CACHE_ENABLED: boolish(true),
  CRON_ENABLED: boolish(true),
  MAX_SEATS_CEILING: intIn(1, 100_000, 200),
  ARGON2_MAX_CONCURRENCY: intIn(1, 64, 2),
  TRUST_PROXY_HOPS: intIn(0, 10, 0),

  // ---- Databases (two PostgreSQL databases for the sharding simulation) -------------------------
  DB0_NAME: nonEmpty,
  DB0_USER: nonEmpty,
  DB0_PORT: intIn(1, 65535, 5442),
  DB0_PASSWORD: nonEmpty,
  DB1_NAME: nonEmpty,
  DB1_USER: nonEmpty,
  DB1_PORT: intIn(1, 65535, 5443),
  DB1_PASSWORD: nonEmpty,
  DB_APP_USER: nonEmpty,
  DB_APP_PASSWORD: nonEmpty,
  DB0_ADMIN_URL: postgresUrl,
  DB1_ADMIN_URL: postgresUrl,
  DB0_WRITE_URL: postgresUrl,
  DB0_READ_URL: postgresUrl,
  DB1_WRITE_URL: postgresUrl,
  DB1_READ_URL: postgresUrl,

  // ---- Redis (rate limits, locks, cache, BullMQ) -----------------------------------------------
  REDIS_PORT: intIn(1, 65535, 6390),
  REDIS_PASSWORD: nonEmpty,
  REDIS_URL: nonEmpty,

  // ---- Token signing ---------------------------------------------------------------------------
  // At least 64 characters; rule A4 asks for >= 64 random bytes of signing material.
  JWT_ACCESS_SECRET: z.string().min(64, 'must be at least 64 characters (rule A4)'),

  // ---- Email (nodemailer over SMTP; rule A13, PRD Q7) ------------------------------------------
  SMTP_HOST: nonEmpty,
  SMTP_PORT: intIn(1, 65535, 1025),
  SMTP_SECURE: boolish(false),
  MAILPIT_UI_PORT: intIn(1, 65535, 8025),
  MAIL_FROM: nonEmpty,
  // Login is only needed for a real SMTP server, so it stays optional here.
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),

  // ---- Payments (Flutterwave, test mode; PRD 8.6) ---------------------------------------------
  PAYMENT_PROVIDER: z.literal('flutterwave').default('flutterwave'),
  PAYMENT_MODE: z.enum(['test', 'live']).default('test'),
  FLW_PUBLIC_KEY: z.string().optional().default(''),
  FLW_SECRET_KEY: z.string().optional().default(''),
  FLW_ENCRYPTION_KEY: z.string().optional().default(''),
  FLW_WEBHOOK_SECRET_HASH: z.string().optional().default(''),
  PAYMENT_SIMULATOR_ENABLED: boolish(true),

  // ---- Push notifications ----------------------------------------------------------------------
  EXPO_ACCESS_TOKEN: z.string().optional().default(''),

  // ---- Error reporting -------------------------------------------------------------------------
  SENTRY_DSN_SERVER: z.string().optional().default(''),
  SENTRY_ENVIRONMENT: nonEmpty.default('development'),

  // ---- Values compiled into the app (PUBLIC by design; never a secret) -------------------------
  EXPO_PUBLIC_API_URL: nonEmpty,
  EXPO_PUBLIC_SENTRY_DSN: z.string().optional().default(''),
  EXPO_PUBLIC_EAS_PROJECT_ID: z.string().optional().default(''),
});

export type Env = z.infer<typeof EnvObject>;

/** Every variable name the schema knows about, sorted. The parity test compares this to .env.example. */
export const ENV_NAMES: readonly string[] = Object.keys(EnvObject.shape).sort();

const EnvSchema = EnvObject.superRefine((env, ctx) => {
  // Feature-gated groups: optional in general, required when their feature is live.
  if (env.PAYMENT_MODE === 'live') {
    for (const name of ['FLW_PUBLIC_KEY', 'FLW_SECRET_KEY', 'FLW_ENCRYPTION_KEY', 'FLW_WEBHOOK_SECRET_HASH'] as const) {
      if (env[name] === '') {
        ctx.addIssue({ code: 'custom', message: `is required when PAYMENT_MODE is "live"`, path: [name] });
      }
    }
  }
});

function formatIssue(issue: z.ZodError['issues'][number]): string {
  const name = String(issue.path[0] ?? '(root)');
  return `  - ${name}: ${issue.message}`;
}

/**
 * Parse a record against the schema WITHOUT caching and WITHOUT the boot guard.
 * Throws a message that names variables but never echoes their values (S1). Used by loadEnv and by tests.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(formatIssue);
    throw new Error(
      `Environment is not valid. Fix these variable NAMES in .env (values are never shown):\n${lines.join('\n')}\n` +
        'Create or repair .env with: node scripts/setup-env.mjs',
    );
  }
  return parsed.data;
}

let cached: Env | null = null;

/** Parse and cache the environment, then apply the P7 boot guard. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = parseEnv(source);
  assertNotProductionSimulator(parsed);
  cached = parsed;
  return cached;
}

/** Clear the cache. Tests only. */
export function resetEnvCache(): void {
  cached = null;
}

/**
 * Boot guard (P7): the dev-only payment simulator must never run against production.
 * Throws with NAMES only.
 */
export function assertNotProductionSimulator(env: Env): void {
  if (env.NODE_ENV === 'production' && env.PAYMENT_SIMULATOR_ENABLED) {
    throw new Error(
      'Refusing to boot: PAYMENT_SIMULATOR_ENABLED is true while NODE_ENV is production (rule P7). ' +
        'Set PAYMENT_SIMULATOR_ENABLED=false and provide real FLW_* test/live keys.',
    );
  }
}

// Fail fast at import time so `import './config/env.ts'` is enough to validate.
// The boot guard runs here too, so no entry point can forget it.
const envAtImport = loadEnv();
export const env: Env = envAtImport;
