// Sweep expired move billing requests (G3-2).
// Runs against every shard where billing_handovers lives (db0 and db1).
// Selects billing_handovers where status='requested' AND expires_at <= now(),
// oldest first, at most 200 per shard per run.
// For each row, conditional update (WHERE id AND status='requested' AND expires_at <= now())
// to status='expired'. Only if that update changed 1 row, enqueue the existing
// billing.move_expired push (inside the same shard transaction) and the existing
// email to from_user_id. A row already expired by the lazy path produces no
// second notice. Logs only counts per run and IDs, no personal data.
// Safe to run twice at once (conditional update guarantees one winner).
import { globalDb, writeDb, shardTransaction, type ShardTx } from '../db/clients.ts';
import type { Shard } from '../db/shard.ts';
import { enqueueNotification } from '../notifications/outbox.ts';
import { enqueueEmail } from './email/enqueue.ts';
import { logger } from '../lib/logger.ts';
import type { EmailJobData } from './email/types.ts';

const SWEEP_BATCH_SIZE = 200;

async function sweepExpiredMovesOnShard(
  shard: Shard,
  now: Date,
): Promise<number> {
  const shardClient = writeDb(shard);

  const expired = await shardClient.billing_handovers.findMany({
    where: {
      subscription_id: null,
      status: 'requested',
      expires_at: { lte: now },
    },
    orderBy: { expires_at: 'asc' },
    take: SWEEP_BATCH_SIZE,
  });

  let expiredCount = 0;

  for (const row of expired) {
    const didExpire = await shardTransaction(shard, async (tx: ShardTx) => {
      const updated = await tx.billing_handovers.updateMany({
        where: { id: row.id, status: 'requested', expires_at: { lte: now } },
        data: { status: 'expired', resolved_at: now },
      });

      if (updated.count === 1) {
        await enqueueNotification(tx, {
          recipientUserId: row.from_user_id,
          category: 'billing.move_expired',
          payload: { teamId: row.team_id, moveId: row.id },
          dedupeKey: `billing:move:${row.id}:expired`,
        });
        return true;
      }
      return false;
    });

    if (didExpire) {
      expiredCount++;

      // Enqueue email (outside the shard transaction - it's a BullMQ job)
      const payer = await globalDb().users.findUnique({
        where: { id: row.from_user_id },
        select: { email: true, display_name: true },
      });
      const teamRow = await shardClient.teams.findUnique({
        where: { id: row.team_id },
        select: { name: true },
      });
      if (payer && teamRow) {
        try {
          await enqueueEmail({
            kind: 'moveExpired',
            email: payer.email,
            team: teamRow.name,
            name: payer.display_name,
            date: row.expires_at.toISOString(),
          } as EmailJobData);
        } catch {
          // Notification failure must not fail the sweep.
        }
      }
    }
  }

  return expiredCount;
}

export async function sweepExpiredMoves(
  options: { now?: Date } = {},
): Promise<{ expiredCount: number }> {
  const now = options.now ?? new Date();
  const SHARDS = [0, 1] as const;

  let totalExpired = 0;
  for (const shard of SHARDS) {
    const count = await sweepExpiredMovesOnShard(shard, now);
    totalExpired += count;
  }

  logger.info({ job: 'sweep-expired-moves', expiredCount: totalExpired }, 'sweep expired moves');

  return { expiredCount: totalExpired };
}
