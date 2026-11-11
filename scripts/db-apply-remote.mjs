#!/usr/bin/env node
// scripts/db-apply-remote.mjs -- apply server/prisma/sql baseline to two REMOTE Neon databases.
//
// Rules honoured here: S1 (never print a secret -- every line of child output is masked),
// S2 (env vars are read from the shell only, never from .env, never printed or echoed),
// P1 (no git), A4 (no SHA-256).
//
// How it connects: for each SQL file, spawns
//   docker exec -i -e REMOTE_URL -e DB_APP_USER -e DB_APP_PASSWORD <container> \
//     sh -c 'psql -X -v ON_ERROR_STOP=1 "$REMOTE_URL"'
// with the file content on stdin. REMOTE_URL is set in the child env only, never in argv.
// (psql \getenv in 030-app-role.sql reads DB_APP_USER and DB_APP_PASSWORD from the env.)
//
// DB0 files (numeric order, selftest*.sql excluded):
//   000,010,020,030,040,050,051,060,061,062,063,064,070,071,072,073,074,075,076,077,078,079,080,081,082,083,084,085,086,087
// DB1 files:
//   000,020,030,040,050,051,060,061,062,070,072,078,081,082
//
// Flags: --plan (default without --yes), --yes, --only db0|db1, --from NNN, --container NAME.
// Unknown flag: exit 2.
// Safety: refuses localhost/127.0.0.1 and pooler URLs; prints only hostnames, never credentials.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL_DIR = path.join(ROOT, 'server', 'prisma', 'sql');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
const KNOWN_FLAGS = new Set(['--plan', '--yes', '--only', '--from', '--container']);

let flagPlan = false;
let flagYes = false;
let flagOnly = null;    // null | 'db0' | 'db1'
let flagFrom = null;    // null | string (numeric prefix e.g. '040')
let flagContainer = 'rowta-db0-1';

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--plan') {
    flagPlan = true;
  } else if (arg === '--yes') {
    flagYes = true;
  } else if (arg === '--only') {
    const val = argv[++i];
    if (val !== 'db0' && val !== 'db1') {
      console.error(`db-apply-remote: --only must be db0 or db1, got: ${String(val)}`);
      process.exit(2);
    }
    flagOnly = val;
  } else if (arg === '--from') {
    flagFrom = argv[++i];
    if (!flagFrom || !/^\d+$/.test(flagFrom)) {
      console.error(`db-apply-remote: --from requires a numeric prefix, got: ${String(flagFrom)}`);
      process.exit(2);
    }
  } else if (arg === '--container') {
    flagContainer = argv[++i];
    if (!flagContainer) {
      console.error('db-apply-remote: --container requires a name');
      process.exit(2);
    }
  } else {
    console.error(`db-apply-remote: unknown flag "${arg}". Known: --plan --yes --only --from --container`);
    process.exit(2);
  }
}

// Without --yes, always behave as --plan
const PLAN_ONLY = flagPlan || !flagYes;

// ---------------------------------------------------------------------------
// Required env vars -- from the shell only, never from .env (S2)
// ---------------------------------------------------------------------------
const REQUIRED_ENV = ['REMOTE_DB0_ADMIN_URL', 'REMOTE_DB1_ADMIN_URL', 'DB_APP_USER', 'DB_APP_PASSWORD'];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length) {
  for (const k of missingEnv) {
    console.error(`db-apply-remote: missing environment variable: ${k}`);
  }
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Masking (S1) -- same regex as db-apply.mjs
// ---------------------------------------------------------------------------
const SECRET_VALUES = [
  process.env.REMOTE_DB0_ADMIN_URL,
  process.env.REMOTE_DB1_ADMIN_URL,
  process.env.DB_APP_USER,
  process.env.DB_APP_PASSWORD,
].filter((v) => typeof v === 'string' && v.length >= 4);

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

// ---------------------------------------------------------------------------
// Safety checks for a URL
// ---------------------------------------------------------------------------
function checkUrl(urlStr, label) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    say(`db-apply-remote: ${label} is not a valid URL (value hidden)`);
    process.exit(2);
  }
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    say(`db-apply-remote: ${label} host is local (${host}). Remote databases only.`);
    process.exit(2);
  }
  if (host.includes('-pooler')) {
    say(`db-apply-remote: ${label} host contains "-pooler" (${host}). DDL requires the direct host.`);
    process.exit(2);
  }
  return parsed.hostname; // safe to print -- hostname only, no credentials
}

const db0Host = checkUrl(process.env.REMOTE_DB0_ADMIN_URL, 'REMOTE_DB0_ADMIN_URL');
const db1Host = checkUrl(process.env.REMOTE_DB1_ADMIN_URL, 'REMOTE_DB1_ADMIN_URL');

// ---------------------------------------------------------------------------
// File lists
// ---------------------------------------------------------------------------
const DB0_PREFIXES = [
  '000','010','020','030','040','050','051','060','061','062','063','064',
  '070','071','072','073','074','075','076','077','078','079','080','081',
  '082','083','084','085','086','087',
];

const DB1_PREFIXES = [
  '000','020','030','040','050','051','060','061','062','070','072','078','081','082',
];

// Resolve prefix -> actual filename by scanning SQL_DIR
function resolveFiles(prefixes) {
  const allFiles = readdirSync(SQL_DIR).sort();
  const resolved = [];
  for (const prefix of prefixes) {
    const match = allFiles.find(
      (f) => f.startsWith(prefix + '-') && f.endsWith('.sql') && !f.startsWith('selftest'),
    );
    if (!match) {
      console.error(`db-apply-remote: cannot find a SQL file with prefix ${prefix} in server/prisma/sql/`);
      process.exit(2);
    }
    resolved.push(match);
  }
  return resolved;
}

const DB0_FILES = resolveFiles(DB0_PREFIXES);
const DB1_FILES = resolveFiles(DB1_PREFIXES);

// ---------------------------------------------------------------------------
// Database descriptors
// ---------------------------------------------------------------------------
const ALL_DBS = [
  { key: 'DB0', remoteUrlVar: 'REMOTE_DB0_ADMIN_URL', host: db0Host, files: DB0_FILES },
  { key: 'DB1', remoteUrlVar: 'REMOTE_DB1_ADMIN_URL', host: db1Host, files: DB1_FILES },
];

const DBS = flagOnly
  ? ALL_DBS.filter((db) => db.key.toLowerCase() === flagOnly)
  : ALL_DBS;

// ---------------------------------------------------------------------------
// Apply --from filter (applied per-db; files before the prefix are skipped)
// ---------------------------------------------------------------------------
function filterFrom(files, fromPrefix) {
  if (!fromPrefix) return files;
  const idx = files.findIndex((f) => f.startsWith(fromPrefix + '-'));
  if (idx === -1) {
    console.error(`db-apply-remote: --from ${fromPrefix} did not match any file`);
    process.exit(2);
  }
  return files.slice(idx);
}

// ---------------------------------------------------------------------------
// Plan display
// ---------------------------------------------------------------------------
function printPlan(db, files) {
  say(`\n=== ${db.key} plan (host: ${db.host}) ===`);
  say(`  container : ${flagContainer}`);
  say(`  files     : ${files.length}`);
  say('');
  for (const f of files) {
    say(`  would apply  ${f}`);
  }
}

// ---------------------------------------------------------------------------
// Apply a SQL file via docker exec + psql, with file content on stdin
// ---------------------------------------------------------------------------
function applyFile(db, file) {
  const full = path.join(SQL_DIR, file);
  if (!existsSync(full)) {
    say(`db-apply-remote: file not found: ${path.relative(ROOT, full).replace(/\\/g, '/')}`);
    process.exit(1);
  }
  const sql = readFileSync(full, 'utf8');
  const remoteUrl = process.env[db.remoteUrlVar];

  // REMOTE_URL is passed only via child env, never in argv.
  // sh -c reads it from the env variable.
  const shellCmd = `psql -X -v ON_ERROR_STOP=1 "$REMOTE_URL"`;

  const childEnv = {
    ...process.env,
    REMOTE_URL: remoteUrl,
    // DB_APP_USER and DB_APP_PASSWORD already in process.env; explicit for clarity and psql \getenv
    DB_APP_USER: process.env.DB_APP_USER,
    DB_APP_PASSWORD: process.env.DB_APP_PASSWORD,
  };

  const res = spawnSync(
    'docker',
    [
      'exec', '-i',
      '-e', 'REMOTE_URL',
      '-e', 'DB_APP_USER',
      '-e', 'DB_APP_PASSWORD',
      flagContainer,
      'sh', '-c', shellCmd,
    ],
    {
      input: sql,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: childEnv,
    },
  );

  return {
    code: res.status ?? 1,
    signal: res.signal,
    stdout: mask(res.stdout || ''),
    stderr: mask(res.stderr || ''),
    err: res.error ? mask(res.error.message) : '',
  };
}

function interesting(stdout, stderr) {
  return `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^(NOTICE|WARNING|ERROR|FATAL|psql:)/i.test(l));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
say(`db-apply-remote ${PLAN_ONLY ? '(plan only -- pass --yes to apply)' : '(applying to remote databases)'}`);

if (PLAN_ONLY) {
  for (const db of DBS) {
    const files = filterFrom(db.files, flagFrom);
    printPlan(db, files);
  }
  say('');
  say('db-apply-remote --plan: done. Nothing was changed.');
  process.exit(0);
}

// Apply mode
for (const db of DBS) {
  const files = filterFrom(db.files, flagFrom);
  const applied = [];

  say(`\n=== ${db.key} (host: ${db.host}, container: ${flagContainer}) ===`);
  say(`  files to apply: ${files.length}`);

  for (const file of files) {
    say(`[${db.key}] applying ${file} ...`);
    const res = applyFile(db, file);

    if (res.code !== 0) {
      say(`[${db.key}] FAILED ${file} (exit ${res.code}${res.signal ? `, signal ${res.signal}` : ''})`);
      for (const line of interesting(res.stdout, res.stderr)) say(`    ${line}`);
      if (res.err) say(`    spawn error: ${res.err}`);
      say('');
      say(`[${db.key}] Applied before failure (${applied.length}):`);
      for (const f of applied) say(`    ${f}`);
      const filePrefix = file.split('-')[0];
      say(`To resume: node scripts/db-apply-remote.mjs --from ${filePrefix} --only ${db.key.toLowerCase()} --yes`);
      process.exit(1);
    }

    say(`[${db.key}] ok  ${file}`);
    for (const line of interesting(res.stdout, res.stderr)) say(`    ${line}`);
    applied.push(file);
  }

  say(`[${db.key}] done. ${applied.length} file(s) applied.`);
}

say('');
say('db-apply-remote: done. All databases applied without error.');
process.exit(0);
