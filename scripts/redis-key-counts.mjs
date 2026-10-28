// scripts/redis-key-counts.mjs — READ-ONLY Redis key statistics for a keyspace (stage 4 evidence).
// Connects with REDIS_URL (or TEST_REDIS_URL) from the environment/.env, SCANs the whole keyspace
// and prints ONLY counts per key prefix and the total. Key NAMES are never printed (they can
// embed emails or other sensitive values, S1), and the URL is never printed. No writes, no deletes.
// Run:  node scripts/redis-key-counts.mjs [test]
//   no argument = the dev keyspace (REDIS_URL); "test" = the test keyspace (TEST_REDIS_URL or
//   the derived index-15 target of REDIS_URL).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Redis from 'ioredis';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(ROOT, '.env');
if (existsSync(file)) {
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

const wantTest = process.argv.includes('test');
let url = process.env.REDIS_URL;
if (wantTest) {
  if (process.env.TEST_REDIS_URL) {
    url = process.env.TEST_REDIS_URL;
  } else {
    const parsed = new URL(process.env.REDIS_URL ?? 'redis://localhost:6390');
    parsed.pathname = '15';
    url = parsed.toString();
  }
}
if (!url) {
  console.error('missing REDIS_URL');
  process.exit(2);
}

const KNOWN = ['bull', 'bull-test', 'rl:', 'worker', 'cron', 'ryw:'];
const counts = new Map();
const redis = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2 });

try {
  let cursor = '0';
  let total = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', '*', 'COUNT', 1000);
    cursor = next;
    for (const key of keys) {
      total += 1;
      const bucket = KNOWN.find((p) => key.startsWith(p)) ?? 'other';
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
  } while (cursor !== '0');
  console.log(`keyspace=${wantTest ? 'TEST (index 15)' : 'DEV (REDIS_URL)'}`);
  console.log(`total_keys=${total}`);
  for (const prefix of KNOWN) {
    if ((counts.get(prefix) ?? 0) > 0) console.log(`${prefix}=${counts.get(prefix) ?? 0}`);
  }
  if ((counts.get('other') ?? 0) > 0) console.log(`other=${counts.get('other') ?? 0}`);
} finally {
  await redis.quit().catch(() => undefined);
}
