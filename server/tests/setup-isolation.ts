// Vitest setup (stage 4, 28 Oct 2026): the FIRST thing every test worker does. It points the whole
// suite at throwaway TEST databases and a separate Redis keyspace BEFORE any module can import
// env.ts / clients.ts, and REFUSES to run when the targets do not clearly look like test targets.
//
// Loading order that makes this work:
//   1. this file runs (vitest setupFiles) before any test file's imports;
//   2. it loads the root .env if needed (same loadEnvFile call env.ts would make; existing
//      process.env values are never overwritten by loadEnvFile);
//   3. it resolves the TEST_* targets: explicit TEST_DB0_WRITE_URL / TEST_DB1_WRITE_URL /
//      TEST_REDIS_URL (or server/.env.test) win; otherwise the suite DERIVES them from the dev URLs
//      (database name + `_test`, Redis index 15);
//   4. it validates the guard (local hosts, `_test` names, different Redis keyspace) and refuses
//      with a clear message when anything points at the dev databases or Redis;
//   5. it overrides process.env.DB0_WRITE_URL / DB1_WRITE_URL / REDIS_URL so env.ts parses the
//      test values when the first test file imports it. Values are NEVER printed.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveTestTargets, validateTestTargets } from './helpers/test-isolation.ts';

const here = dirname(fileURLToPath(import.meta.url));
// server/tests -> server -> repo root (two levels up).
const repoRoot = resolve(here, '..', '..');

if (!process.env.DB0_WRITE_URL) {
  try {
    process.loadEnvFile(resolve(repoRoot, '.env'));
  } catch {
    // no .env: the guard below reports which names are missing
  }
}
if (!process.env.TEST_DB0_WRITE_URL || !process.env.TEST_DB1_WRITE_URL || !process.env.TEST_REDIS_URL) {
  const testEnvFile = resolve(here, '..', '.env.test');
  if (!process.env.TEST_DB0_WRITE_URL) {
    try {
      process.loadEnvFile(testEnvFile);
    } catch {
      // explicit Mode A stays available through the shell; Mode B derives when nothing is set
    }
  }
}

const explicit =
  process.env.TEST_DB0_WRITE_URL !== undefined &&
  process.env.TEST_DB1_WRITE_URL !== undefined &&
  process.env.TEST_REDIS_URL !== undefined;

const dev = {
  db0Write: process.env.DB0_WRITE_URL ?? '',
  db1Write: process.env.DB1_WRITE_URL ?? '',
  redisUrl: process.env.REDIS_URL ?? '',
};

const targets = explicit
  ? {
      db0Write: process.env.TEST_DB0_WRITE_URL ?? '',
      db1Write: process.env.TEST_DB1_WRITE_URL ?? '',
      redisUrl: process.env.TEST_REDIS_URL ?? '',
    }
  : deriveTestTargets(dev);

const devDb0Name = dev.db0Write.replace(/\/+$/, '').split('/').pop() ?? '';
const devDb1Name = dev.db1Write.replace(/\/+$/, '').split('/').pop() ?? '';

const verdict = validateTestTargets({
  db0Write: targets.db0Write,
  db1Write: targets.db1Write,
  redisUrl: targets.redisUrl,
  devDb0Name,
  devDb1Name,
  devRedisUrl: dev.redisUrl,
});

if (!verdict.ok) {
  throw new Error(
    `TEST ISOLATION REFUSED: ${verdict.reason} ` +
      'The server suite must never touch the dev databases or the dev Redis keyspace (stage 4). ' +
      'Create the test databases once with: node scripts/db-create-test-databases.mjs ' +
      'and either set TEST_DB0_WRITE_URL / TEST_DB1_WRITE_URL / TEST_REDIS_URL ' +
      '(see server/.env.test.example) or leave them unset to derive <name>_test databases and Redis index 15.',
  );
}

// Redirect the whole suite BEFORE env.ts is first imported. Values are never logged (S1).
process.env.DB0_WRITE_URL = verdict.targets.db0Write;
process.env.DB1_WRITE_URL = verdict.targets.db1Write;
process.env.REDIS_URL = verdict.targets.redisUrl;
// Use the dev simulator in all automated tests regardless of .env (PRD 8.6, Task H17).
// Prevents slow external Flutterwave network calls and ensures simulator round-trips succeed.
process.env.PAYMENT_SIMULATOR_ENABLED = 'true';
