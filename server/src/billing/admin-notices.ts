// Notice to team Admins when the payer's plan changes (Phase 6 / G6a Task A2).
// Recipients: for each team covered by that payer (owner_team_registry), the team's Admin
// (role 'owner' in memberships), EXCLUDING the payer themselves. Not Managers, not Staff.
// No names anywhere. Push + email via existing outbox and email queue.
// Fail-safe: a notice failure never fails the main action. Catch, log errorCode, continue.
import { globalDb, forTeam, shardTransaction } from '../db/clients.ts';
import { shardFor, type Shard } from '../db/shard.ts';
import { enqueueNotification } from '../notifications/outbox.ts';
import { enqueueEmail } from '../jobs/email/enqueue.ts';
import type { EmailJobData } from '../jobs/email/types.ts';
import { logger } from '../lib/logger.ts';

const log = logger.child({ module: 'billing-admin-notices' });

export type AdminPlanChangeEvent =
  | { type: 'cancelled'; date: string }
  | { type: 'kept'; date: string }
  | { type: 'ended'; date: string };

export async function notifyCoveredTeamAdmins(
  payerUserId: string,
  event: AdminPlanChangeEvent,
): Promise<void> {
  try {
    const db0 = globalDb();
    const registries = await db0.owner_team_registry.findMany({
      where: { owner_user_id: payerUserId },
    });

    for (const reg of registries) {
      const teamId = reg.team_id;
      try {
        const client = forTeam(teamId);
        const adminMembership = await client.memberships.findFirst({
          where: { team_id: teamId, role: 'owner', removed_at: null },
          select: { user_id: true },
        });

        // Exclude if no Admin or if the Admin is the payer themselves
        if (!adminMembership || adminMembership.user_id === payerUserId) {
          continue;
        }

        const adminUserId = adminMembership.user_id;
        const dedupeKey = `billing:plan_${event.type}:${payerUserId}:${teamId}:${event.date}`;
        const category = `billing.plan_${event.type}`;

        // 1. Push notification via transactional outbox on the team's shard
        await shardTransaction(shardFor(teamId) as Shard, async (tx) => {
          await enqueueNotification(tx, {
            recipientUserId: adminUserId,
            category,
            payload: { teamId, date: event.date },
            dedupeKey,
          });
        }).catch((err: unknown) => {
          const errorCode = (err as { code?: string })?.code ?? 'OUTBOX_ERROR';
          log.warn({ errorCode, teamId, adminUserId }, 'failed to enqueue admin plan change push');
        });

        // 2. Email notice
        const adminUser = await db0.users.findUnique({
          where: { id: adminUserId },
          select: { email: true },
        });

        if (adminUser?.email) {
          let emailData: EmailJobData;
          if (event.type === 'cancelled') {
            emailData = { kind: 'billingPlanCancelled', email: adminUser.email, date: event.date };
          } else if (event.type === 'kept') {
            emailData = { kind: 'billingPlanKept', email: adminUser.email };
          } else {
            emailData = { kind: 'billingPlanEnded', email: adminUser.email };
          }

          await enqueueEmail(emailData, { dedupeKey }).catch((err: unknown) => {
            const errorCode = (err as { code?: string })?.code ?? 'EMAIL_ERROR';
            log.warn({ errorCode, teamId, adminUserId }, 'failed to enqueue admin plan change email');
          });
        }
      } catch (err: unknown) {
        const errorCode = (err as { code?: string })?.code ?? 'TEAM_NOTIFY_ERROR';
        log.warn({ errorCode, teamId }, 'failed to notify admin for team');
      }
    }
  } catch (err: unknown) {
    const errorCode = (err as { code?: string })?.code ?? 'ADMIN_NOTIFY_ERROR';
    log.warn({ errorCode, payerUserId }, 'failed to query covered teams for admin notifications');
  }
}

