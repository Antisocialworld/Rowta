#!/usr/bin/env node
// prisma-pull.mjs — run `prisma db pull` for a Rowta database, then repair what introspection gets wrong.
// Schema of record stays server/prisma/sql/*.sql (PRD 7). Prisma is the query client only; this script NEVER
// writes to a database. Usage:  node scripts/prisma-pull.mjs [db0|db1]   (no argument = both)
//
// WHY THE REPAIR STEP EXISTS (Prisma 7.10.1 limitation, recorded in docs/decisions/):
// A partial unique index whose column is also an FK target makes introspection infer a ONE-TO-ONE relation.
// The real shape is one-to-many, and for swap_requests Prisma then fails validation outright
// ("A one-to-one relation must use unique fields on the defining side"). The repair rewrites the back-relation
// to a list, which is what the database actually allows. It is deterministic: exact field/type name pairs only,
// and it fails loudly if the expected matches are missing so silent drift cannot slip through.
// Rule S1: no secret, key or URL is ever printed — output is masked before it reaches the terminal.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = resolve(repoRoot, 'server');

// S2: a program may load .env; the agent never reads or prints it. Used only to know what to mask.
try {
  process.loadEnvFile(resolve(repoRoot, '.env'));
} catch {
  // no .env: masking below still covers credential-shaped URLs.
}

const SECRET_ENV_NAMES = Object.keys(process.env).filter(
  (n) => /PASSWORD|SECRET|_URL$|_KEY$|TOKEN/i.test(n) && process.env[n],
);

function mask(text) {
  let out = String(text ?? '');
  for (const name of SECRET_ENV_NAMES) {
    const value = process.env[name];
    if (value && value.length >= 6) out = out.split(value).join('******');
  }
  // credential-shaped URLs anywhere: scheme://user:pass@host -> scheme://******:******@host
  out = out.replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s:@/'"]+):([^\s@/'"]+)@/gi, '$1******:******@');
  // connection-string style key=value pairs
  out = out.replace(/\b(password|pwd|user(?:name)?|host|sslmode)=[^\s;&"']+/gi, '$1=******');
  return out;
}

function log(text) {
  process.stdout.write(mask(text) + '\n');
}

// back-relation field name -> type name that introspection wrongly made optional (1:1) instead of a list (1:N)
const WANTED_LIST_RELATIONS = ['memberships', 'password_resets', 'swap_requests'];

function repairSchema(dbName) {
  const file = resolve(serverDir, 'prisma', dbName, 'schema.prisma');
  const before = readFileSync(file, 'utf8');
  const expected = dbName === 'db0' ? 3 : 2; // db1 has no users/password_resets
  let fixed = 0;
  const lines = before.split(/\r?\n/).map((line) => {
    const m = /^(\s*)(memberships|password_resets|swap_requests)(\s+)\2\?\s*$/.exec(line);
    if (!m) return line;
    fixed += 1;
    return `${m[1]}${m[2]}${m[3]}${m[2]}[]`;
  });
  if (fixed !== expected) {
    log(
      `ERROR ${dbName}: expected to repair ${expected} back-relation(s) to one-to-many, found ${fixed}. ` +
        'Inspect prisma/' + dbName + '/schema.prisma and update scripts/prisma-pull.mjs.',
    );
    return false;
  }
  writeFileSync(file, lines.join('\n'), 'utf8');
  log(`REPAIRED ${dbName}: ${fixed} back-relation(s) set to one-to-many (teams.memberships, shifts.swap_requests` + (dbName === 'db0' ? ', users.password_resets' : '') + ').');
  return true;
}

function pull(dbName) {
  const config = `prisma/${dbName}/prisma.config.ts`;
  log(`--- prisma db pull (${dbName}, config ${config}, --force) ---`);
  // --force: `db pull` validates the CURRENT schema before introspecting and refuses when it is invalid — which is
  // exactly the state the previous pull leaves behind. The schema of record is the SQL, so overwriting is correct;
  // the repair below then runs every time.
  const res = spawnSync('npx', ['prisma', 'db', 'pull', '--config', config, '--force'], {
    cwd: serverDir,
    shell: true,
    encoding: 'utf8',
    env: process.env,
  });
  log(res.stdout);
  log(res.stderr);
  if (res.status !== 0) {
    log(`ERROR ${dbName}: prisma db pull exited ${res.status}.`);
    return false;
  }
  return repairSchema(dbName);
}

const targets = process.argv.slice(2).filter(Boolean);
const list = targets.length ? targets : ['db0', 'db1'];
for (const t of list) {
  if (t !== 'db0' && t !== 'db1') {
    log(`ERROR unknown database "${t}" (expected db0 or db1).`);
    process.exit(2);
  }
}
let ok = true;
for (const t of list) ok = pull(t) && ok;
log(ok ? 'PULL OK (no database was modified; introspection is read-only).' : 'PULL FAILED.');
process.exit(ok ? 0 : 1);
