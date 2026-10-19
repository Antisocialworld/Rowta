#!/usr/bin/env node
// scripts/db-apply.mjs -- apply server/prisma/sql baseline to the two Docker PostgreSQL databases.
//
// Rules honoured here: S1 (never print a secret -- every line of child output is masked),
// S2 (loads .env into the child environment, never prints or edits it), P1 (no git), D8 (SQL files are the source
// of truth; Prisma migrations are NOT used).
//
// How it connects: psql runs INSIDE the container (the image ships psql 16) over the local socket as the container's
// owner user, so no password ever appears on a command line. `030-app-role.sql` reads DB_APP_USER / DB_APP_PASSWORD
// with psql's \getenv (PostgreSQL 15+, documented for 16), so the names are forwarded with `-e NAME` -- the value
// comes from this process's environment and never from argv, output or a file.
//
// Order:  DB0 = 000-common, 010-global, 020-team, 030-app-role
//         DB1 = 000-common, 020-team, 030-app-role
// Safe to re-run: 000/010/020 are skipped when public.teams already exists; 030 always re-runs (it is idempotent).
// Flags: --check  report only, changes nothing.
// No flag deletes, drops or resets anything.

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL_DIR = path.join(ROOT, 'server', 'prisma', 'sql');
const CHECK_ONLY = process.argv.includes('--check');
const KNOWN_FLAGS = new Set(['--check']);

for (const arg of process.argv.slice(2)) {
  if (!KNOWN_FLAGS.has(arg)) {
    console.error(`db-apply: unknown flag "${arg}". Known: --check`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------------------------
// .env: read into process.env only. Never printed, never edited, never echoed (S1, S2).
// ---------------------------------------------------------------------------------------------
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!existsSync(file)) {
    console.error('db-apply: .env is missing. Run: node scripts/setup-env.mjs');
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

// Values that must never reach the screen. Masked defensively on every line we print (S1).
const SECRET_VALUES = ['DB0_PASSWORD', 'DB1_PASSWORD', 'DB_APP_PASSWORD', 'REDIS_PASSWORD', 'JWT_ACCESS_SECRET']
  .map((k) => process.env[k])
  .filter((v) => typeof v === 'string' && v.length >= 4);

function mask(text) {
  if (text == null) return '';
  let out = String(text);
  for (const secret of SECRET_VALUES) {
    while (out.includes(secret)) out = out.replace(secret, '******');
  }
  // connection strings with credentials, whatever form they take
  out = out.replace(/\b((?:postgres|postgresql|redis):\/\/)[^\s@'"]+@[^\s'"]*/gi, '$1******@******');
  out = out.replace(/\b(password|PGPASSWORD|secret|token)\s*=\s*\S+/gi, '$1=******');
  return out;
}

function say(msg) {
  console.log(mask(msg));
}

const REQUIRED = [
  'DB0_NAME', 'DB0_USER', 'DB1_NAME', 'DB1_USER', 'DB_APP_USER', 'DB_APP_PASSWORD',
];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  say(`db-apply: missing environment names: ${missing.join(', ')}. Run: node scripts/setup-env.mjs`);
  process.exit(2);
}

// ---------------------------------------------------------------------------------------------
// Child process helpers
// ---------------------------------------------------------------------------------------------
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
    signal: res.signal,
    stdout: mask(res.stdout || ''),
    stderr: mask(res.stderr || ''),
    err: res.error ? mask(res.error.message) : '',
  };
}

function countTags(stdout) {
  // psql prints a command tag line (CREATE TABLE, ALTER TABLE, DO, GRANT, ...) per statement
  return String(stdout)
    .split(/\r?\n/)
    .filter((l) => /^(CREATE|ALTER|DROP|DO|GRANT|REVOKE|SET|COMMENT|UPDATE|INSERT|DELETE|TRUNCATE|SELECT)\b/.test(l.trim()))
    .length;
}

function interesting(stdout, stderr) {
  const lines = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^(NOTICE|WARNING|ERROR|FATAL|psql:)/i.test(l));
  return lines;
}

const DBS = [
  {
    key: 'DB0',
    service: 'db0',
    user: process.env.DB0_USER,
    database: process.env.DB0_NAME,
    files: ['000-common.sql', '010-global.sql', '020-team.sql', '030-app-role.sql'],
  },
  {
    key: 'DB1',
    service: 'db1',
    user: process.env.DB1_USER,
    database: process.env.DB1_NAME,
    files: ['000-common.sql', '020-team.sql', '030-app-role.sql'],
  },
];

const SKIPPABLE = new Set(['000-common.sql', '010-global.sql', '020-team.sql']);

function psql(db, sqlArgs, extraExecEnvArgs, input) {
  return exec('docker', [
    'compose', 'exec', '-T',
    ...extraExecEnvArgs,
    db.service,
    'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', db.user,
    '-d', db.database,
    ...sqlArgs,
  ], { input });
}

function probeBaseline(db) {
  const res = psql(db, ['-Atc', 'SELECT to_regclass(\'public.teams\') IS NOT NULL'], [], undefined);
  if (res.code !== 0) return { ok: false, res };
  const answer = (res.stdout || '').trim();
  if (answer !== 't' && answer !== 'f') return { ok: false, res };
  return { ok: true, present: answer === 't' };
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------
let failures = 0;

say(`db-apply ${CHECK_ONLY ? '(--check: report only, no changes)' : '(applying baseline)'}`);

for (const db of DBS) {
  say(`\n=== ${db.key} (container service "${db.service}", database "${db.database}", owner role "${db.user}") ===`);

  const probe = probeBaseline(db);
  if (!probe.ok) {
    say(`[${db.key}] cannot query the database. Masked output:`);
    say(probe.res.stdout);
    say(probe.res.stderr || probe.res.err);
    say(`[${db.key}] STOP. Is the stack up? Try: docker compose up -d && docker compose ps`);
    process.exit(1);
  }

  const baselinePresent = probe.present;
  say(`[${db.key}] baseline probe: public.teams ${baselinePresent ? 'exists' : 'does not exist yet'}`);

  for (const file of db.files) {
    const full = path.join(SQL_DIR, file);
    if (!existsSync(full)) {
      say(`[${db.key}] STOP: missing file ${path.relative(ROOT, full).replace(/\\/g, '/')}`);
      process.exit(1);
    }

    if (SKIPPABLE.has(file) && baselinePresent) {
      say(`[${db.key}] skip    ${file} (already applied: public.teams exists)`);
      continue;
    }

    if (CHECK_ONLY) {
      say(`[${db.key}] would apply ${file}`);
      continue;
    }

    const sql = readFileSync(full, 'utf8');
    const execEnvArgs = file === '030-app-role.sql' ? ['-e', 'DB_APP_USER', '-e', 'DB_APP_PASSWORD'] : [];
    const res = psql(db, [], execEnvArgs, sql);

    if (res.code !== 0) {
      say(`[${db.key}] FAILED ${file} (exit ${res.code})`);
      for (const line of interesting(res.stdout, res.stderr)) say(`    ${line}`);
      say(`[${db.key}] STOP. The SQL file was not modified.`);
      process.exit(1);
    }
    say(`[${db.key}] applied ${file} (exit 0, ${countTags(res.stdout)} statement tags)`);
    for (const line of interesting(res.stdout, res.stderr)) say(`    ${line}`);
  }
}

say('');
say(CHECK_ONLY
  ? 'db-apply --check: done. Nothing was changed.'
  : 'db-apply: done. Both databases applied without error.');

process.exit(failures === 0 ? 0 : 1);
