#!/usr/bin/env node
// scripts/db-create-test-databases.mjs -- create the throwaway TEST databases for the server suite
// (stage 4 test isolation, 28 Oct 2026): rowta_db0_test and rowta_db1_test on the SAME local
// containers, then apply the same SQL baseline (000-common, 010-global for db0, 020-team,
// 030-app-role) to each. Idempotent and additive: it creates missing databases and skips already
// applied SQL files; it NEVER connects to the dev databases except to read their NAMES, and it
// never drops, truncates or deletes anything (no --drop flag exists on purpose).
//
// Rules honoured here: S1 (child output masked; passwords never on a command line — psql runs
// inside the container over the local socket, 030-app-role reads DB_APP_USER/DB_APP_PASSWORD via
// \getenv with `-e NAME`), S2 (.env loaded, never printed), D8 (SQL files are the source of truth).
//
// Run once per machine:  node scripts/db-create-test-databases.mjs
// Check only:            node scripts/db-create-test-databases.mjs --check

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL_DIR = path.join(ROOT, 'server', 'prisma', 'sql');
const CHECK_ONLY = process.argv.includes('--check');

for (const arg of process.argv.slice(2)) {
  if (arg !== '--check') {
    console.error(`db-create-test-databases: unknown flag "${arg}". Known: --check`);
    process.exit(2);
  }
}

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!existsSync(file)) {
    console.error('db-create-test-databases: .env is missing. Run: node scripts/setup-env.mjs');
    process.exit(2);
  }
  const text = readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const SECRET_VALUES = ['DB0_PASSWORD', 'DB1_PASSWORD', 'DB_APP_PASSWORD', 'REDIS_PASSWORD', 'JWT_ACCESS_SECRET']
  .map((k) => process.env[k])
  .filter((v) => typeof v === 'string' && v.length >= 4);

function mask(text) {
  if (text == null) return '';
  let out = String(text);
  for (const secret of SECRET_VALUES) {
    while (out.includes(secret)) out = out.replace(secret, '******');
  }
  out = out.replace(/\b((?:postgres|postgresql|redis):\/\/)[^\s@'"]+@[^\s'"]*/gi, '$1******@******');
  out = out.replace(/\b(password|PGPASSWORD|secret|token)\s*=\s*\S+/gi, '$1=******');
  return out;
}
const say = (msg) => console.log(mask(msg));

const REQUIRED = ['DB0_NAME', 'DB0_USER', 'DB1_NAME', 'DB1_USER', 'DB_APP_USER', 'DB_APP_PASSWORD'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  say(`missing environment names: ${missing.join(', ')}. Run: node scripts/setup-env.mjs`);
  process.exit(2);
}

function exec(file, args, options = {}) {
  const res = spawnSync(file, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
    ...options,
  });
  return {
    code: res.status ?? 1,
    stdout: mask(res.stdout || ''),
    stderr: mask(res.stderr || ''),
    err: res.error ? mask(res.error.message) : '',
  };
}

function psql(service, database, sqlArgs, extraExecEnvArgs, input) {
  return exec(
    'docker',
    ['compose', 'exec', '-T', ...extraExecEnvArgs, service, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'rowta', '-d', database, ...sqlArgs],
    { input },
  );
}

// The names never contain anything secret: they are `<dev name>_test`.
const TARGETS = [
  {
    key: 'TEST_DB0',
    service: 'db0',
    devName: process.env.DB0_NAME,
    testName: `${process.env.DB0_NAME}_test`,
    files: ['000-common.sql', '010-global.sql', '020-team.sql', '030-app-role.sql'],
  },
  {
    key: 'TEST_DB1',
    service: 'db1',
    devName: process.env.DB1_NAME,
    testName: `${process.env.DB1_NAME}_test`,
    files: ['000-common.sql', '020-team.sql', '030-app-role.sql'],
  },
];

for (const test of TARGETS) {
  if (!/^[a-z0-9_]+$/.test(test.testName) || !test.testName.endsWith('_test')) {
    say(`${test.key}: refusing — derived test database name is not a clearly marked test name: ${test.testName}`);
    process.exit(2);
  }
}

const SKIPPABLE = new Set(['000-common.sql', '010-global.sql', '020-team.sql']);

let failures = 0;
say(`db-create-test-databases ${CHECK_ONLY ? '(--check: report only)' : '(creating + applying baseline)'}`);

for (const target of TARGETS) {
  say(`\n=== ${target.key} (service "${target.service}", database "${target.testName}") ===`);

  // 1. Does the test database exist? (READ against the 'postgres' maintenance database only.)
  const exists = psql(target.service, 'postgres', ['-Atc', `SELECT 1 FROM pg_database WHERE datname = '${target.testName}'`], [], undefined);
  if (exists.code !== 0) {
    say(`[${target.key}] cannot check pg_database. Masked output:`);
    say(exists.stdout);
    say(exists.stderr || exists.err);
    process.exit(1);
  }
  const present = (exists.stdout || '').trim() === '1';
  say(`[${target.key}] database "${target.testName}" ${present ? 'exists' : 'does not exist yet'}`);

  if (!present) {
    if (CHECK_ONLY) {
      say(`[${target.key}] would CREATE DATABASE ${target.testName}`);
      continue;
    }
    const created = psql(target.service, 'postgres', ['-c', `CREATE DATABASE ${target.testName}`], [], undefined);
    if (created.code !== 0) {
      say(`[${target.key}] FAILED CREATE DATABASE (exit ${created.code})`);
      say(created.stderr || created.err);
      process.exit(1);
    }
    say(`[${target.key}] created database ${target.testName} (exit 0)`);
  }

  // 2. Baseline probe inside the TEST database (public.teams exists?).
  const probe = psql(target.service, target.testName, ['-Atc', `SELECT to_regclass('public.teams') IS NOT NULL`], [], undefined);
  if (probe.code !== 0) {
    say(`[${target.key}] cannot probe the test database. Masked output:`);
    say(probe.stdout);
    say(probe.stderr || probe.err);
    process.exit(1);
  }
  const baselinePresent = (probe.stdout || '').trim() === 't';
  say(`[${target.key}] baseline probe: public.teams ${baselinePresent ? 'exists' : 'does not exist yet'}`);

  // 3. Apply the SQL files (skip 000/010/020 when the baseline is already applied; 030 always re-runs).
  for (const file of target.files) {
    const full = path.join(SQL_DIR, file);
    if (!existsSync(full)) {
      say(`[${target.key}] STOP: missing file ${path.relative(ROOT, full).replace(/\\/g, '/')}`);
      process.exit(1);
    }
    if (SKIPPABLE.has(file) && baselinePresent) {
      say(`[${target.key}] skip    ${file} (already applied: public.teams exists)`);
      continue;
    }
    if (CHECK_ONLY) {
      say(`[${target.key}] would apply ${file}`);
      continue;
    }
    const sql = readFileSync(full, 'utf8');
    const execEnvArgs = file === '030-app-role.sql' ? ['-e', 'DB_APP_USER', '-e', 'DB_APP_PASSWORD'] : [];
    const res = psql(target.service, target.testName, [], execEnvArgs, sql);
    if (res.code !== 0) {
      say(`[${target.key}] FAILED ${file} (exit ${res.code})`);
      for (const line of `${res.stdout}\n${res.stderr}`.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(NOTICE|WARNING|ERROR|FATAL|psql:)/i.test(l))) {
        say(`    ${line}`);
      }
      process.exit(1);
    }
    const tags = String(res.stdout).split(/\r?\n/).filter((l) => /^(CREATE|ALTER|DROP|DO|GRANT|REVOKE|SET|COMMENT|UPDATE|INSERT|DELETE|TRUNCATE|SELECT)\b/.test(l.trim())).length;
    say(`[${target.key}] applied ${file} (exit 0, ${tags} statement tags)`);
  }
}

say('');
say(CHECK_ONLY ? 'db-create-test-databases --check: done. Nothing was changed.' : 'db-create-test-databases: done. The test databases are ready.');
say('The suite will use these automatically (derived Mode B); no .env edit is needed.');
process.exit(failures === 0 ? 0 : 1);
