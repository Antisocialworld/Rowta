// Webhook handler (Task 6 + FIX-F, PRD 8.6).
// Public endpoint: verifies signature over the RAW body before parsing, inserts the provider
// event ID into webhook_events (UNIQUE), enqueues the webhook job, returns 200 fast.
// Duplicate event IDs are acknowledged and skipped (or re-enqueued if never processed).
// Unknown tx_ref, unsupported types and events for completed intents are recorded with a status
// and acknowledged, never acted on. A late 'failed' never undoes a completed intent.

import { type Context, type Hono } from 'hono';
import { globalDb } from '../db/clients.ts';
import { HttpError } from '../middleware/error.ts';
import { verifySignature } from './signature.ts';
import { WEBHOOK_SIGNATURE_HEADER, isPaymentEvent } from './webhook-constants.ts';
import { logger } from '../lib/logger.ts';

const log = logger.child({ module: 'billing-webhook' });

/** The shared webhook secret. From FLW_WEBHOOK_SECRET_HASH env; [VERIFY] replace with the provider's scheme. */
export function getWebhookSecret(): string {
  const secret = process.env.FLW_WEBHOOK_SECRET_HASH;
  if (!secret || secret.length === 0) {
    throw new HttpError(500, 'billing.webhook_secret_missing', 'Webhook secret not configured.');
  }
  return secret;
}

/** Derive a provider event id from the payload. Never returns 'unknown'. */
function providerEventId(payload: {
  event?: string;
  data?: { tx_ref?: string; amount?: number; currency?: string; status?: string; event_id?: string };
}): string {
  const eventType = payload.event ?? payload.data?.status ?? 'ignored';
  const txRef = payload.data?.tx_ref;
  if (payload.data?.event_id) return payload.data.event_id;
  if (txRef) return `${eventType}:${txRef}`;
  return `${eventType}:no-txref`;
}

/** The webhook handler: verify signature, record event, enqueue job, return 200. */
export async function webhookHandler(c: Context): Promise<Response> {
  // 1. Read the RAW body before parsing (signature is over raw bytes).
  const rawBody = await c.req.raw.text();
  const signature = c.req.header(WEBHOOK_SIGNATURE_HEADER);

  // 2. Verify signature before parsing (rule S13, exception E1).
  const secret = getWebhookSecret();
  if (!verifySignature(rawBody, signature, secret)) {
    log.warn({ route: c.req.path }, 'forged webhook signature rejected');
    throw new HttpError(422, 'billing.bad_signature', 'Invalid webhook signature.');
  }

  // 3. Parse the payload.
  let payload: {
    event?: string;
    data?: { tx_ref?: string; amount?: number; currency?: string; status?: string; event_id?: string };
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new HttpError(400, 'request.malformed', 'Webhook body is not valid JSON.');
  }

  const eventType = payload.event ?? payload.data?.status ?? 'ignored';
  const txRef = payload.data?.tx_ref ?? null;
  const providerAmount = typeof payload.data?.amount === 'number' ? payload.data.amount : null;
  const providerCurrency = typeof payload.data?.currency === 'string' ? payload.data.currency : null;
  const providerEventIdValue = providerEventId(payload);

  // 4. Dedupe: insert the provider event ID (UNIQUE constraint prevents duplicates).
  //    Catch the unique-violation and acknowledge as duplicate instead of read-then-insert.
  const db0 = globalDb();
  let existing: { status: string; event_type: string } | null = null;
  try {
    await db0.webhook_events.create({
      data: {
        provider: 'flutterwave',
        provider_event_id: providerEventIdValue,
        event_type: eventType,
        tx_ref: txRef,
        status: 'received',
      },
    });
  } catch (err) {
    // Unique violation means the event was already recorded.
    const rec = await db0.webhook_events.findUnique({
      where: { provider_provider_event_id: { provider: 'flutterwave', provider_event_id: providerEventIdValue } },
    });
    if (!rec) throw err;
    existing = { status: rec.status, event_type: rec.event_type ?? eventType };
  }

  if (existing) {
    // If the stored status is 'received' (never processed), RE-ENQUEUE (the job is idempotent).
    if (existing.status === 'received') {
      if (txRef) {
        try {
          await enqueueWebhookJob(txRef, existing.event_type, providerAmount, providerCurrency);
        } catch (err) {
          log.warn({ err, txRef }, 're-enqueue failed');
          throw new HttpError(500, 'billing.enqueue_failed', 'Webhook job could not be enqueued.');
        }
      }
    }
    log.info({ providerEventId: providerEventIdValue, event: existing.event_type }, 'duplicate webhook event acknowledged');
    return c.json({ received: true, duplicate: true }, 200);
  }

  // 5. Only successful-payment event types are enqueued; every other type is recorded as 'ignored'
  //    and acknowledged, never acted on.
  if (!isPaymentEvent(eventType)) {
    await db0.webhook_events.updateMany({
      where: { provider: 'flutterwave', provider_event_id: providerEventIdValue },
      data: { status: 'ignored', processed_at: new Date() },
    });
    return c.json({ received: true, duplicate: false, ignored: true }, 200);
  }

  // 6. Enqueue the webhook job (separate from the DB transaction — Redis is not transactional with PostgreSQL).
  if (txRef) {
    try {
      await enqueueWebhookJob(txRef, eventType, providerAmount, providerCurrency);
    } catch (err) {
      log.warn({ err, txRef }, 'webhook job enqueue failed');
      // If enqueueing fails, return 5xx so the provider retries; do not swallow it.
      throw new HttpError(500, 'billing.enqueue_failed', 'Webhook job could not be enqueued.');
    }
  }

  return c.json({ received: true, duplicate: false }, 200);
}

async function enqueueWebhookJob(
  txRef: string,
  eventType: string,
  providerAmount?: number | null,
  providerCurrency?: string | null,
): Promise<void> {
  const { getQueue } = await import('../jobs/queues.ts');
  await getQueue('webhook').add('process-webhook', {
    txRef,
    eventType,
    providerAmount,
    providerCurrency,
  });
}

/** Register the public webhook route. No auth — the signature is the authorization. */
export function registerWebhookRoute(router: Hono): void {
  router.post('/webhook', webhookHandler);
}
