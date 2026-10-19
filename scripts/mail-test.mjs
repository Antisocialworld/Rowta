#!/usr/bin/env node
// mail-test.mjs — prove nodemailer can deliver through the configured SMTP server and that the
// message arrived, using Mailpit's HTTP API (Phase 0 part B gate).
//
// What it does, in order:
//   1. loads the repo-root .env (a program loads it; nothing is printed — S2),
//   2. clears the Mailpit inbox so the check cannot pass on a stale message,
//   3. sends one message with nodemailer over SMTP using SMTP_HOST/SMTP_PORT/MAIL_FROM,
//   4. polls Mailpit's HTTP API until the message appears,
//   5. prints ONLY the subject and the recipient count (never a body, never a header value that
//      could carry a secret — S1),
//   6. deletes the message again.
//
// Usage: node scripts/mail-test.mjs
// Requires the local Docker mail catcher from docker-compose.yml to be running (container
// rowta-mail-1, SMTP :1025, HTTP API :8025).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
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
    fail(`${name} is not set. Run: node scripts/setup-env.mjs --check`);
    return null;
  }
  return value;
}

const smtpHost = requireEnv('SMTP_HOST');
const smtpPort = Number(requireEnv('SMTP_PORT') ?? '0');
const mailFrom = requireEnv('MAIL_FROM');
const mailpitUiPort = Number(requireEnv('MAILPIT_UI_PORT') ?? '0');

if (smtpHost === null || mailFrom === null || smtpPort === 0 || mailpitUiPort === 0) {
  process.exit(1);
}

const subject = `Rowta phase-0 mail test ${Date.now()}`;

// node:http with agent:false (one fresh connection per request, no keep-alive pool). fetch()'s
// undici keep-alive sockets trip a libuv assertion on Windows when the process exits immediately
// afterwards, which would make this script exit non-zero even when every check passed.
function mailpitRequest(path, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(body, 'utf8');
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: mailpitUiPort,
        path: `/api/v1${path}`,
        method,
        agent: false,
        headers: payload
          ? { 'content-type': 'application/json', 'content-length': payload.byteLength }
          : {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            contentType: String(res.headers['content-type'] ?? ''),
            text: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function mailpitJson(path, options = {}) {
  const res = await mailpitRequest(path, options);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Mailpit API ${path} returned HTTP ${res.status}`);
  }
  // Mailpit answers some calls (e.g. DELETE) with the plain body "ok"; only parse real JSON.
  if (!res.contentType.includes('json') || res.text.length === 0) return null;
  return JSON.parse(res.text);
}

async function clearInbox() {
  // DELETE /api/v1/messages with an empty IDs list clears the whole store (Mailpit server routes).
  await mailpitJson('/messages', { method: 'DELETE', body: JSON.stringify({ IDs: [] }) });
}

async function deleteMessage(id) {
  // There is no DELETE /api/v1/message/{id}; single deletes also go through /messages.
  await mailpitJson('/messages', { method: 'DELETE', body: JSON.stringify({ IDs: [id] }) });
}

async function waitForMessage(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const listing = await mailpitJson('/messages?limit=25');
    const match = listing?.messages?.find((m) => m.Subject === subject);
    if (match) return match;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

try {
  await clearInbox();
  pass('Mailpit inbox cleared before the test');

  // No auth: the local catcher accepts unauthenticated SMTP on 127.0.0.1 only.
  const transport = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    tls: { rejectUnauthorized: false }, // local catcher uses a self-signed certificate
  });

  const info = await transport.sendMail({
    from: mailFrom,
    to: 'deliverability@localhost',
    subject,
    text: 'Rowta phase-0 mail proof. This message never leaves the local mail catcher.',
  });
  pass(`nodemailer accepted the message (accepted ${Array.isArray(info.accepted) ? info.accepted.length : 0} recipient(s))`);
  await transport.close();

  const message = await waitForMessage();
  if (!message) {
    fail('the message did not appear in Mailpit within 15s');
  } else {
    const recipientCount = Array.isArray(message.To) ? message.To.length : 0;
    pass(`Mailpit received it: subject matches, ${recipientCount} recipient(s)`);
    if (recipientCount !== 1) fail(`expected exactly 1 recipient, saw ${recipientCount}`);
    await deleteMessage(message.ID);
    pass('test message deleted from Mailpit');
  }
} catch (err) {
  fail(`unexpected error: ${err?.message ?? String(err)}`);
}

say(failures === 0 ? 'MAIL TEST OK: SMTP delivery to the local catcher is working.' : `MAIL TEST FAILED: ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
