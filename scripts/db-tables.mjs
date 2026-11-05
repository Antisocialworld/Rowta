#!/usr/bin/env node
// scripts/db-tables.mjs — non-interactive database schema and row-count viewer.
//
// Prints every table with its row count and column definitions for both db0 and db1.
// Rules honoured here:
//   S1: NEVER prints values of any column whose name contains hash, token, secret, password or code.
//       This script only inspects schema metadata and aggregate row counts (COUNT(*)); no column
//       data is ever queried or displayed.
//   S2: Reads .env at run time without printing values.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

try {
  process.loadEnvFile(resolve(repoRoot, '.env'));
} catch {
  // .env may already be loaded
}

const SENSITIVE_COLUMN_PATTERN = /hash|token|secret|password|code/i;

function runQuery(container, user, dbName, query) {
  const res = spawnSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', user, '-d', dbName, '-t', '-A', '-F', '|', '-c', query],
    {
      encoding: 'utf8',
    },
  );
  if (res.status !== 0) {
    throw new Error(`Query failed in ${container}: ${res.stderr || res.stdout}`);
  }
  return res.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function inspectDatabase(target) {
  const prefix = target === 'db0' ? 'DB0' : 'DB1';
  const container = target === 'db0' ? 'rowta-db0-1' : 'rowta-db1-1';
  const user = process.env[`${prefix}_USER`] || 'rowta';
  const dbName = process.env[`${prefix}_NAME`] || (target === 'db0' ? 'rowta_db0' : 'rowta_db1');

  console.log('='.repeat(80));
  console.log(`DATABASE: ${target} (${dbName}) in container "${container}"`);
  console.log('='.repeat(80));

  const tablesQuery = `
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `;

  let tables = [];
  try {
    tables = runQuery(container, user, dbName, tablesQuery);
  } catch (err) {
    console.error(`ERROR inspecting ${target}: ${err.message}`);
    return;
  }

  if (tables.length === 0) {
    console.log('No public tables found.');
    return;
  }

  for (const table of tables) {
    let rowCount = '?';
    try {
      const countRes = runQuery(container, user, dbName, `SELECT count(*) FROM "${table}";`);
      rowCount = countRes[0] ?? '?';
    } catch {
      rowCount = 'error';
    }

    const columnsQuery = `
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = '${table}'
      ORDER BY ordinal_position;
    `;

    let columns = [];
    try {
      columns = runQuery(container, user, dbName, columnsQuery).map((line) => {
        const [colName, dataType, isNullable] = line.split('|');
        return {
          name: colName,
          type: dataType,
          nullable: isNullable === 'YES',
          isSensitive: SENSITIVE_COLUMN_PATTERN.test(colName),
        };
      });
    } catch {
      columns = [];
    }

    console.log(`\nTable: ${table} (${rowCount} rows)`);
    console.log('  Columns:');
    for (const col of columns) {
      const nullability = col.nullable ? 'NULL' : 'NOT NULL';
      const sensitiveNote = col.isSensitive ? '  [sensitive column: values withheld]' : '';
      console.log(`    - ${col.name}: ${col.type} (${nullability})${sensitiveNote}`);
    }
  }
  console.log('\n');
}

console.log('Rowta Database Table Inventory (db0 & db1)');
console.log('Inspects tables, row counts, and column definitions. No column values are queried or printed.\n');

inspectDatabase('db0');
inspectDatabase('db1');
