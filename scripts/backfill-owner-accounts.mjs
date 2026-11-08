#!/usr/bin/env node
// scripts/backfill-owner-accounts.mjs — terminal admin trigger for backfilling owner accounts and registry.
// Reads teams from all shards and creates owner_accounts and owner_team_registry on DB0.
// DRY RUN is the default. Pass --apply to write.
// Pass --allow-non-local to allow non-local or production hosts (refused by default).
// Loads .env without printing secrets (S1/S2). Prints COUNTS ONLY — never emails, names, or IDs.
// Run from the repo root: npm run backfill:owner-accounts [-- --apply]
//   (= npm exec --workspace @rowta/server -- tsx ../scripts/backfill-owner-accounts.mjs)
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(resolve(repoRoot, '.env'));
} catch {
  // .env may not exist in CI; env vars already set by the runner.
}

const { backfillOwnerAccounts } = await import(
  pathToFileURL(resolve(repoRoot, 'server/src/billing/backfill-owner-accounts.ts')).href
);
const { closeAllDatabases } = await import(
  pathToFileURL(resolve(repoRoot, 'server/src/db/clients.ts')).href
);

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const allowNonLocal = args.includes('--allow-non-local');

try {
  const result = await backfillOwnerAccounts({ apply, allowNonLocal });
  const mode = result.dryRun ? 'DRY RUN (no rows written)' : 'APPLIED';
  process.stdout.write(`\n=== BACKFILL OWNER ACCOUNTS: ${mode} ===\n`);
  for (const [shard, count] of Object.entries(result.teamsScannedPerShard)) {
    process.stdout.write(`- Shard ${shard} eligible teams scanned: ${count}\n`);
  }
  process.stdout.write(`- Deleted or creatorless teams skipped: ${result.deletedOrCreatorlessSkipped}\n`);
  process.stdout.write(`- Deleted teams inside the restore window included: ${result.deletedTeamsInsideRestoreWindowIncluded}\n`);
  process.stdout.write(`- Creators skipped (missing user row): ${result.creatorsSkippedMissingUser}\n`);
  process.stdout.write(`- Accounts already existing: ${result.accountsAlreadyExisting}\n`);
  process.stdout.write(`- Accounts ${result.dryRun ? 'to create' : 'created'}: ${result.accountsCreated}\n`);
  process.stdout.write(`- Registry rows already existing: ${result.registryAlreadyExisting}\n`);
  process.stdout.write(`- Registry rows ${result.dryRun ? 'to create' : 'created'}: ${result.registryCreated}\n`);
  process.stdout.write(`=========================================\n\n`);
} catch (err) {
  process.stderr.write(`BACKFILL OWNER ACCOUNTS FAILED: ${err?.message ?? String(err)}\n`);
  process.exitCode = 1;
} finally {
  await closeAllDatabases();
}

