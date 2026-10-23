#!/usr/bin/env node
// mail-test.mjs — send exactly ONE email through the owner's REAL configured SMTP server
// (owner decision 22 Oct 2026: the local mail catcher is gone; manual checks use the owner's
// own provider and mailbox).
//
// What it does, in order:
//   1. loads the repo-root .env (a program loads it; nothing is printed — S2),
//   2. requires exactly ONE recipient argument (no default, no list — refuse anything else),
//   3. sends one message with nodemailer over SMTP using SMTP_HOST/SMTP_PORT/SMTP_SECURE/MAIL_FROM
//      (plus SMTP_USER/SMTP_PASSWORD when set),
//   4. prints ONLY pass/fail lines and the accepted-RECIPIENT COUNT — never a body, never a
//      header value, never a credential (S1). Provider acceptance is the script's proof; seeing
//      the message in the mailbox is the owner's.
//
// Usage: node scripts/mail-test.mjs you@example.com
// The owner runs this. Automated tests never do: they capture mail in process instead, and the
// real transporter refuses to build under vitest.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(resolve(repoRoot, '.env'));
} catch {
  // reported below via the NAME of the missing variable
}

let failures = 0;
function pass(line) {
  process.stdout.write(`PASS  ${line}\n`);
}
function fail(line) {
  failures += 1;
  process.stdout.write(`FAIL  ${line}\n`);
}
function say(line) {
  process.stdout.write(`${line}\n`);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    fail(`${name} is not set. Paste your provider's value into .env (see docs/SETUP.md section 2b).`);
    return null;
  }
  return value;
}

// ---- Exactly one recipient, given as an argument. No default, no list. --------------------------
const args = process.argv.slice(2);
if (args.length !== 1) {
  fail(`expected exactly ONE recipient argument, received ${args.length}. Usage: node scripts/mail-test.mjs you@example.com`);
  process.exit(2);
}
const recipient = args[0];
if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(recipient)) {
  fail('the recipient does not look like a single email address (no spaces, commas or semicolons allowed).');
  process.exit(2);
}

const smtpHost = requireEnv('SMTP_HOST');
const smtpPort = Number(requireEnv('SMTP_PORT') ?? '0');
const mailFrom = requireEnv('MAIL_FROM');
if (smtpHost === null || mailFrom === null || !Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
  process.exit(1);
}

const subject = `Rowta SMTP test ${new Date().toISOString()}`;

try {
  const transport = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  const info = await transport.sendMail({
    from: mailFrom,
    to: recipient,
    subject,
    text: 'Rowta SMTP proof message. Safe to delete.',
  });
  const accepted = Array.isArray(info.accepted) ? info.accepted.length : 0;
  pass(`nodemailer handed the message to the server (accepted ${accepted} recipient(s))`);
  if (accepted !== 1) fail(`expected exactly 1 accepted recipient, saw ${accepted}`);
  await transport.close();
} catch (err) {
  const inner = Array.isArray(err?.errors) ? err.errors.map((e) => e?.code ?? 'none').join(',') : 'none';
  fail(`unexpected error: code=${err?.code ?? 'none'} command=${err?.command ?? 'none'} inner=${inner} message=${err?.message || '(empty)'}`);
}

say(failures === 0 ? 'MAIL TEST OK: the SMTP server accepted the message. Check your mailbox for it.' : `MAIL TEST FAILED: ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
