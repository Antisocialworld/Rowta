#!/usr/bin/env node
// scripts/db-seed-reference.mjs -- seed `currencies` and `countries` in DB0 from cited public data.
//
// Task: PRD 5 (Currency) + docs/DATABASE.md line 677 ("the build seeds `currencies` and `countries`
// from cited sources (ISO 3217 via CLDR and ISO 3166-1 via i18n-iso-countries)"). The owner supplies
// `plan_prices` (PRD OPEN Q12); this script never touches that table.
//
// Sources (pinned exactly; the script fails loudly if a package is missing):
//   - i18n-iso-countries@7.14.0  (MIT)       langs/en.json          -> ISO 3166-1 alpha-2 codes + English names
//   - cldr-core@45.0.0           (Unicode-3.0) supplemental/currencyData.json
//       -> region:  country -> currency list (with _from/_to/_tender validity markers)
//       -> fractions: currency -> minor-unit digit count (ISO 4217 minor units as published by CLDR)
//   - cldr-numbers-modern@45.0.0 (Unicode-3.0) main/en/currencies.json -> English currency display names
//
// Selection rules (deterministic, documented in docs/PAYMENTS-CURRENCIES.md):
//   - One row per ISO alpha-2 code the package ships (250 rows; includes XK, a user-assigned code
//     the package carries so Kosovo users can sign up -- noted as a deviation in the doc).
//   - A country's currency is the FIRST CLDR region entry that is current (no `_to`) and tender
//     (`_tender` is not "false"). For the six multi-tender countries CLDR lists the domestic
//     currency first (BT BTN, HT HTG, LS LSL, NA NAD, PS ILS, PA PAB); the script follows CLDR order.
//   - Countries with no current tender currency are SKIPPED (only AQ, whose sole entry is XXX).
//   - minor_unit = fractions[code]._digits, else the CLDR DEFAULT (2). Asserted to be 0..3 to
//     satisfy the table CHECK. (CLF/UYW carry 4 digits but are never a current tender.)
//   - Currency name = CLDR English displayName; country name = the package's first English name.
//
// Flags on every currency row: provider_supported = false, enabled = false. Nothing is SOLD until
// the provider's support list is verified (PRD 5) AND the owner supplies plan_prices for every
// plan (PRD OPEN Q12). The UPDATE below never rewrites those two columns, so the owner (or the
// Phase 7 payments slice) can flip them and a later seed re-run will not clobber them.
//
// Idempotent: INSERT ... ON CONFLICT (code) DO UPDATE ... only when a value actually differs
// (IS DISTINCT FROM), so a re-run with unchanged sources reports 0 changed rows and touches nothing.
// Never deletes. Refuses to run when NODE_ENV is production (this is build/dev reference data;
// production seeding is an explicit owner action in the payments phase).
//
// Connection: psql INSIDE the db0 container over the local socket as the DB0 owner (same pattern as
// scripts/db-apply.mjs): no password on a command line, no URL, no admin channel. Only db0 is
// touched -- `currencies` and `countries` are global tables (docs/DATABASE.md section 2).
//
// Usage:
//   node scripts/db-seed-reference.mjs            seed (or converge) the two tables in DB0
//   node scripts/db-seed-reference.mjs --check    report the plan and counts, write nothing
//
// Output: counts and verdicts only -- no row data, no environment values (S1, S2, P6).

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');
const KNOWN_FLAGS = new Set(['--check']);

for (const arg of process.argv.slice(2)) {
  if (!KNOWN_FLAGS.has(arg)) {
    console.error(`db-seed-reference: unknown flag "${arg}". Known: --check`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------------------------
// P7 guard: reference-data seeding is a build/dev action; production gets its own explicit flow.
// ---------------------------------------------------------------------------------------------
if (process.env.NODE_ENV === 'production') {
  console.error(
    'db-seed-reference: refused (NODE_ENV=production). Seeding reference data into production is an '
    + 'explicit owner action in the payments phase, not a script re-run.',
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------------------------
// .env -> process.env only. Never printed, never edited (S1, S2) -- same loader as db-apply.mjs.
// ---------------------------------------------------------------------------------------------
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!existsSync(file)) {
    console.error('db-seed-reference: .env is missing. Run: node scripts/setup-env.mjs');
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

const say = (m) => console.log(mask(m));

for (const k of ['DB0_NAME', 'DB0_USER']) {
  if (!process.env[k]) {
    say(`db-seed-reference: missing environment name ${k}. Run: node scripts/setup-env.mjs`);
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------------------------
// Sources: read the three pinned JSON files. Every path is asserted; a missing package stops here.
// ---------------------------------------------------------------------------------------------
const NODE_MODULES = path.join(ROOT, 'node_modules');
const SOURCES = {
  iso: {
    pkg: 'i18n-iso-countries',
    version: '7.14.0',
    licence: 'MIT',
    file: path.join(NODE_MODULES, 'i18n-iso-countries', 'langs', 'en.json'),
  },
  currencyData: {
    pkg: 'cldr-core',
    version: '45.0.0',
    licence: 'Unicode-3.0',
    file: path.join(NODE_MODULES, 'cldr-core', 'supplemental', 'currencyData.json'),
  },
  currencyNames: {
    pkg: 'cldr-numbers-modern',
    version: '45.0.0',
    licence: 'Unicode-3.0',
    file: path.join(NODE_MODULES, 'cldr-numbers-modern', 'main', 'en', 'currencies.json'),
  },
};

for (const [key, src] of Object.entries(SOURCES)) {
  if (!existsSync(src.file)) {
    say(`db-seed-reference: missing source ${key} (${src.pkg}@${src.version}). Run: npm install at the repo root.`);
    process.exit(2);
  }
}

const isoEn = JSON.parse(readFileSync(SOURCES.iso.file, 'utf8'));
const currencyData = JSON.parse(readFileSync(SOURCES.currencyData.file, 'utf8')).supplemental.currencyData;
const currencyNames = JSON.parse(readFileSync(SOURCES.currencyNames.file, 'utf8')).main.en.numbers.currencies;

// ---------------------------------------------------------------------------------------------
// Build the rows in memory, with full validation, before anything touches the database.
// ---------------------------------------------------------------------------------------------
const DEFAULT_MINOR_UNIT = Number(currencyData.fractions.DEFAULT._digits); // CLDR: 2
const TODAY = new Date().toISOString().slice(0, 10); // for _to comparisons, YYYY-MM-DD

const failures = [];
const fail = (msg) => failures.push(msg);

/** Is this CLDR region entry a CURRENT tender currency? */
function isCurrentTender(entry) {
  const attrs = Object.values(entry)[0];
  if (attrs._tender === 'false') return false;
  if (typeof attrs._to === 'string' && attrs._to <= TODAY) return false;
  return true;
}

const countries = [];
const currencyCodes = new Set();
const skipped = []; // { code, reason }
const multiTender = []; // { country, picked, all }

for (const [code, rawName] of Object.entries(isoEn.countries)) {
  if (!/^[A-Z]{2}$/.test(code)) {
    fail(`iso key "${code}" is not an alpha-2 code`);
    continue;
  }
  const name = Array.isArray(rawName) ? rawName[0] : rawName;
  if (typeof name !== 'string' || name.length < 1 || name.length > 100) {
    fail(`country ${code}: name length ${typeof name === 'string' ? name.length : typeof name} outside 1..100`);
    continue;
  }
  if (/[\r\n]/.test(name)) {
    fail(`country ${code}: name contains a newline`);
    continue;
  }

  const entries = currencyData.region[code];
  if (!Array.isArray(entries) || entries.length === 0) {
    skipped.push({ code, reason: 'no CLDR region entry' });
    continue;
  }
  const current = entries.filter(isCurrentTender);
  if (current.length === 0) {
    skipped.push({ code, reason: 'no current tender currency in CLDR' });
    continue;
  }
  const currency = Object.keys(current[0])[0];
  if (!/^[A-Z]{3}$/.test(currency)) {
    fail(`country ${code}: picked currency "${currency}" is not alpha-3`);
    continue;
  }
  if (current.length > 1) {
    multiTender.push({ country: code, picked: currency, all: current.map((e) => Object.keys(e)[0]).join('+') });
  }
  currencyCodes.add(currency);
  countries.push({ code, name, currency });
}

const currencies = [];
for (const code of [...currencyCodes].sort()) {
  const digits = currencyData.fractions[code];
  const minorUnit = digits === undefined ? DEFAULT_MINOR_UNIT : Number(digits._digits);
  const name = currencyNames[code]?.displayName;
  if (typeof name !== 'string' || name.length < 1 || name.length > 100) {
    fail(`currency ${code}: displayName missing or length outside 1..100`);
    continue;
  }
  if (/[\r\n]/.test(name)) {
    fail(`currency ${code}: displayName contains a newline`);
    continue;
  }
  if (!Number.isInteger(minorUnit) || minorUnit < 0 || minorUnit > 3) {
    fail(`currency ${code}: minor_unit ${minorUnit} violates the table CHECK (0..3)`);
    continue;
  }
  currencies.push({ code, name, minorUnit });
}

countries.sort((a, b) => (a.code < b.code ? -1 : 1));
if (failures.length > 0) {
  say('db-seed-reference: validation FAILED, nothing was written:');
  for (const f of failures) say(`  - ${f}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// SQL: one transaction, currencies first (FK), then countries. Escaped literals only -- the data
// is public and validated above, but quoting is still done properly (apostrophes exist in names).
// ---------------------------------------------------------------------------------------------
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const currencyValues = currencies
  .map((c) => `  (${q(c.code)}, ${q(c.name)}, ${c.minorUnit}, false, false)`)
  .join(',\n');

const countryValues = countries
  .map((c) => `  (${q(c.code)}, ${q(c.name)}, ${q(c.currency)})`)
  .join(',\n');

const sql = `-- generated by scripts/db-seed-reference.mjs on ${TODAY}; sources and rules: docs/PAYMENTS-CURRENCIES.md
SET client_encoding TO 'UTF8';
BEGIN;
INSERT INTO currencies (code, name, minor_unit, provider_supported, enabled)
VALUES
${currencyValues}
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      minor_unit = EXCLUDED.minor_unit
  WHERE currencies.name IS DISTINCT FROM EXCLUDED.name
     OR currencies.minor_unit IS DISTINCT FROM EXCLUDED.minor_unit;
INSERT INTO countries (code, name, currency)
VALUES
${countryValues}
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      currency = EXCLUDED.currency
  WHERE countries.name IS DISTINCT FROM EXCLUDED.name
     OR countries.currency IS DISTINCT FROM EXCLUDED.currency;
COMMIT;
SELECT 'currencies_total=' || count(*)::text FROM currencies;
SELECT 'countries_total=' || count(*)::text FROM countries;
`;

// ---------------------------------------------------------------------------------------------
// db0 only, psql inside the container as the owner over the socket (db-apply.mjs pattern).
// ---------------------------------------------------------------------------------------------
function psql(input) {
  const res = spawnSync('docker', [
    'compose', 'exec', '-T',
    'db0',
    'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-U', process.env.DB0_USER,
    '-d', process.env.DB0_NAME,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
    input,
  });
  return {
    code: res.status ?? 1,
    stdout: mask(res.stdout || ''),
    stderr: mask(res.stderr || ''),
    err: res.error ? mask(res.error.message) : '',
  };
}

say(`db-seed-reference ${CHECK_ONLY ? '(--check: report only, nothing is written)' : '(seeding db0)'}`);
say(`sources: ${SOURCES.iso.pkg}@${SOURCES.iso.version} (${SOURCES.iso.licence}), `
  + `${SOURCES.currencyData.pkg}@${SOURCES.currencyData.version} (${SOURCES.currencyData.licence}), `
  + `${SOURCES.currencyNames.pkg}@${SOURCES.currencyNames.version} (${SOURCES.currencyNames.licence})`);
say(`plan: ${currencies.length} currencies, ${countries.length} countries, ${skipped.length} skipped, `
  + `${multiTender.length} multi-tender (first current CLDR entry wins)`);
for (const s of skipped) say(`  skipped ${s.code}: ${s.reason}`);
for (const m of multiTender) say(`  multi-tender ${m.country}: picked ${m.picked} (CLDR lists ${m.all})`);

if (CHECK_ONLY) {
  say('--check: done. Nothing was written.');
  process.exit(0);
}

const probe = psql(`SELECT to_regclass('public.currencies') IS NOT NULL AND to_regclass('public.countries') IS NOT NULL;\n`);
if (probe.code !== 0) {
  say('db-seed-reference: cannot query db0. Masked output:');
  say(probe.stdout);
  say(probe.stderr || probe.err);
  say('db-seed-reference: STOP. Is the stack up? Try: docker compose up -d && docker compose ps');
  process.exit(1);
}
if (probe.stdout.trim() !== 't') {
  say('db-seed-reference: STOP. The currencies/countries tables are missing. Run: node scripts/db-apply.mjs');
  process.exit(1);
}

const before = psql(`SELECT 'currencies_before=' || count(*)::text FROM currencies;\nSELECT 'countries_before=' || count(*)::text FROM countries;\n`);
const beforeCounts = Object.fromEntries(
  (before.stdout.match(/(currencies|countries)_before=\d+/g) || []).map((l) => l.split('=')),
);
say(`before: currencies=${beforeCounts.currencies_before ?? '?'}, countries=${beforeCounts.countries_before ?? '?'}`);

const run = psql(sql);
if (run.code !== 0) {
  say(`db-seed-reference: FAILED (psql exit ${run.code}). The transaction rolled back.`);
  for (const line of `${run.stdout}\n${run.stderr}`.split(/\r?\n/)) {
    if (/ERROR|FATAL|psql:/i.test(line)) say(`    ${line.trim()}`);
  }
  process.exit(1);
}

const after = Object.fromEntries(
  (run.stdout.match(/(currencies|countries)_total=\d+/g) || []).map((l) => l.split('=')),
);
const changedLines = (run.stdout.match(/^INSERT 0 \d+$/gm) || []);
const currencyTag = changedLines[0] ?? 'INSERT 0 ?';
const countryTag = changedLines[1] ?? 'INSERT 0 ?';
say(`currencies: ${currencyTag} rows inserted/updated (converged total=${after.currencies_total ?? '?'})`);
say(`countries:  ${countryTag} rows inserted/updated (converged total=${after.countries_total ?? '?'})`);
say('db-seed-reference: done. Nothing was deleted; enabled/provider_supported were left as they were.');
say('Re-run this script to confirm: both counts above should report INSERT 0 0.');
process.exit(0);
