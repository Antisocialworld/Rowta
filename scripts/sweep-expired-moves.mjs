#!/usr/bin/env node
// scripts/sweep-expired-moves.mjs — terminal (admin) trigger for sweep-expired-moves.
// Runs the SAME job the worker and cron run (server/src/jobs/sweep-expired-moves.ts): expires
// 'requested' billing_handovers past expiry on every shard and enqueues the move_expired push +
// email per expired row. No sweep logic is duplicated here.
// Loads .env (program loads it; nothing secret printed — S1/S2). Prints only counts — never
// emails, names, or IDs.
// Run from the repo root: npm run sweep:expired-moves
//   (= npm exec --workspace @rowta/server -- tsx ../scripts/sweep-expired-moves.mjs)
// The job file is TypeScript, so this script must run through tsx (never bare node).
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(resolve(repoRoot, '.env'));
} catch {
  // .env may not exist in CI; env vars already set by the runner.
}

const { sweepExpiredMoves } = await import(
  pathToFileURL(resolve(repoRoot, 'server/src/jobs/sweep-expired-moves.ts')).href
);
const { closeAllDatabases } = await import(
  pathToFileURL(resolve(repoRoot, 'server/src/db/clients.ts')).href
);
const { closeAllQueues } = await import(
  pathToFileURL(resolve(repoRoot, 'server/src/jobs/queues.ts')).href
);

try {
  const { expiredCount } = await sweepExpiredMoves();
  process.stdout.write(`SWEEP EXPIRED MOVES OK: expired ${expiredCount} move(s).\n`);
} catch (err) {
  process.stderr.write(`SWEEP EXPIRED MOVES FAILED: ${err?.message ?? String(err)}\n`);
  process.exitCode = 1;
} finally {
  await closeAllQueues();
  await closeAllDatabases();
}
