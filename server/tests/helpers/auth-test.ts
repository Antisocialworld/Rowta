// Shared infrastructure for the Phase 2 auth tests (skill rowta-testing-recipes).
//
// Everything here talks to the REAL local Docker stack: PostgreSQL via src/db/clients.ts, Redis
// via src/jobs/queues.ts, the email queue through an in-process Worker running the SAME
// processEmailJob the real worker registers, and Mailpit over its HTTP API (never a fake mailbox).
//
// Country fixture: `currencies`/`countries` ship EMPTY by design (010-global.sql line 4; PRD 5 Q12
// seeds them from cited sources in the payments phase). Sign-up checks membership in `countries`
// (PRD 8.1), so these tests create their own ZZZ/ZZ rows — codes that appear in NO selftest and NO
// future ISO seed — and leave them for later runs to reuse (upsert). Users created by tests are
// deleted in teardown where the foreign keys allow it.
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { Worker } from 'bullmq';
import { createApp } from '../../src/index.ts';
import { env } from '../../src/config/env.ts';
import { logger } from '../../src/lib/logger.ts';
import { closeAllQueues, createRedisConnection } from '../../src/jobs/queues.ts';
import { closeAllDatabases, globalDb } from '../../src/db/clients.ts';
import { closeMailTransport } from '../../src/mail/transport.ts';
import { closeRateLimitRedis } from '../../src/security/rate-limit.ts';
import { processEmailJob } from '../../src/jobs/email/processor.ts';
import type { EmailJobData } from '../../src/jobs/email/types.ts';
import { hashSecret } from '../../src/security/argon2.ts';

export const TEST_CURRENCY = 'ZZZ';
export const TEST_COUNTRY = 'ZZ';
/** A formatted country that is NOT in the table: membership failures (PRD 8.1). */
export const ABSENT_COUNTRY = 'XX';

/** One Redis connection per test file (vitest gives each file a fresh module registry). */
export const redis = createRedisConnection(false);

/** A fresh full-stack app: real middleware order, real limits, real handlers. */
export function testApp(label: string): Hono {
  return createApp({ log: logger.child({ test: label }), redis });
}

/** POST JSON and return the raw Response (callers assert status, headers and body themselves). */
export async function post(
  app: Hono,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** JSON body typed as the success envelope; tests narrow further where needed. */
export async function dataOf(res: Response): Promise<Record<string, unknown>> {
  const body = (await res.json()) as { data: Record<string, unknown> };
  return body.data;
}

/** The error envelope (PRD 9.3). Accepts a Response OR an already-read body text, so tests can
 * both parse the error and compare the raw bytes without consuming the body twice. */
export async function errorOf(res: Response | string): Promise<{ code: string; message: string; requestId: string; fields?: Record<string, string> }> {
  const text = typeof res === 'string' ? res : await res.text();
  const body = JSON.parse(text) as { error?: { code: string; message: string; requestId: string; fields?: Record<string, string> } };
  return body.error ?? { code: '', message: '', requestId: '' };
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 12)}@example.test`;
}

/**
 * Serialise a response body with the requestId blanked, so two failures can be compared
 * BYTE for BYTE (A5/A6 uniformity: nothing but the request id may differ).
 */
export async function bodyWithoutRequestId(res: Response): Promise<string> {
  const text = await res.text();
  return text.replace(/"requestId":"[^"]*"/, '"requestId":"<id>"');
}

// ---------------------------------------------------------------------------------------------
// Rate-limit and cooldown keys: each auth file starts with a clean budget (the in-process IP is
// shared, so a previous file's consumption would otherwise bleed into this one).
// ---------------------------------------------------------------------------------------------

export async function clearRateKeys(): Promise<void> {
  const keys = [...(await redis.keys('rl:*')), ...(await redis.keys('cooldown:*'))];
  if (keys.length > 0) await redis.del(keys);
}

// ---------------------------------------------------------------------------------------------
// Country fixture (see header)
// ---------------------------------------------------------------------------------------------

export async function ensureTestCountries(): Promise<void> {
  const db = globalDb();
  await db.currencies.upsert({
    where: { code: TEST_CURRENCY },
    create: { code: TEST_CURRENCY, name: 'Test currency', minor_unit: 2, provider_supported: true, enabled: true },
    update: {},
  });
  await db.countries.upsert({
    where: { code: TEST_COUNTRY },
    create: { code: TEST_COUNTRY, name: 'Test country', currency: TEST_CURRENCY },
    update: {},
  });
}

/**
 * Best-effort teardown: remove the users this run created (their child rows cascade), then the
 * fixture rows. Foreign keys may block a wipe mid-run; the fixture survives and the next run
 * reuses it, which is exactly what upsert is for.
 */
export async function cleanupTestCountries(): Promise<void> {
  try {
    const db = globalDb();
    await db.users.deleteMany({ where: { country: TEST_COUNTRY } });
    // pending_signups.country also references countries (010-global.sql); a signup that was never
    // verified leaves its row behind and would block the fixture delete below.
    await db.pending_signups.deleteMany({ where: { country: TEST_COUNTRY } });
    await db.countries.deleteMany({ where: { code: TEST_COUNTRY } });
    await db.currencies.deleteMany({ where: { code: TEST_CURRENCY } });
  } catch {
    // A row is still referenced; leave the fixture in place (harmless, never ISO-sold).
  }
}

// ---------------------------------------------------------------------------------------------
// In-process email worker: the SAME processor src/worker/index.ts registers (C2 end to end).
// ---------------------------------------------------------------------------------------------

export async function startEmailWorker(): Promise<Worker> {
  const connection = createRedisConnection(true);
  const worker = new Worker<EmailJobData>('email', (job) => processEmailJob(job), {
    connection,
    lockDuration: 30_000,
  });
  await new Promise<void>((resolve, reject) => {
    const onReady = () => {
      worker.off('error', onError);
      resolve();
    };
    const onError = (err: Error) => {
      worker.off('ready', onReady);
      reject(err);
    };
    worker.once('ready', onReady);
    worker.once('error', onError);
  });
  return worker;
}

// ---------------------------------------------------------------------------------------------
// Mailpit HTTP API (local mail catcher): tests read the REAL delivered message.
// ---------------------------------------------------------------------------------------------

const MAILPIT = `http://127.0.0.1:${env.MAILPIT_UI_PORT}`;

interface MailpitSummary {
  ID: string;
  Subject: string;
  To: unknown;
}

interface MailpitFull {
  ID: string;
  Subject: string;
  Text: string;
  HTML: string;
}

export async function mailpitClear(): Promise<void> {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });
}

export async function mailpitSummaries(): Promise<MailpitSummary[]> {
  const res = await fetch(`${MAILPIT}/api/v1/messages?limit=100`);
  const body = (await res.json()) as { messages?: MailpitSummary[] };
  return body.messages ?? [];
}

function addressesOf(entry: unknown): string[] {
  if (typeof entry === 'string') return [entry];
  if (Array.isArray(entry)) {
    return entry.flatMap((one) => {
      if (typeof one === 'string') return [one];
      const address = (one as { Address?: unknown }).Address;
      return typeof address === 'string' ? [address] : [];
    });
  }
  return [];
}

function deliveredTo(summary: MailpitSummary): string[] {
  return addressesOf(summary.To).map((a) => a.toLowerCase());
}

/** How many messages were delivered to `address` (optionally with an exact subject). */
export async function countMailTo(address: string, subject?: string): Promise<number> {
  const summaries = await mailpitSummaries();
  return summaries.filter(
    (s) => deliveredTo(s).includes(address.toLowerCase()) && (subject === undefined || s.Subject === subject),
  ).length;
}

/** Wait until a message for `address` (optionally subject) is in Mailpit, then return it in full. */
export async function waitForMail(address: string, subject?: string, timeoutMs = 15_000): Promise<MailpitFull> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const summaries = await mailpitSummaries();
    const match = summaries.find(
      (s) => deliveredTo(s).includes(address.toLowerCase()) && (subject === undefined || s.Subject === subject),
    );
    if (match !== undefined) {
      const res = await fetch(`${MAILPIT}/api/v1/message/${match.ID}`);
      return (await res.json()) as MailpitFull;
    }
    if (Date.now() > deadline) {
      const seen = summaries.map((s) => `${s.Subject}<${deliveredTo(s).join(',')}>`).join(' | ');
      throw new Error(`no Mailpit message for ${address} (subject ${subject ?? '*'}) within ${timeoutMs}ms; saw: ${seen}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

// ---------------------------------------------------------------------------------------------
// Direct users (no HTTP, no rate-limit budget): for flows whose focus is NOT sign-up.
// ---------------------------------------------------------------------------------------------

export async function createVerifiedUser(
  email: string,
  password: string,
  options: { verified?: boolean; status?: string } = {},
): Promise<string> {
  const db = globalDb();
  const user = await db.users.create({
    data: {
      email,
      display_name: 'Fixture User',
      country: TEST_COUNTRY,
      password_hash: await hashSecret(password),
      email_verified_at: options.verified === false ? null : new Date(),
      ...(options.status === undefined
        ? {}
        : {
            status: options.status,
            // users_pending_needs_time: a pending_deletion row must carry the request time.
            ...(options.status === 'pending_deletion' ? { deletion_requested_at: new Date() } : {}),
          }),
    },
  });
  return user.id;
}

// ---------------------------------------------------------------------------------------------
// Whole-file teardown shared by every auth test file.
// ---------------------------------------------------------------------------------------------

export async function shutdownAuthTest(worker?: Worker): Promise<void> {
  await worker?.close().catch(() => undefined);
  await closeAllQueues();
  // The limiter and the SMTP transport hold module-level connections of their own; each test file
  // gets a fresh module registry, so close them here or the worker process would keep them open.
  await closeRateLimitRedis();
  await closeMailTransport();
  await redis.quit().catch(() => undefined);
  await cleanupTestCountries();
  await closeAllDatabases();
}
