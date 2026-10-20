// nodemailer transport built ONLY from env names (rules A13, S1, S2; skill section 5).
//
// One transporter per process with explicit connection/greeting/socket timeouts so a dead SMTP
// server fails the job instead of hanging it (C5). Empty SMTP_USER/SMTP_PASSWORD is valid in
// development: the target is the local mail catcher (Mailpit). Nothing here ever logs a message
// body, a code or a token — only the recipient kind and subject (subjects carry no secrets).
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env } from '../config/env.ts';
import { logger } from '../lib/logger.ts';

const log = logger.child({ module: 'mail' });

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter !== null) return transporter;
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER.length > 0 ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return transporter;
}

export interface OutgoingEmail {
  /** Job/template kind — the only per-recipient detail the log ever sees. */
  kind: string;
  to: string;
  subject: string;
  /** Plain-text part — built FIRST so every mail client without HTML still gets the words. */
  text: string;
  html: string;
}

/** Send one email. Throws on failure so BullMQ retries with backoff (J1). */
export async function sendEmail(message: OutgoingEmail): Promise<void> {
  await getTransporter().sendMail({
    from: env.MAIL_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
  // Subject lines never contain a code, token or amount (skill 7), so logging them is safe.
  // The address itself is never logged (rule S9: personal data stays out of the logs).
  log.info({ kind: message.kind, subject: message.subject }, 'email sent');
}

/** Tests only: close the shared transporter connection pool. */
export async function closeMailTransport(): Promise<void> {
  const open = transporter;
  transporter = null;
  // nodemailer's close() is synchronous and void; a pool that is already gone must not throw
  // out of shutdown (C8).
  if (open !== null) {
    try {
      open.close();
    } catch {
      // The connection was already closed; nothing to release.
    }
  }
}
