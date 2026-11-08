// The `email` queue processor (skill rowta-notifications-email-recipes section 5; rules C2, J1, J3, A6).
//
// One processor per email kind. Each kind:
//   - loads the row it needs (the request path never did this work — "the job decides", A6),
//   - generates the code or token HERE, hashes it with Argon2id and stores only the hash (J3:
//     payloads never carry a secret; the raw value exists only inside the outgoing message),
//   - restarts the code TTL from the moment of the send (A9: a resend restarts both timers),
//   - sends through the shared transporter; a failed send throws so BullMQ retries with backoff (J1).
//
// The welcome email is guarded by `sent_emails` (UNIQUE (user_id, kind, ref)): the job claims the
// row first and sends only if the claim won; a failed send releases the claim so the retry can
// claim again (C4, skill section 7.3).
import type { Job } from 'bullmq';
import { CODE_TTL_SECONDS, MAGIC_LINK_TTL_SECONDS } from '@rowta/shared';
import { globalDb } from '../../db/clients.ts';
import { isUniqueViolation } from '../../db/errors.ts';
import { hashSecret } from '../../security/argon2.ts';
import { createTokenParts, formatToken, generateCode } from '../../security/tokens.ts';
import { sendEmail } from '../../mail/transport.ts';
import {
  inviteEmail,
  inviteUrl,
  magicLinkEmail,
  magicLinkUrl,
  moveAcceptedEmail,
  moveCancelledEmail,
  moveDeclinedEmail,
  moveExpiredEmail,
  movePaymentNeededEmail,
  moveRequestedEmail,
  moveTrialStartedEmail,
  planCancelledEmail,
  planEndedEmail,
  planKeptEmail,
  resetCodeEmail,
  signupCodeEmail,
  signupNoticeEmail,
  transferStillPayingEmail,
  welcomeEmail,
  webHomeUrl,
} from '../../mail/templates.ts';
import type { EmailJobData, EmailJobResult } from './types.ts';

const WELCOME_KIND = 'welcome';

export async function processEmailJob(job: Job<EmailJobData>): Promise<EmailJobResult> {
  const data = job.data;
  switch (data.kind) {
    case 'signupCode':
      return sendSignupCode(data.email);
    case 'signupNotice':
      return sendSignupNotice(data.email);
    case 'welcome':
      return sendWelcome(data.userId);
    case 'resetCode':
      return sendResetCode(data.email);
    case 'magicLink':
      return sendMagicLink(data.email);
    case 'teamInvite':
      return sendTeamInvite(data);
    case 'transferStillPaying':
      return sendTransferStillPaying(data);
    case 'moveRequested':
      return sendMoveRequested(data);
    case 'moveAccepted':
      return sendMoveAccepted(data);
    case 'moveDeclined':
      return sendMoveDeclined(data);
    case 'moveCancelled':
      return sendMoveCancelled(data);
    case 'moveExpired':
      return sendMoveExpired(data);
    case 'movePaymentNeeded':
      return sendMovePaymentNeeded(data);
    case 'moveTrialStarted':
      return sendMoveTrialStarted(data);
    case 'billingPlanCancelled':
      return sendBillingPlanCancelled(data);
    case 'billingPlanKept':
      return sendBillingPlanKept(data);
    case 'billingPlanEnded':
      return sendBillingPlanEnded(data);
    default: {
      const unknown: never = data;
      throw new Error(`unknown email job kind: ${JSON.stringify(unknown)}`);
    }
  }
}

async function sendTeamInvite(
  data: Extract<EmailJobData, { kind: 'teamInvite' }>,
): Promise<EmailJobResult> {
  const message = inviteEmail({
    teamName: data.teamName,
    inviterName: data.inviterName,
    role: data.role,
    inviteUrl: inviteUrl(data.token),
  });
  await sendEmail({ kind: 'teamInvite', to: data.email, ...message });
  return { kind: 'teamInvite', sent: true };
}

async function sendSignupCode(email: string): Promise<EmailJobResult> {
  const db = globalDb();
  const pending = await db.pending_signups.findUnique({ where: { email } });
  // No pending row: either the account already exists or the row is gone. Nothing changes (A6).
  if (pending === null) return { kind: 'signupCode', sent: false };

  const code = generateCode();
  const codeHash = await hashSecret(code);
  await db.pending_signups.update({
    where: { id: pending.id },
    data: { code_hash: codeHash, attempts: 0, expires_at: new Date(Date.now() + CODE_TTL_SECONDS * 1_000) },
  });

  const message = signupCodeEmail({ name: pending.display_name, code });
  await sendEmail({ kind: 'signupCode', to: email, ...message });
  return { kind: 'signupCode', sent: true };
}

async function sendSignupNotice(email: string): Promise<EmailJobResult> {
  const db = globalDb();
  const user = await db.users.findUnique({ where: { email } });
  const message = signupNoticeEmail({ name: user?.display_name ?? null });
  await sendEmail({ kind: 'signupNotice', to: email, ...message });
  return { kind: 'signupNotice', sent: true };
}

async function sendWelcome(userId: string): Promise<EmailJobResult> {
  const db = globalDb();
  // Claim first (C4). If the claim is lost the email was already sent once — skip.
  try {
    await db.sent_emails.create({ data: { user_id: userId, kind: WELCOME_KIND, ref: '' } });
  } catch (err) {
    if (isUniqueViolation(err)) return { kind: 'welcome', sent: false };
    throw err;
  }

  const user = await db.users.findUnique({ where: { id: userId } });
  if (user === null) return { kind: 'welcome', sent: false };

  try {
    const message = welcomeEmail({ name: user.display_name, webLink: webHomeUrl() });
    await sendEmail({ kind: 'welcome', to: user.email, ...message });
  } catch (err) {
    // The send failed: release the claim so the retry (J1) can claim and send again.
    await db.sent_emails
      .deleteMany({ where: { user_id: userId, kind: WELCOME_KIND, ref: '' } })
      .catch(() => undefined);
    throw err;
  }
  return { kind: 'welcome', sent: true };
}

async function sendResetCode(email: string): Promise<EmailJobResult> {
  const db = globalDb();
  const user = await db.users.findUnique({ where: { email } });
  if (user === null) return { kind: 'resetCode', sent: false };

  const code = generateCode();
  const codeHash = await hashSecret(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1_000);

  // One usable row per user (partial unique index password_resets_one_active_idx). Read then
  // update-or-insert; the INSERT race is caught by the constraint and settled by re-reading, so
  // no application-level "check then write" decides anything (C3, D2).
  const active = await db.password_resets.findFirst({ where: { user_id: user.id, consumed_at: null } });
  if (active !== null) {
    await db.password_resets.update({
      where: { id: active.id },
      data: {
        code_hash: codeHash,
        attempts: 0,
        expires_at: expiresAt,
        // A new code kills the old one and revokes any outstanding grant (all three columns
        // together: reset_grant_complete requires that).
        grant_selector: null,
        grant_verifier_hash: null,
        grant_expires_at: null,
      },
    });
  } else {
    const newest = await db.password_resets.findFirst({
      where: { user_id: user.id },
      orderBy: { created_at: 'desc' },
    });
    if (newest !== null) {
      await db.password_resets.update({
        where: { id: newest.id },
        data: {
          code_hash: codeHash,
          attempts: 0,
          expires_at: expiresAt,
          consumed_at: null,
          grant_selector: null,
          grant_verifier_hash: null,
          grant_expires_at: null,
        },
      });
    } else {
      try {
        await db.password_resets.create({
          data: { user_id: user.id, code_hash: codeHash, attempts: 0, expires_at: expiresAt },
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Another job inserted the first row a moment ago: settle on that row.
        const winner = await db.password_resets.findFirst({
          where: { user_id: user.id, consumed_at: null },
        });
        if (winner === null) throw err;
        await db.password_resets.update({
          where: { id: winner.id },
          data: {
            code_hash: codeHash,
            attempts: 0,
            expires_at: expiresAt,
            grant_selector: null,
            grant_verifier_hash: null,
            grant_expires_at: null,
          },
        });
      }
    }
  }

  const message = resetCodeEmail({ name: user.display_name, code });
  await sendEmail({ kind: 'resetCode', to: email, ...message });
  return { kind: 'resetCode', sent: true };
}

async function sendMagicLink(email: string): Promise<EmailJobResult> {
  const db = globalDb();
  const user = await db.users.findUnique({ where: { email } });
  if (user === null) return { kind: 'magicLink', sent: false };

  const parts = createTokenParts();
  const verifierHash = await hashSecret(parts.verifier);
  await db.magic_tokens.create({
    data: {
      selector: parts.selector,
      verifier_hash: verifierHash,
      user_id: user.id,
      expires_at: new Date(Date.now() + MAGIC_LINK_TTL_SECONDS * 1_000),
    },
  });

  const message = magicLinkEmail({
    name: user.display_name,
    magicLink: magicLinkUrl(formatToken(parts)),
  });
    await sendEmail({ kind: 'magicLink', to: email, ...message });
  return { kind: 'magicLink', sent: true };
}

async function sendTransferStillPaying(
  data: Extract<EmailJobData, { kind: 'transferStillPaying' }>,
): Promise<EmailJobResult> {
  const message = transferStillPayingEmail({
    name: data.name,
    team: data.team,
    from: data.from,
  });
  await sendEmail({ kind: 'transferStillPaying', to: data.email, ...message });
  return { kind: 'transferStillPaying', sent: true };
}

async function sendMoveRequested(
  data: Extract<EmailJobData, { kind: 'moveRequested' }>,
): Promise<EmailJobResult> {
  const message = moveRequestedEmail({
    team: data.team,
    from: data.from,
    date: data.date,
  });
  await sendEmail({ kind: 'moveRequested', to: data.email, ...message });
  return { kind: 'moveRequested', sent: true };
}

async function sendMoveAccepted(
  data: Extract<EmailJobData, { kind: 'moveAccepted' }>,
): Promise<EmailJobResult> {
  const message = moveAcceptedEmail({ name: data.name, team: data.team });
  await sendEmail({ kind: 'moveAccepted', to: data.email, ...message });
  return { kind: 'moveAccepted', sent: true };
}

async function sendMoveDeclined(
  data: Extract<EmailJobData, { kind: 'moveDeclined' }>,
): Promise<EmailJobResult> {
  const message = moveDeclinedEmail({ name: data.name, team: data.team });
  await sendEmail({ kind: 'moveDeclined', to: data.email, ...message });
  return { kind: 'moveDeclined', sent: true };
}

async function sendMoveCancelled(
  data: Extract<EmailJobData, { kind: 'moveCancelled' }>,
): Promise<EmailJobResult> {
  const message = moveCancelledEmail({ team: data.team, from: data.from });
  await sendEmail({ kind: 'moveCancelled', to: data.email, ...message });
  return { kind: 'moveCancelled', sent: true };
}

async function sendMoveExpired(
  data: Extract<EmailJobData, { kind: 'moveExpired' }>,
): Promise<EmailJobResult> {
  const message = moveExpiredEmail({ name: data.name, team: data.team, date: data.date });
  await sendEmail({ kind: 'moveExpired', to: data.email, ...message });
  return { kind: 'moveExpired', sent: true };
}

async function sendMovePaymentNeeded(
  data: Extract<EmailJobData, { kind: 'movePaymentNeeded' }>,
): Promise<EmailJobResult> {
  const message = movePaymentNeededEmail({ name: data.name, team: data.team });
  await sendEmail({ kind: 'movePaymentNeeded', to: data.email, ...message });
  return { kind: 'movePaymentNeeded', sent: true };
}

async function sendMoveTrialStarted(
  data: Extract<EmailJobData, { kind: 'moveTrialStarted' }>,
): Promise<EmailJobResult> {
  const message = moveTrialStartedEmail({ team: data.team, date: data.date });
  await sendEmail({ kind: 'moveTrialStarted', to: data.email, ...message });
  return { kind: 'moveTrialStarted', sent: true };
}

async function sendBillingPlanCancelled(
  data: Extract<EmailJobData, { kind: 'billingPlanCancelled' }>,
): Promise<EmailJobResult> {
  const message = planCancelledEmail({ date: data.date });
  await sendEmail({ kind: 'billingPlanCancelled', to: data.email, ...message });
  return { kind: 'billingPlanCancelled', sent: true };
}

async function sendBillingPlanKept(
  data: Extract<EmailJobData, { kind: 'billingPlanKept' }>,
): Promise<EmailJobResult> {
  const message = planKeptEmail();
  await sendEmail({ kind: 'billingPlanKept', to: data.email, ...message });
  return { kind: 'billingPlanKept', sent: true };
}

async function sendBillingPlanEnded(
  data: Extract<EmailJobData, { kind: 'billingPlanEnded' }>,
): Promise<EmailJobResult> {
  const message = planEndedEmail();
  await sendEmail({ kind: 'billingPlanEnded', to: data.email, ...message });
  return { kind: 'billingPlanEnded', sent: true };
}
