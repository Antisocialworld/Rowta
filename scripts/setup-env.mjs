#!/usr/bin/env node
// Rowta environment helper. Run from the repo root.
//   node scripts/setup-env.mjs                create .env, or fill empty LOCAL secrets in it
//   node scripts/setup-env.mjs --check        report missing / empty names (never values)
//   node scripts/setup-env.mjs --audit-example  fail if .env.example holds a value where it must be empty
// SAFETY: this script prints variable NAMES and statuses only. It never prints a value.
// It only generates local secrets (database, Redis, token signing). Third-party secrets are yours to paste.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = resolve(root, '.env.example');
const TARGET = resolve(root, '.env');
const GITIGNORE = resolve(root, '.gitignore');

const GENERATED = {
  DB0_PASSWORD: () => randomBytes(24).toString('hex'),
  DB1_PASSWORD: () => randomBytes(24).toString('hex'),
  DB_APP_PASSWORD: () => randomBytes(24).toString('hex'),
  REDIS_PASSWORD: () => randomBytes(24).toString('hex'),
  JWT_ACCESS_SECRET: () => randomBytes(64).toString('base64url'),
};
const DERIVED = {
  DB0_ADMIN_URL: (e) => pg(e, 'DB0'),
  DB1_ADMIN_URL: (e) => pg(e, 'DB1'),
  DB0_WRITE_URL: (e) => pgApp(e, 'DB0'),
  DB0_READ_URL: (e) => pgApp(e, 'DB0'),
  DB1_WRITE_URL: (e) => pgApp(e, 'DB1'),
  DB1_READ_URL: (e) => pgApp(e, 'DB1'),
  REDIS_URL: (e) => (e.REDIS_PASSWORD && e.REDIS_PORT ? url('redis:', '', e.REDIS_PASSWORD, e.REDIS_PORT, '') : ''),
};
function pg(e, p) {
  const [u, pw, port, name] = ['USER', 'PASSWORD', 'PORT', 'NAME'].map((k) => e[`${p}_${k}`]);
  return u && pw && port && name ? url('postgresql:', u, pw, port, name) : '';
}
// The app role (non-owner): user and password from DB_APP_*, port and database name from the database's own parts.
function pgApp(e, p) {
  const [u, pw, port, name] = [e.DB_APP_USER, e.DB_APP_PASSWORD, e[`${p}_PORT`], e[`${p}_NAME`]];
  return u && pw && port && name ? url('postgresql:', u, pw, port, name) : '';
}
// Builds a connection string with the URL class so the source holds no credential-shaped literal (secret scan stays clean).
function url(protocol, user, password, port, path) {
  const x = new URL(protocol + '//localhost');
  x.username = user;
  x.password = password;
  x.port = String(port);
  x.pathname = path ? '/' + path : '';
  return x.toString().replace(/\/$/, '');
}
// Empty is fine for these until the named point.
const OPTIONAL_EMPTY = {
  SMTP_USER: 'only for a real SMTP server',
  SMTP_PASSWORD: 'only for a real SMTP server',
  FLW_PUBLIC_KEY: 'Phase 7; the dev simulator works without it',
  FLW_SECRET_KEY: 'Phase 7; the dev simulator works without it',
  FLW_ENCRYPTION_KEY: 'only if the current Flutterwave API needs it',
  FLW_WEBHOOK_SECRET_HASH: 'Phase 7; the dev simulator works without it',
  EXPO_ACCESS_TOKEN: 'optional',
  SENTRY_DSN_SERVER: 'optional',
  EXPO_PUBLIC_SENTRY_DSN: 'optional',
  EXPO_PUBLIC_EAS_PROJECT_ID: 'Phase 12 (EAS build)',
};
const SENSITIVE = /(SECRET|PASSWORD|TOKEN|PRIVATE|KEY|DSN)/;
const MUST_BE_EMPTY_IN_EXAMPLE = (k) => SENSITIVE.test(k) || /(_WRITE_URL|_READ_URL|_ADMIN_URL|^REDIS_URL)$/.test(k);

function parse(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m) out[m[1]] = stripComment(m[2]);
  }
  return out;
}
function stripComment(v) {
  const i = v.search(/\s+#/);
  return (i >= 0 ? v.slice(0, i) : v).trim();
}
function read(p) { return readFileSync(p, 'utf8'); }
function setValue(line, value) {
  const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  const rest = m[2];
  const ci = rest.search(/\s+#/);
  const comment = ci >= 0 ? rest.slice(ci) : '';
  return `${m[1]}=${value}${comment}`;
}

if (!existsSync(EXAMPLE)) { console.error('.env.example not found. Run this from the repo root.'); process.exit(1); }
const example = parse(read(EXAMPLE));
const arg = process.argv[2];

if (arg === '--audit-example') {
  const bad = Object.entries(example).filter(([k, v]) => MUST_BE_EMPTY_IN_EXAMPLE(k) && v !== '').map(([k]) => k);
  if (bad.length) { console.error('FAIL: these names must be empty in .env.example:', bad.join(', ')); process.exit(1); }
  console.log(`OK: ${Object.keys(example).length} names in .env.example; every sensitive name is empty.`);
  process.exit(0);
}

if (arg === '--check') {
  let fail = false;
  if (!existsSync(TARGET)) { console.error('FAIL: .env does not exist. Run: node scripts/setup-env.mjs'); process.exit(1); }
  const env = parse(read(TARGET));
  const missing = Object.keys(example).filter((k) => !(k in env));
  const empty = Object.keys(example).filter((k) => k in env && env[k] === '');
  const needed = empty.filter((k) => !(k in OPTIONAL_EMPTY));
  const optional = empty.filter((k) => k in OPTIONAL_EMPTY);
  if (missing.length) { fail = true; console.log('MISSING names (run setup to add them):', missing.join(', ')); }
  if (needed.length) { fail = true; console.log('EMPTY but required:', needed.join(', ')); }
  for (const k of optional) console.log(`empty (ok): ${k} - ${OPTIONAL_EMPTY[k]}`);
  const gi = existsSync(GITIGNORE) ? read(GITIGNORE).split(/\r?\n/).map((l) => l.trim()) : [];
  if (!gi.includes('.env') || !gi.includes('.env.*') || !gi.includes('!.env.example')) { fail = true; console.log('FAIL: .gitignore must ignore .env and .env.* but keep !.env.example'); }
  if (env.NODE_ENV === 'production' && env.PAYMENT_SIMULATOR_ENABLED === 'true') { fail = true; console.log('FAIL: PAYMENT_SIMULATOR_ENABLED must be false when NODE_ENV=production'); }
  console.log(fail ? 'RESULT: problems found' : 'RESULT: ok');
  process.exit(fail ? 1 : 0);
}

// ---- create or update .env ----
const created = !existsSync(TARGET);
const lines = (created ? read(EXAMPLE) : read(TARGET)).split(/\r?\n/);
let env = parse(lines.join('\n'));
const status = [];
const exampleLines = read(EXAMPLE).split(/\r?\n/);

// add names that exist in the example but not in .env
if (!created) {
  const add = exampleLines.filter((l) => { const m = /^([A-Z][A-Z0-9_]*)=/.exec(l); return m && !(m[1] in env); });
  if (add.length) {
    lines.push('', '# added from .env.example');
    for (const l of add) { lines.push(l); status.push(`${/^([A-Z0-9_]+)=/.exec(l)[1]}: added (empty or default)`); }
    env = parse(lines.join('\n'));
  }
}
const apply = (name, value) => {
  const i = lines.findIndex((l) => l.startsWith(`${name}=`));
  lines[i] = setValue(lines[i], value);
  env[name] = value;
};
for (const [name, gen] of Object.entries(GENERATED)) {
  if (!(name in env)) continue;
  if (env[name] === '') { apply(name, gen()); status.push(`${name}: generated`); }
  else status.push(`${name}: kept (already set)`);
}
for (const [name, build] of Object.entries(DERIVED)) {
  if (!(name in env)) continue;
  if (env[name] === '') {
    const v = build(env);
    if (v) { apply(name, v); status.push(`${name}: derived`); }
  } else status.push(`${name}: kept (already set)`);
}
writeFileSync(TARGET, lines.join('\n'));
try { chmodSync(TARGET, 0o600); } catch { /* not supported on this system */ }
console.log(created ? '.env created.' : '.env updated (existing values were not overwritten).');
for (const s of status) console.log(' -', s);
console.log('You still fill by hand (optional until their phase): ' + Object.keys(OPTIONAL_EMPTY).filter((k) => env[k] === '').join(', '));
console.log('Note: if you change a database password after the containers were first started, run "docker compose down -v" (this wipes local data) so they restart with the new one.');
