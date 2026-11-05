// nodemailer transport built ONLY from env names (rules A13, S1, S2; skill section 5).
//
// One transporter per process with explicit connection/greeting/socket timeouts so a dead SMTP
// server fails the job instead of hanging it (C5). SMTP_USER/SMTP_PASSWORD are optional: empty
// means the connection carries no AUTH block (allowed when the provider needs none).
//
// Owner decision 22 Oct 2026: email is nodemailer over REAL SMTP; there is no local mail catcher.
// Automated tests must NEVER open an SMTP connection — under vitest the real transporter refuses
// to build (VITEST is set by the runner, so the guard holds even when .env carries real SMTP
// values), and the test suite installs the in-process capture below instead. Manual checks use
// scripts/mail-test.mjs to the owner's own address.
//
// Nothing here ever logs a message body, a code or a token — only the recipient kind and subject
// (subjects carry no secrets), and the address itself is never logged (rule S9).
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { env } from '../config/env.ts';
import { logger } from '../lib/logger.ts';

const log = logger.child({ module: 'mail' });

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  // Safety guard: automated tests never reach the network's SMTP. Throw at BUILD time so a test
  // that forgets the capture fails loudly instead of silently emailing a real server.
  if (process.env.VITEST !== undefined) {
    throw new Error(
      'mail/transport: refusing to build the real SMTP transport inside vitest — ' +
        'install the in-process capture with startMailCapture() (owner rule: tests never open SMTP)',
    );
  }
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

// ---------------------------------------------------------------------------------------------
// In-process capture (the test seam). Production never calls startMailCapture(), so production
// behaviour is unchanged: sendEmail always goes to the real transporter there.
// ---------------------------------------------------------------------------------------------

let capture: OutgoingEmail[] | null = null;

/** Tests only: record every send in process; no SMTP connection is opened while this is active. */
export function startMailCapture(): void {
  capture = [];
}

/** Tests only: empty the capture without stopping it (per-file/per-test reset). */
export function clearMailCapture(): void {
  if (capture !== null) capture.length = 0;
}

/** Tests only: stop capturing; the vitest guard still blocks the real transporter. */
export function stopMailCapture(): void {
  capture = null;
}

/** Tests only: the messages captured so far (a fresh array copy; never null). */
export function mailCaptureSnapshot(): readonly OutgoingEmail[] {
  return capture === null ? [] : [...capture];
}

/** Send one email. Throws on failure so BullMQ retries with backoff (J1). */
export async function sendEmail(message: OutgoingEmail): Promise<void> {
  if (capture !== null) {
    capture.push({ ...message });
    // Same log shape as a real send; the kind and subject carry no secret (skill 7).
    log.info({ kind: message.kind, subject: message.subject }, 'email captured (in-process)');
    return;
  }
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
