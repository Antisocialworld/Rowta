#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

try {
  process.loadEnvFile(resolve(repoRoot, '.env'));
} catch {
  // environment may already be populated
}

const rawArgs = process.argv.slice(2);
const apply = rawArgs.includes('--apply');
const unknownArgs = rawArgs.filter((arg) => arg !== '--apply');
if (unknownArgs.length > 0) {
  console.error(`Unknown argument(s): ${unknownArgs.join(', ')}`);
  process.exit(2);
}
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing: NODE_ENV=production.');
  process.exit(1);
}

const targets = {
  db0: { container: 'rowta-db0-1', prefix: 'DB0', fallbackName: 'rowta_db0' },
  db1: { container: 'rowta-db1-1', prefix: 'DB1', fallbackName: 'rowta_db1' },
};
for (const target of Object.values(targets)) {
  target.user = process.env[`${target.prefix}_USER`] || 'rowta';
  target.dbName = process.env[`${target.prefix}_NAME`] || target.fallbackName;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value) {
  if (!UUID_PATTERN.test(value)) {
    throw new Error('Unexpected non-UUID identifier from the database.');
  }
  return value;
}

function unique(values) {
  return [...new Set(values)];
}

function sqlUuidList(values) {
  const clean = unique(values);
  clean.forEach(assertUuid);
  return clean.length === 0 ? 'NULL::uuid' : clean.map((id) => `'${id}'::uuid`).join(', ');
}

function uuidCte(name, values) {
  const clean = unique(values);
  clean.forEach(assertUuid);
  if (clean.length === 0) {
    return `${name}(id) AS (SELECT NULL::uuid WHERE false)`;
  }
  return `${name}(id) AS (VALUES ${clean.map((id) => `('${id}'::uuid)`).join(', ')})`;
}

function assertLocalUrls() {
  const local = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
  const names = {
    db0: ['DB0_ADMIN_URL', 'DB0_WRITE_URL', 'DB0_READ_URL'],
    db1: ['DB1_ADMIN_URL', 'DB1_WRITE_URL', 'DB1_READ_URL'],
  };
  for (const [key, list] of Object.entries(names)) {
    const configured = list.filter((name) => process.env[name]);
    if (configured.length === 0) {
      throw new Error(`Refusing: no local ${key} database URL is configured.`);
    }
    for (const name of configured) {
      let url;
      try {
        url = new URL(process.env[name]);
      } catch {
        throw new Error(`Refusing: ${name} is not a valid URL.`);
      }
      if (!local.has(url.hostname)) {
        throw new Error(`Refusing: ${name} is not local.`);
      }
    }
  }
}

function runSql(key, sql, { readOnly = true } = {}) {
  const target = targets[key];
  const args = ['exec', '-i'];
  if (readOnly) {
    args.push('-e', 'PGOPTIONS=-c default_transaction_read_only=on');
  }
  args.push(
    target.container,
    'psql',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    target.user,
    '-d',
    target.dbName,
    '-X',
    '-A',
    '-F',
    '|',
    '-t',
    '-P',
    'pager=off',
    '-f',
    '-',
  );
  const result = spawnSync('docker', args, {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`docker exec failed for ${key}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`psql failed for ${key}: ${detail}`);
  }
  return result.stdout;
}

function fetchUsers() {
  // 'decoy' = the A7 timing-decoy fixture rows seeded by server/src/auth/timing-decoy.ts
  // (emails carry no '@', so no API flow can ever reach them; ids are the fixed constants there).
  const output = runSql(
    'db0',
    `SELECT id, CASE WHEN lower(email) LIKE '%@example.test' THEN 'test' WHEN lower(email) LIKE 'rowta-timing-decoy%' THEN 'decoy' ELSE 'real' END AS kind FROM users ORDER BY id;`,
  );
  const real = [];
  const test = [];
  const decoy = [];
  for (const line of output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
    const parts = line.split('|');
    if (parts.length !== 2 || !UUID_PATTERN.test(parts[0])) {
      continue;
    }
    if (parts[1] === 'real') {
      real.push(parts[0]);
    } else if (parts[1] === 'test') {
      test.push(parts[0]);
    } else if (parts[1] === 'decoy') {
      decoy.push(parts[0]);
    } else {
      throw new Error('Unexpected user classification from the database.');
    }
  }
  return { real: unique(real).sort(), test: unique(test).sort(), decoy: unique(decoy).sort() };
}

function fetchTeams(key, realUserIds) {
  const output = runSql(
    key,
    `SELECT t.id, CASE WHEN EXISTS (SELECT 1 FROM memberships m WHERE m.team_id = t.id AND m.user_id IN (${sqlUuidList(realUserIds)})) THEN 'kept' ELSE 'test' END AS kind FROM teams t ORDER BY t.id;`,
  );
  const test = [];
  const kept = [];
  for (const line of output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
    const parts = line.split('|');
    if (parts.length !== 2 || !UUID_PATTERN.test(parts[0])) {
      continue;
    }
    if (parts[1] === 'kept') {
      kept.push(parts[0]);
    } else if (parts[1] === 'test') {
      test.push(parts[0]);
    } else {
      throw new Error('Unexpected team classification from the database.');
    }
  }
  return { test: unique(test).sort(), kept: unique(kept).sort() };
}

function assertNoOverlap(first, second) {
  const secondSet = new Set(second);
  if (first.some((id) => secondSet.has(id))) {
    throw new Error('Refusing: a team ID appears on both shards.');
  }
}

function fetchDevs(keptTeamIds) {
  const output = runSql('db0', `SELECT id FROM teams WHERE lower(name) = 'devs' ORDER BY id;`);
  const ids = output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => UUID_PATTERN.test(value));
  if (ids.length !== 1) {
    throw new Error(`Expected exactly one DEVS team; found ${ids.length}.`);
  }
  const id = assertUuid(ids[0]);
  if (!keptTeamIds.includes(id)) {
    throw new Error('Refusing: the DEVS team is not kept by a real-user membership.');
  }
  const countOutput = runSql(
    'db0',
    `SELECT (SELECT count(*) FROM memberships WHERE team_id = '${id}'::uuid), (SELECT count(*) FROM invites WHERE team_id = '${id}'::uuid);`,
  );
  const row = countOutput
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.split('|'))
    .find((parts) => parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1]));
  if (!row) {
    throw new Error('Could not read DEVS membership and invite counts.');
  }
  return { id, memberships: Number(row[0]), invites: Number(row[1]) };
}

function scalar(key, sql) {
  const output = runSql(key, sql);
  const line = output
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => /^\d+$/.test(value));
  if (!line) {
    throw new Error(`Could not read a guard count from ${key}.`);
  }
  return Number(line);
}

function validateGuards(users, teams0, teams1, allTestTeamIds) {
  const realMemberOnTest0 = scalar(
    'db0',
    `SELECT count(*) FROM memberships WHERE team_id IN (${sqlUuidList(teams0.test)}) AND user_id IN (${sqlUuidList(users.real)});`,
  );
  const realMemberOnTest1 = scalar(
    'db1',
    `SELECT count(*) FROM memberships WHERE team_id IN (${sqlUuidList(teams1.test)}) AND user_id IN (${sqlUuidList(users.real)});`,
  );
  const realIndexOnTest = scalar(
    'db0',
    `SELECT count(*) FROM user_team_index WHERE team_id IN (${sqlUuidList(allTestTeamIds)}) AND user_id IN (${sqlUuidList(users.real)});`,
  );
  if (realMemberOnTest0 + realMemberOnTest1 + realIndexOnTest > 0) {
    throw new Error('Refusing: a real user is linked to a test team.');
  }
  if (users.test.length > 0) {
    const keptTeamIds = [...teams0.kept, ...teams1.kept];
    const testIndexOnKept = scalar(
      'db0',
      `SELECT count(*) FROM user_team_index WHERE user_id IN (${sqlUuidList(users.test)}) AND team_id IN (${sqlUuidList(keptTeamIds)});`,
    );
    if (testIndexOnKept > 0) {
      throw new Error('Refusing: a test user is indexed to a kept team; the user cascade would remove a kept-team index row.');
    }
  }
}

function countRow(table, testCondition, keptCondition, totalCondition = 'true') {
  return `SELECT '${table}' AS table_name, (SELECT count(*) FROM ${table} WHERE ${testCondition})::bigint AS test_count, (SELECT count(*) FROM ${table} WHERE ${keptCondition})::bigint AS kept_count, (SELECT count(*) FROM ${table} WHERE ${totalCondition})::bigint AS total_count`;
}

function fetchPlan(key, context) {
  const commonCtes = [
    uuidCte('test_teams0', context.testTeams0 || []),
    uuidCte('test_teams1', context.testTeams1 || []),
    uuidCte('kept_teams0', context.keptTeams0 || []),
    uuidCte('kept_teams1', context.keptTeams1 || []),
  ];
  let ctes;
  let rows;
  if (key === 'db0') {
    ctes = [
      uuidCte('real_users', context.realUserIds),
      uuidCte('test_users', context.testUserIds),
      ...commonCtes,
      `all_test_teams(id) AS (SELECT id FROM test_teams0 UNION SELECT id FROM test_teams1)`,
      `all_kept_teams(id) AS (SELECT id FROM kept_teams0 UNION SELECT id FROM kept_teams1)`,
    ];
    rows = [
      countRow('teams', 'id IN (SELECT id FROM test_teams0)', 'id IN (SELECT id FROM kept_teams0)'),
      countRow('invites', 'team_id IN (SELECT id FROM test_teams0)', 'team_id IN (SELECT id FROM kept_teams0)'),
      countRow('memberships', 'team_id IN (SELECT id FROM test_teams0)', 'team_id IN (SELECT id FROM kept_teams0)'),
      countRow('shifts', 'team_id IN (SELECT id FROM test_teams0)', 'team_id IN (SELECT id FROM kept_teams0)'),
      countRow('subscriptions', 'team_id IN (SELECT id FROM test_teams0)', 'team_id IN (SELECT id FROM kept_teams0)'),
      countRow('swap_requests', 'team_id IN (SELECT id FROM test_teams0)', 'team_id IN (SELECT id FROM kept_teams0)'),
      countRow('ledger_entries', 'team_id IN (SELECT id FROM test_teams0)', 'team_id IN (SELECT id FROM kept_teams0)'),
      countRow('activity_events', 'team_id IN (SELECT id FROM test_teams0)', 'team_id IN (SELECT id FROM kept_teams0)'),
      countRow('team_directory', 'team_id IN (SELECT id FROM all_test_teams)', 'team_id IN (SELECT id FROM all_kept_teams)'),
      countRow('user_team_index', 'team_id IN (SELECT id FROM all_test_teams)', 'team_id IN (SELECT id FROM all_kept_teams)'),
      countRow('payment_intents', 'team_id IN (SELECT id FROM all_test_teams)', 'team_id IN (SELECT id FROM all_kept_teams)'),
      countRow(
        'webhook_events',
        'tx_ref IN (SELECT tx_ref FROM payment_intents WHERE team_id IN (SELECT id FROM all_test_teams) AND tx_ref IS NOT NULL)',
        'tx_ref IN (SELECT tx_ref FROM payment_intents WHERE team_id IN (SELECT id FROM all_kept_teams) AND tx_ref IS NOT NULL)',
      ),
      countRow('pending_signups', `lower(email) LIKE '%@example.test' OR lower(email) LIKE 'rowta-timing-decoy%'`, `NOT (lower(email) LIKE '%@example.test' OR lower(email) LIKE 'rowta-timing-decoy%')`),
      countRow('users', `id IN (SELECT id FROM test_users) OR lower(email) LIKE 'rowta-timing-decoy%'`, `NOT (id IN (SELECT id FROM test_users) OR lower(email) LIKE 'rowta-timing-decoy%')`),
      countRow('devices', 'user_id IN (SELECT id FROM test_users)', 'user_id IN (SELECT id FROM real_users)'),
      countRow('refresh_tokens', 'user_id IN (SELECT id FROM test_users)', 'user_id IN (SELECT id FROM real_users)'),
      countRow('magic_tokens', 'user_id IN (SELECT id FROM test_users)', 'user_id IN (SELECT id FROM real_users)'),
      countRow('password_resets', `user_id IN (SELECT id FROM test_users) OR user_id IN (SELECT id FROM users WHERE lower(email) LIKE 'rowta-timing-decoy%')`, `NOT (user_id IN (SELECT id FROM test_users) OR user_id IN (SELECT id FROM users WHERE lower(email) LIKE 'rowta-timing-decoy%'))`),
      countRow('notification_log', 'user_id IN (SELECT id FROM test_users)', 'user_id IN (SELECT id FROM real_users)'),
      countRow('sent_emails', 'user_id IN (SELECT id FROM test_users)', 'user_id IN (SELECT id FROM real_users)'),
      countRow('user_settings', 'user_id IN (SELECT id FROM test_users)', 'user_id IN (SELECT id FROM real_users)'),
      countRow(
        'push_tickets',
        'device_id IN (SELECT id FROM devices WHERE user_id IN (SELECT id FROM test_users))',
        'device_id IN (SELECT id FROM devices WHERE user_id IN (SELECT id FROM real_users))',
      ),
      countRow('idempotency_keys', 'false', 'true'),
      countRow('purge_log', 'false', 'true'),
    ];
  } else {
    ctes = commonCtes.filter((value) => value.startsWith('test_teams1') || value.startsWith('kept_teams1'));
    rows = [
      countRow('teams', 'id IN (SELECT id FROM test_teams1)', 'id IN (SELECT id FROM kept_teams1)'),
      countRow('invites', 'team_id IN (SELECT id FROM test_teams1)', 'team_id IN (SELECT id FROM kept_teams1)'),
      countRow('memberships', 'team_id IN (SELECT id FROM test_teams1)', 'team_id IN (SELECT id FROM kept_teams1)'),
      countRow('shifts', 'team_id IN (SELECT id FROM test_teams1)', 'team_id IN (SELECT id FROM kept_teams1)'),
      countRow('subscriptions', 'team_id IN (SELECT id FROM test_teams1)', 'team_id IN (SELECT id FROM kept_teams1)'),
      countRow('swap_requests', 'team_id IN (SELECT id FROM test_teams1)', 'team_id IN (SELECT id FROM kept_teams1)'),
      countRow('ledger_entries', 'team_id IN (SELECT id FROM test_teams1)', 'team_id IN (SELECT id FROM kept_teams1)'),
      countRow('activity_events', 'team_id IN (SELECT id FROM test_teams1)', 'team_id IN (SELECT id FROM kept_teams1)'),
      countRow('idempotency_keys', 'false', 'true'),
      countRow('purge_log', 'false', 'true'),
    ];
  }
  const output = runSql(key, `WITH ${ctes.join(', ')}\n${rows.join('\nUNION ALL\n')}\nORDER BY table_name;`);
  const plan = new Map();
  for (const line of output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
    const parts = line.split('|');
    if (parts.length !== 4 || !/^[a-z_]+$/.test(parts[0])) {
      continue;
    }
    if (!/^\d+$/.test(parts[1]) || !/^\d+$/.test(parts[2]) || !/^\d+$/.test(parts[3])) {
      continue;
    }
    plan.set(parts[0], {
      test: Number(parts[1]),
      kept: Number(parts[2]),
      total: Number(parts[3]),
    });
  }
  return plan;
}

function validatePlan(key, plan) {
  for (const [table, counts] of plan) {
    if (counts.test + counts.kept !== counts.total) {
      throw new Error(
        `${key}.${table}: ${counts.test} test + ${counts.kept} kept does not equal ${counts.total}; ambiguous rows, stopping.`,
      );
    }
  }
  if (plan.get('ledger_entries').test !== 0) {
    throw new Error('Refusing: test-team rows exist in the append-only ledger; stopping (D3).');
  }
}

function printPlan(key, users, teams, plan, devs) {
  console.log(`\n[${key}] ${targets[key].container}/${targets[key].dbName}`);
  console.log(
    `real_users=${users ? users.real.length : 'n/a'} test_users=${users ? users.test.length : 'n/a'} decoy_fixture_users=${users ? users.decoy.length : 'n/a'}`,
  );
  console.log(`test_teams=${teams.test.length} kept_teams=${teams.kept.length}`);
  if (devs) {
    console.log(`devs_team=present devs_memberships=${devs.memberships} devs_invites=${devs.invites}`);
  }
  console.log('table|delete|keep|total');
  for (const [table, counts] of [...plan.entries()].sort()) {
    console.log(`${table}|${counts.test}|${counts.kept}|${counts.total}`);
  }
  console.log('notes=ledger_entries_append_only_untouched; idempotency_keys_and_purge_log_report_only');
}

function backup(key) {
  const directory = resolve(repoRoot, 'backups');
  mkdirSync(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = resolve(directory, `${key}-${stamp}.dump`);
  const fd = openSync(file, 'w');
  let result;
  try {
    result = spawnSync(
      'docker',
      [
        'exec',
        '-i',
        targets[key].container,
        'pg_dump',
        '-U',
        targets[key].user,
        '-d',
        targets[key].dbName,
        '--format=custom',
        '--no-owner',
        '--no-privileges',
      ],
      { stdio: ['ignore', fd, 'pipe'], encoding: 'utf8' },
    );
  } finally {
    closeSync(fd);
  }
  if (result.error) {
    throw new Error(`pg_dump failed for ${key}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`pg_dump failed for ${key}: ${String(result.stderr || '').trim()}`);
  }
  const size = statSync(file).size;
  if (size === 0) {
    throw new Error(`Backup for ${key} is empty.`);
  }
  console.log(`backup_${key}=${file}`);
  console.log(`backup_${key}_bytes=${size}`);
  return file;
}

const db0Specs = [
  { table: 'swap_requests', where: 'team_id IN (SELECT id FROM _clean_test_teams0)' },
  { table: 'shifts', where: 'team_id IN (SELECT id FROM _clean_test_teams0)' },
  { table: 'subscriptions', where: 'team_id IN (SELECT id FROM _clean_test_teams0)' },
  { table: 'invites', where: 'team_id IN (SELECT id FROM _clean_test_teams0)' },
  { table: 'activity_events', where: 'team_id IN (SELECT id FROM _clean_test_teams0)' },
  { table: 'memberships', where: 'team_id IN (SELECT id FROM _clean_test_teams0)' },
  {
    table: 'webhook_events',
    where:
      'tx_ref IN (SELECT tx_ref FROM payment_intents WHERE team_id IN (SELECT id FROM _clean_all_test_teams) AND tx_ref IS NOT NULL)',
  },
  { table: 'payment_intents', where: 'team_id IN (SELECT id FROM _clean_all_test_teams)' },
  { table: 'team_directory', where: 'team_id IN (SELECT id FROM _clean_all_test_teams)' },
  { table: 'user_team_index', where: 'team_id IN (SELECT id FROM _clean_all_test_teams)' },
  { table: 'teams', where: 'id IN (SELECT id FROM _clean_test_teams0)' },
  {
    table: 'push_tickets',
    where: 'device_id IN (SELECT id FROM devices WHERE user_id IN (SELECT id FROM _clean_test_users))',
  },
  { table: 'refresh_tokens', where: 'user_id IN (SELECT id FROM _clean_test_users)' },
  { table: 'magic_tokens', where: 'user_id IN (SELECT id FROM _clean_test_users)' },
  {
    table: 'password_resets',
    where:
      "user_id IN (SELECT id FROM _clean_test_users) OR user_id IN (SELECT id FROM users WHERE lower(email) LIKE 'rowta-timing-decoy%')",
  },
  { table: 'notification_log', where: 'user_id IN (SELECT id FROM _clean_test_users)' },
  { table: 'sent_emails', where: 'user_id IN (SELECT id FROM _clean_test_users)' },
  { table: 'user_settings', where: 'user_id IN (SELECT id FROM _clean_test_users)' },
  { table: 'devices', where: 'user_id IN (SELECT id FROM _clean_test_users)' },
  {
    table: 'pending_signups',
    where: `lower(email) LIKE '%@example.test' OR lower(email) LIKE 'rowta-timing-decoy%'`,
  },
  { table: 'users', where: "id IN (SELECT id FROM _clean_test_users) OR lower(email) LIKE 'rowta-timing-decoy%'" },
];

const db1Specs = [
  { table: 'swap_requests', where: 'team_id IN (SELECT id FROM _clean_test_teams1)' },
  { table: 'shifts', where: 'team_id IN (SELECT id FROM _clean_test_teams1)' },
  { table: 'subscriptions', where: 'team_id IN (SELECT id FROM _clean_test_teams1)' },
  { table: 'invites', where: 'team_id IN (SELECT id FROM _clean_test_teams1)' },
  { table: 'activity_events', where: 'team_id IN (SELECT id FROM _clean_test_teams1)' },
  { table: 'memberships', where: 'team_id IN (SELECT id FROM _clean_test_teams1)' },
  { table: 'teams', where: 'id IN (SELECT id FROM _clean_test_teams1)' },
];

function tempUuidTable(name, values) {
  const clean = unique(values);
  clean.forEach(assertUuid);
  const statements = [`CREATE TEMP TABLE ${name} (id uuid PRIMARY KEY) ON COMMIT DROP;`];
  if (clean.length > 0) {
    statements.push(
      `INSERT INTO ${name} (id) VALUES ${clean.map((id) => `('${id}'::uuid)`).join(', ')};`,
    );
  }
  return statements.join('\n');
}

function applyDatabase(key, context, plan) {
  const specs = key === 'db0' ? db0Specs : db1Specs;
  const expected = new Map();
  for (const spec of specs) {
    const counts = plan.get(spec.table);
    if (!counts) {
      throw new Error(`Missing plan count for ${key}.${spec.table}.`);
    }
    expected.set(spec.table, counts.test);
  }
  const statements = ['BEGIN;'];
  statements.push(tempUuidTable('_clean_test_teams1', context.testTeams1));
  if (key === 'db0') {
    statements.push(tempUuidTable('_clean_test_teams0', context.testTeams0));
    statements.push(tempUuidTable('_clean_test_users', context.testUserIds));
    statements.push('CREATE TEMP TABLE _clean_all_test_teams (id uuid PRIMARY KEY) ON COMMIT DROP;');
    statements.push(
      'INSERT INTO _clean_all_test_teams (id) SELECT id FROM _clean_test_teams0 UNION SELECT id FROM _clean_test_teams1;',
    );
  }
  statements.push('CREATE TEMP TABLE _deleted_counts (table_name text PRIMARY KEY, n bigint NOT NULL) ON COMMIT DROP;');
  statements.push('CREATE TEMP TABLE _expected (table_name text PRIMARY KEY, n bigint NOT NULL) ON COMMIT DROP;');
  statements.push(
    `INSERT INTO _expected (table_name, n) VALUES ${[...expected.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([table, count]) => `('${table}', ${count})`)
      .join(', ')};`,
  );
  for (const spec of specs) {
    statements.push(
      `WITH d AS (DELETE FROM ${spec.table} WHERE ${spec.where} RETURNING 1) INSERT INTO _deleted_counts (table_name, n) SELECT '${spec.table}', count(*) FROM d;`,
    );
  }
  statements.push(`DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT e.table_name, e.n AS expected, COALESCE(d.n, 0) AS actual
    FROM _expected e LEFT JOIN _deleted_counts d USING (table_name)
    WHERE e.n <> COALESCE(d.n, 0)
  LOOP
    RAISE EXCEPTION 'count mismatch for %: expected %, deleted %', r.table_name, r.expected, r.actual;
  END LOOP;
  FOR r IN
    SELECT d.table_name, d.n
    FROM _deleted_counts d LEFT JOIN _expected e USING (table_name)
    WHERE e.table_name IS NULL AND d.n > 0
  LOOP
    RAISE EXCEPTION 'unexpected rows deleted from %: %', r.table_name, r.n;
  END LOOP;
END $$;`);
  statements.push('SELECT table_name, n FROM _deleted_counts ORDER BY table_name;');
  statements.push('COMMIT;');
  const output = runSql(key, statements.join('\n'), { readOnly: false });
  const deleted = new Map();
  for (const line of output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
    const parts = line.split('|');
    if (parts.length !== 2 || !/^[a-z_]+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) {
      continue;
    }
    deleted.set(parts[0], Number(parts[1]));
  }
  for (const [table, count] of expected) {
    if (deleted.get(table) !== count) {
      throw new Error(`Verification failed: ${key}.${table} deleted ${deleted.get(table) ?? 'missing'}, expected ${count}.`);
    }
  }
  console.log(`\n[${key}] deleted`);
  for (const [table, count] of [...deleted.entries()].sort()) {
    console.log(`${table}|${count}`);
  }
  return deleted;
}

function verify(before, after) {
  if (after.users.test.length !== 0) {
    throw new Error(`Verification failed: ${after.users.test.length} test users remain.`);
  }
  if (after.users.real.length !== before.users.real.length) {
    throw new Error('Verification failed: the real-user count changed.');
  }
  if (
    after.devs.id !== before.devs.id ||
    after.devs.memberships !== before.devs.memberships ||
    after.devs.invites !== before.devs.invites
  ) {
    throw new Error('Verification failed: the DEVS team, its memberships, or its invites changed.');
  }
  if (after.teams0.test.length !== 0 || after.teams1.test.length !== 0) {
    throw new Error('Verification failed: test teams remain.');
  }
  for (const key of ['db0', 'db1']) {
    const beforePlan = before.plans[key];
    const afterPlan = after.plans[key];
    for (const [table, counts] of beforePlan) {
      const afterCounts = afterPlan.get(table);
      if (!afterCounts) {
        throw new Error(`Verification failed: ${key}.${table} is missing after cleanup.`);
      }
      if (afterCounts.test !== 0) {
        throw new Error(`Verification failed: ${key}.${table} still has ${afterCounts.test} test rows.`);
      }
      if (afterCounts.kept < counts.kept) {
        throw new Error(`Verification failed: ${key}.${table} kept dropped from ${counts.kept} to ${afterCounts.kept}.`);
      }
      if (table === 'users' && afterCounts.kept !== counts.kept) {
        throw new Error(`Verification failed: ${key}.${table} real-user count changed from ${counts.kept} to ${afterCounts.kept}.`);
      }
    }
  }
}

function main() {
  assertLocalUrls();
  const users = fetchUsers();
  if (users.real.length === 0) {
    throw new Error('Refusing: no real users found.');
  }
  const teams0 = fetchTeams('db0', users.real);
  const teams1 = fetchTeams('db1', users.real);
  assertNoOverlap([...teams0.test, ...teams0.kept], [...teams1.test, ...teams1.kept]);
  const devs = fetchDevs(teams0.kept);
  const allTestTeamIds = unique([...teams0.test, ...teams1.test]);
  validateGuards(users, teams0, teams1, allTestTeamIds);
  const context0 = {
    realUserIds: users.real,
    testUserIds: users.test,
    testTeams0: teams0.test,
    testTeams1: teams1.test,
    keptTeams0: teams0.kept,
    keptTeams1: teams1.kept,
  };
  const context1 = {
    testTeams1: teams1.test,
    keptTeams1: teams1.kept,
  };
  const plan0 = fetchPlan('db0', context0);
  const plan1 = fetchPlan('db1', context1);
  validatePlan('db0', plan0);
  validatePlan('db1', plan1);
  console.log(apply ? 'APPLY PLAN' : 'DRY RUN PLAN');
  console.log(apply ? 'Writes will be applied after backups and guards.' : 'Read-only. No writes.');
  printPlan('db0', users, teams0, plan0, devs);
  printPlan('db1', null, teams1, plan1, null);
  if (!apply) {
    console.log('\nDRY RUN COMPLETE: no writes.');
    return;
  }
  const backup0 = backup('db0');
  const backup1 = backup('db1');
  applyDatabase('db0', context0, plan0);
  applyDatabase('db1', context1, plan1);
  const afterUsers = fetchUsers();
  const afterTeams0 = fetchTeams('db0', afterUsers.real);
  const afterTeams1 = fetchTeams('db1', afterUsers.real);
  const afterDevs = fetchDevs(afterTeams0.kept);
  const afterContext0 = {
    realUserIds: afterUsers.real,
    testUserIds: afterUsers.test,
    testTeams0: afterTeams0.test,
    testTeams1: afterTeams1.test,
    keptTeams0: afterTeams0.kept,
    keptTeams1: afterTeams1.kept,
  };
  const afterContext1 = {
    testTeams1: afterTeams1.test,
    keptTeams1: afterTeams1.kept,
  };
  const afterPlan0 = fetchPlan('db0', afterContext0);
  const afterPlan1 = fetchPlan('db1', afterContext1);
  const before = { users, teams0, teams1, devs, plans: { db0: plan0, db1: plan1 } };
  const after = {
    users: afterUsers,
    teams0: afterTeams0,
    teams1: afterTeams1,
    devs: afterDevs,
    plans: { db0: afterPlan0, db1: afterPlan1 },
  };
  verify(before, after);
  console.log('\nAFTER VERIFICATION');
  printPlan('db0', after.users, after.teams0, afterPlan0, after.devs);
  printPlan('db1', null, after.teams1, afterPlan1, null);
  console.log(`backups=${backup0};${backup1}`);
  console.log('APPLY COMPLETE: verification passed.');
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
