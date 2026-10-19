#!/usr/bin/env node
// scripts/db-as-app.mjs -- run SQL as the NON-OWNER application role (DB_APP_USER) inside the containers.
//
// Used by Phase 0 part A to prove the app role's limits:
//   node scripts/db-as-app.mjs              run server/prisma/sql/selftest-app.sql on DB0 and DB1, count PASS notices
//   node scripts/db-as-app.mjs --ledger     direct proof: ledger INSERT accepted, UPDATE/DELETE refused,
//                                           CREATE TABLE refused, everything rolled back
//
// Connection: psql runs INSIDE the container over TCP (-h 127.0.0.1) as the app role. The password is forwarded by
// NAME ONLY with `-e PGPASSWORD`: the value comes from this process's environment (.env is loaded here and never
// printed), so it never appears on a command line, in argv, in output or in a file (rules S1, S2).

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL_DIR = path.join(ROOT, 'server', 'prisma', 'sql');
const MODE = process.argv.includes('--ledger') ? 'ledger' : 'selftest-app';

// ---------------------------------------------------------------------------------------------
// .env -> process.env only (S1, S2)
// ---------------------------------------------------------------------------------------------
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!existsSync(file)) {
    console.error('db-as-app: .env is missing. Run: node scripts/setup-env.mjs');
    process.exit(2);
  }
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
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

const say = (m) => console.log(mask(m));

for (const k of ['DB_APP_USER', 'DB_APP_PASSWORD', 'DB0_NAME', 'DB1_NAME']) {
  if (!process.env[k]) {
    say(`db-as-app: missing environment name ${k}. Run: node scripts/setup-env.mjs`);
    process.exit(2);
  }
}

const DBS = [
  { key: 'DB0', service: 'db0', database: process.env.DB0_NAME },
  { key: 'DB1', service: 'db1', database: process.env.DB1_NAME },
];

function runAsApp(db, input) {
  // `-e PGPASSWORD` forwards the NAME; docker takes the value from this process's environment.
  // `sh -c '... 2>&1'` merges psql's notices/errors into stdout so the printed order is the real order.
  const inner = `psql -X -w -h 127.0.0.1 -U "${process.env.DB_APP_USER}" -d "${db.database}" -v ON_ERROR_STOP=0 2>&1`;
  const res = spawnSync('docker', [
    'compose', 'exec', '-T', '-e', 'PGPASSWORD',
    db.service,
    'sh', '-c', inner,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
  });
  return {
    code: res.status ?? 1,
    stdout: mask(res.stdout || ''),
    stderr: mask(res.stderr || ''),
    err: res.error ? mask(res.error.message) : '',
  };
}

function lines(text) {
  return String(text).split(/\r?\n/);
}

function countMatches(text, re) {
  return lines(text).filter((l) => re.test(l)).length;
}

// Direct proof for A4 step 5. SAVEPOINTs keep each refusal visible in one transaction that ends in ROLLBACK.
const LEDGER_PROOF = `
BEGIN;
INSERT INTO ledger_entries (id, team_id, kind, amount_minor, currency, reason)
VALUES ('99999999-9999-4999-8999-999999999999', '88888888-8888-4888-8888-888888888888', 'charge', 100, 'USD', 'proof insert');
SAVEPOINT proof_update;
UPDATE ledger_entries SET reason = 'proof update' WHERE id = '99999999-9999-4999-8999-999999999999';
ROLLBACK TO proof_update;
SAVEPOINT proof_delete;
DELETE FROM ledger_entries WHERE id = '99999999-9999-4999-8999-999999999999';
ROLLBACK TO proof_delete;
SAVEPOINT proof_ddl;
CREATE TABLE app_role_proof_scratch (id integer);
ROLLBACK TO proof_ddl;
ROLLBACK;
SELECT 'after rollback: proof ledger rows = ' || count(*)::text FROM ledger_entries WHERE id = '99999999-9999-4999-8999-999999999999';
SELECT 'after rollback: scratch table exists = ' || (to_regclass('public.app_role_proof_scratch') IS NOT NULL)::text;
`;

let failed = false;

if (MODE === 'selftest-app') {
  const file = path.join(SQL_DIR, 'selftest-app.sql');
  if (!existsSync(file)) {
    say(`db-as-app: missing ${file}`);
    process.exit(2);
  }
  const sql = readFileSync(file, 'utf8');
  say(`db-as-app: mode=selftest-app (as role "${process.env.DB_APP_USER}", over TCP inside the container)`);
  const counts = {};
  for (const db of DBS) {
    const res = runAsApp(db, sql);
    const pass = countMatches(`${res.stdout}\n${res.stderr}`, /NOTICE:\s+PASS/);
    const errors = countMatches(`${res.stdout}\n${res.stderr}`, /^\s*(ERROR|FATAL)|:\s*ERROR:/);
    counts[db.key] = pass;
    say(`\n=== ${db.key} selftest-app.sql as the app role (psql exit ${res.code}) ===`);
    say(`PASS notices: ${pass}`);
    say(`ERROR lines: ${errors}`);
    const tail = lines(`${res.stdout}\n${res.stderr}`).filter((l) => l.trim()).slice(-6);
    for (const l of tail) say(`    ${l}`);
    if (res.code !== 0 || pass === 0 || errors > 0 || res.err) failed = true;
  }
  say(`\nselftest-app PASS counts: DB0=${counts.DB0} DB1=${counts.DB1}`);
} else {
  say(`db-as-app: mode=ledger (as role "${process.env.DB_APP_USER}", one transaction, rolled back)`);
  for (const db of DBS) {
    const res = runAsApp(db, LEDGER_PROOF);
    const out = `${res.stdout}\n${res.stderr}`;
    const inserted = countMatches(out, /INSERT 0 1/);
    const updateRefused = countMatches(out, /permission denied for table ledger_entries|ledger_entries is append-only/);
    const deleteRefused = countMatches(out, /permission denied for table ledger_entries|ledger_entries is append-only/);
    const createRefused = countMatches(out, /permission denied for schema public|cannot create|permission denied/);
    const rolledBack = /proof ledger rows = 0/.test(out) && /scratch table exists = false/.test(out);
    say(`\n=== ${db.key} direct ledger / DDL proof as the app role (psql exit ${res.code}) ===`);
    for (const l of lines(out)) if (l.trim()) say(`    ${l}`);
    const ok = res.code === 0 && inserted === 1 && updateRefused >= 1 && deleteRefused >= 1
      && createRefused >= 1 && rolledBack && !res.err;
    say(`VERDICT ${db.key}: INSERT accepted=${inserted === 1}, UPDATE refused=${updateRefused >= 1}, `
      + `DELETE refused=${deleteRefused >= 1}, CREATE TABLE refused=${createRefused >= 1}, rolled back=${rolledBack} `
      + `-> ${ok ? 'PASS' : 'FAIL'}`);
    if (!ok) failed = true;
  }
}

process.exit(failed ? 1 : 0);
