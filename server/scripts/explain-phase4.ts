// Phase 4 EXPLAIN evidence (PRD 8.3): on the TEST database only, seed 10,000 fake activity rows for one
// fake team, capture EXPLAIN (ANALYZE, BUFFERS) with the feed index dropped and again after creating it,
// write both plans to docs/gates/evidence-phase-4-explain.txt, then remove the fake rows and team.
//
// Safety: reads .env programmatically and NEVER prints a value; refuses unless the target database name
// ends with `_test`, differs from the dev name and lives on a local host. Dev databases are never touched.
//
// Run from the repo root:  npx tsx server/scripts/explain-phase4.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadEnv(): void {
  const file = path.join(ROOT, '.env');
  if (!existsSync(file)) throw new Error('.env is missing; run node scripts/setup-env.mjs first.');
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

function testAdminUrl(shard: '0' | '1'): { url: string; name: string; devName: string } {
  const admin = process.env[`DB${shard}_ADMIN_URL`];
  const devName = process.env[`DB${shard}_NAME`];
  if (!admin || !devName) throw new Error(`DB${shard}_ADMIN_URL / DB${shard}_NAME missing.`);
  const parsed = new URL(admin);
  const devUrls = new Set(process.env[`DB${shard}_WRITE_URL`] ? [process.env[`DB${shard}_WRITE_URL`]!] : []);
  parsed.pathname = `/${devName}_test`;
  const url = parsed.toString();
  const name = parsed.pathname.replace(/^\//, '');
  const host = parsed.hostname;
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    throw new Error(`refusing a non-local host for DB${shard} (S1 guard)`);
  }
  if (!name.endsWith('_test') || name === devName) {
    throw new Error(`refusing a non-test database for DB${shard}`);
  }
  if (devUrls.has(url)) {
    throw new Error(`refusing a URL that equals the dev URL for DB${shard}`);
  }
  return { url, name, devName };
}

function planText(rows: { 'QUERY PLAN': string }[]): string {
  return rows.map((row) => row['QUERY PLAN']).join('\n');
}

async function main(): Promise<void> {
  loadEnv();
  const target = testAdminUrl('0');
  const client = new Client({ connectionString: target.url });
  await client.connect();
  const teamId = randomUUID();
  const lines: string[] = [];

  const push = (text: string): void => {
    lines.push(text);
    console.log(text);
  };

  push(`Phase 4 EXPLAIN evidence — database "${target.name}" (test only; dev name never used)`);
  push(`captured: ${new Date().toISOString()}`);
  push('query: SELECT id FROM activity_events WHERE team_id = $1 ORDER BY created_at DESC, id DESC LIMIT 20');
  push('');

  try {
    const beforeIndex = await client.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'activity_events' AND indexname = 'activity_feed_idx'`,
    );
    push(`index present before this run: ${beforeIndex.rowCount === 1 ? 'yes' : 'no'}`);
    const gin = await client.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'activity_events' AND indexname = 'activity_search_idx'`,
    );
    push(`search GIN index present: ${gin.rowCount === 1 ? 'yes' : 'no'}`);

    await client.query('INSERT INTO teams (id, name) VALUES ($1::uuid, $2)', [teamId, 'EXPLAIN fake team']);
    await client.query(
      `INSERT INTO activity_events (team_id, kind, subject_id, data, created_at)
       SELECT $1::uuid, 'shift.updated', NULL, jsonb_build_object('label', 'fake shift ' || g),
              now() - (g || ' seconds')::interval
       FROM generate_series(1, 10000) AS g`,
      [teamId],
    );
    const seeded = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM activity_events WHERE team_id = $1::uuid`,
      [teamId],
    );
    push(`seeded rows: ${seeded.rows[0]?.count ?? '0'}`);

    await client.query('DROP INDEX IF EXISTS activity_feed_idx');
    await client.query('ANALYZE activity_events');
    const before = await client.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM activity_events WHERE team_id = $1::uuid ORDER BY created_at DESC, id DESC LIMIT 20`,
      [teamId],
    );
    push('');
    push('=== BEFORE the feed index (index dropped on the TEST database) ===');
    push(planText(before.rows));

    await client.query('CREATE INDEX activity_feed_idx ON activity_events (team_id, created_at DESC, id DESC)');
    await client.query('ANALYZE activity_events');
    const after = await client.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM activity_events WHERE team_id = $1::uuid ORDER BY created_at DESC, id DESC LIMIT 20`,
      [teamId],
    );
    push('');
    push('=== AFTER the feed index ===');
    push(planText(after.rows));
    push('');
    push(`feed index restored: ${(await client.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'activity_feed_idx'`)).rowCount === 1 ? 'yes' : 'no'}`);
  } finally {
    await client.query('DELETE FROM activity_events WHERE team_id = $1::uuid', [teamId]).catch(() => undefined);
    await client.query('DELETE FROM teams WHERE id = $1::uuid', [teamId]).catch(() => undefined);
    await client.query('ANALYZE activity_events').catch(() => undefined);
    await client.end();
  }

  const evidence = path.join(ROOT, 'docs', 'gates', 'evidence-phase-4-explain.txt');
  writeFileSync(evidence, `${lines.join('\n')}\n`, 'utf8');
  console.log(`\nPASS: plans written to ${path.relative(ROOT, evidence).replace(/\\/g, '/')}`);
}

await main();
