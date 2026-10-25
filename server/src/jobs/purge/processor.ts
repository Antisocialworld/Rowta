// Purge job processor (rules D4 to D6, PRD 7.3, 8.10, 8.11; skill rowta-data-recipes section 3.13).
//
// Responsibilities:
//   - purge-tokens: hard-deletes rows whose expiry passed more than 7 days ago in:
//     pending_signups, password_resets (later of expires_at and grant_expires_at), magic_tokens,
//     refresh_tokens (global DB), and invites (all shards).
//   - purge-idempotency: hard-deletes idempotency_keys older than 48 hours across db0 and every shard.
//
// Rules honoured:
//   - D5: dry-run first (counts rows and logs dry_run=true), then batched real delete (logs dry_run=false).
//   - Parameterised queries via tagged template literals (no string-built SQL).
//   - purge_log records job, table_name, row_count, dry_run, ran_at (NO personal data, rule S1).
//   - Never touches protected tables (users, teams, shifts, ledger, subscriptions, etc.).
import type { AnyPrismaClient } from '../../db/clients.ts';
import { globalDb, writeDb } from '../../db/clients.ts';
import { logger } from '../../lib/logger.ts';
import {
  IDEMPOTENCY_RETENTION_MS,
  PURGE_BATCH_SIZE,
  TOKEN_EXPIRY_GRACE_MS,
} from '../../config/retention.ts';

const log = logger.child({ module: 'purge' });

/** Shards enumerated from the data-access layer: DB0 (shard 0 + global) and DB1 (shard 1). */
export const SHARDS = [0, 1] as const;

export interface PurgeOptions {
  /** If true, runs a dry run first before deleting (default true per D5). */
  dryRunFirst?: boolean;
  /** If true, only counts rows and logs dry_run=true without deleting anything. */
  dryRunOnly?: boolean;
  /** Batch size per statement (defaults to PURGE_BATCH_SIZE = 1,000). */
  batchSize?: number;
  /** Anchor time (defaults to Date.now()). Injectable for tests (rule C9). */
  now?: Date;
}

export interface TablePurgeResult {
  table: string;
  shard?: number;
  dryRunCount: number;
  deletedCount: number;
}

export interface JobPurgeResult {
  job: string;
  tables: TablePurgeResult[];
}

async function logPurgeEntry(
  client: AnyPrismaClient,
  job: string,
  tableName: string,
  rowCount: number,
  dryRun: boolean,
): Promise<void> {
  await client.$executeRaw`
    INSERT INTO purge_log (job, table_name, row_count, dry_run)
    VALUES (${job}, ${tableName}, ${rowCount}, ${dryRun})
  `;
}

async function executePurgeForTable(
  client: AnyPrismaClient,
  job: string,
  tableName: string,
  shard: number | undefined,
  countFn: () => Promise<number>,
  deleteBatchFn: (batchSize: number) => Promise<number>,
  options: PurgeOptions,
): Promise<TablePurgeResult> {
  const batchSize = options.batchSize ?? PURGE_BATCH_SIZE;
  const dryRunFirst = options.dryRunFirst ?? true;
  const dryRunOnly = options.dryRunOnly ?? false;

  // 1. Dry run: count rows
  const dryRunCount = await countFn();

  if (dryRunFirst || dryRunOnly) {
    await logPurgeEntry(client, job, tableName, dryRunCount, true);
    log.info({ job, tableName, shard, dryRunCount, dryRun: true }, 'purge dry-run counted rows');
  }

  if (dryRunOnly) {
    return { table: tableName, shard, dryRunCount, deletedCount: 0 };
  }

  // 2. Real run: batched deletion
  let deletedCount = 0;
  if (dryRunCount > 0) {
    while (true) {
      const batchDeleted = await deleteBatchFn(batchSize);
      deletedCount += batchDeleted;
      if (batchDeleted < batchSize) break;
    }
  }

  await logPurgeEntry(client, job, tableName, deletedCount, false);
  log.info({ job, tableName, shard, deletedCount, dryRun: false }, 'purge completed real batch delete');

  return { table: tableName, shard, dryRunCount, deletedCount };
}

/**
 * purge-tokens: hard-delete expired tokens and codes older than 7 days past expiry.
 */
export async function runPurgeTokens(options: PurgeOptions = {}): Promise<JobPurgeResult> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - TOKEN_EXPIRY_GRACE_MS);
  const db = globalDb();
  const results: TablePurgeResult[] = [];
  const job = 'purge-tokens';

  // 1. pending_signups (db0)
  results.push(
    await executePurgeForTable(
      db,
      job,
      'pending_signups',
      undefined,
      async () => {
        const rows = await db.$queryRaw<Array<{ count: number }>>`
          SELECT count(*)::int AS count FROM pending_signups WHERE expires_at < ${cutoff}
        `;
        return Number(rows[0]?.count ?? 0);
      },
      async (batchSize) => {
        return db.$executeRaw`
          DELETE FROM pending_signups
          WHERE id IN (
            SELECT id FROM pending_signups
            WHERE expires_at < ${cutoff}
            LIMIT ${batchSize}
          )
        `;
      },
      options,
    ),
  );

  // 2. password_resets (db0) — use the LATER of expires_at and grant_expires_at
  results.push(
    await executePurgeForTable(
      db,
      job,
      'password_resets',
      undefined,
      async () => {
        const rows = await db.$queryRaw<Array<{ count: number }>>`
          SELECT count(*)::int AS count FROM password_resets
          WHERE expires_at < ${cutoff} AND (grant_expires_at IS NULL OR grant_expires_at < ${cutoff})
        `;
        return Number(rows[0]?.count ?? 0);
      },
      async (batchSize) => {
        return db.$executeRaw`
          DELETE FROM password_resets
          WHERE id IN (
            SELECT id FROM password_resets
            WHERE expires_at < ${cutoff} AND (grant_expires_at IS NULL OR grant_expires_at < ${cutoff})
            LIMIT ${batchSize}
          )
        `;
      },
      options,
    ),
  );

  // 3. magic_tokens (db0)
  results.push(
    await executePurgeForTable(
      db,
      job,
      'magic_tokens',
      undefined,
      async () => {
        const rows = await db.$queryRaw<Array<{ count: number }>>`
          SELECT count(*)::int AS count FROM magic_tokens WHERE expires_at < ${cutoff}
        `;
        return Number(rows[0]?.count ?? 0);
      },
      async (batchSize) => {
        return db.$executeRaw`
          DELETE FROM magic_tokens
          WHERE id IN (
            SELECT id FROM magic_tokens
            WHERE expires_at < ${cutoff}
            LIMIT ${batchSize}
          )
        `;
      },
      options,
    ),
  );

  // 4. refresh_tokens (db0)
  results.push(
    await executePurgeForTable(
      db,
      job,
      'refresh_tokens',
      undefined,
      async () => {
        const rows = await db.$queryRaw<Array<{ count: number }>>`
          SELECT count(*)::int AS count FROM refresh_tokens WHERE expires_at < ${cutoff}
        `;
        return Number(rows[0]?.count ?? 0);
      },
      async (batchSize) => {
        return db.$executeRaw`
          DELETE FROM refresh_tokens
          WHERE id IN (
            SELECT id FROM refresh_tokens
            WHERE expires_at < ${cutoff}
            LIMIT ${batchSize}
          )
        `;
      },
      options,
    ),
  );

  // 5. invites (all shards)
  for (const shard of SHARDS) {
    const shardDb = writeDb(shard);
    results.push(
      await executePurgeForTable(
        shardDb,
        job,
        'invites',
        shard,
        async () => {
          const rows = await shardDb.$queryRaw<Array<{ count: number }>>`
            SELECT count(*)::int AS count FROM invites WHERE expires_at < ${cutoff}
          `;
          return Number(rows[0]?.count ?? 0);
        },
        async (batchSize) => {
          return shardDb.$executeRaw`
            DELETE FROM invites
            WHERE id IN (
              SELECT id FROM invites
              WHERE expires_at < ${cutoff}
              LIMIT ${batchSize}
            )
          `;
        },
        options,
      ),
    );
  }

  return { job, tables: results };
}

/**
 * purge-idempotency: hard-delete idempotency keys older than 48 hours on db0 and every shard.
 */
export async function runPurgeIdempotency(options: PurgeOptions = {}): Promise<JobPurgeResult> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - IDEMPOTENCY_RETENTION_MS);
  const results: TablePurgeResult[] = [];
  const job = 'purge-idempotency';

  for (const shard of SHARDS) {
    const shardDb = writeDb(shard);
    results.push(
      await executePurgeForTable(
        shardDb,
        job,
        'idempotency_keys',
        shard,
        async () => {
          const rows = await shardDb.$queryRaw<Array<{ count: number }>>`
            SELECT count(*)::int AS count FROM idempotency_keys WHERE created_at < ${cutoff}
          `;
          return Number(rows[0]?.count ?? 0);
        },
        async (batchSize) => {
          return shardDb.$executeRaw`
            DELETE FROM idempotency_keys
            WHERE (scope, key) IN (
              SELECT scope, key FROM idempotency_keys
              WHERE created_at < ${cutoff}
              LIMIT ${batchSize}
            )
          `;
        },
        options,
      ),
    );
  }

  return { job, tables: results };
}
