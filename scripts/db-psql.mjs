#!/usr/bin/env node
// scripts/db-psql.mjs — open an interactive psql shell inside the PostgreSQL container.
//
// Rules honoured here:
//   S1: No password or connection string is ever logged, printed, or passed on the CLI.
//   S2: Loads .env into process.env at run time.
//
// Container authentication:
//   The postgres:16-alpine image configures local domain socket connections as `trust` in
//   /var/lib/postgresql/data/pg_hba.conf. Inside the container over the local socket,
//   psql connects as the container's owner user without requiring a password.
//
// Safety:
//   Sessions are READ-ONLY by default (PGOPTIONS=-c default_transaction_read_only=on).
//   Pass --write to enable a writable session.
//
// Usage:
//   npm run db:psql            # db0 interactive read-only (default)
//   npm run db:psql:db1        # db1 interactive read-only
//   npm run db:psql -- --write # db0 writable session (warning printed)
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Load .env
try {
  process.loadEnvFile(resolve(repoRoot, '.env'));
} catch {
  // .env may already be in environment
}

const args = process.argv.slice(2);
let target = 'db0';
let isWritable = false;

for (const arg of args) {
  if (arg === 'db0' || arg === 'db1') {
    target = arg;
  } else if (arg === '--write') {
    isWritable = true;
  }
}

const prefix = target === 'db0' ? 'DB0' : 'DB1';
const user = process.env[`${prefix}_USER`] || 'rowta';
const dbName = process.env[`${prefix}_NAME`] || (target === 'db0' ? 'rowta_db0' : 'rowta_db1');
const container = target === 'db0' ? 'rowta-db0-1' : 'rowta-db1-1';

console.log('='.repeat(70));
if (isWritable) {
  console.log(`*** WARNING: OPENING WRITABLE PSQL SESSION FOR ${target} (${dbName}) ***`);
  console.log(`*** Changes made here are permanent! Proceed with caution. ***`);
} else {
  console.log(`OPENING READ-ONLY PSQL SESSION FOR ${target} (${dbName})`);
  console.log(`(Default transaction read-only enforced. Pass --write to allow edits.)`);
}
console.log('='.repeat(70));
console.log('Tips:');
console.log('  \\dt            List tables in public schema');
console.log('  \\d <table_name> Describe table columns and constraints');
console.log('  \\q             Quit psql');
console.log('='.repeat(70));

const dockerArgs = ['exec', '-it'];
if (!isWritable) {
  dockerArgs.push('-e', 'PGOPTIONS=-c default_transaction_read_only=on');
}
dockerArgs.push(container, 'psql', '-U', user, '-d', dbName);

const res = spawnSync('docker', dockerArgs, {
  stdio: 'inherit',
});

process.exit(res.status ?? 0);
