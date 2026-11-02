// Enqueue helpers for the `email` queue (rule C2: a request only enqueues; J1 defaults apply).
//
// Job IDs collapse duplicates: same kind + same target + same second = one job (skill section 3
// rules: no colon, never digits-only — jobId() enforces both). Callers may pass an optional
// dedupeKey (such as an invite selector) so legitimate resends in the same second do not collide.
import { fingerprint } from '../../security/fingerprint.ts';
import { getQueue, jobId } from '../queues.ts';
import type { EmailJobData } from './types.ts';

export interface EnqueueEmailOptions {
  /**
   * Optional deduplication key discriminator (e.g. invite selector).
   * When provided, combined with the recipient in the fingerprint material so
   * legitimate resends within the same second do not collide with an existing job.
   */
  dedupeKey?: string;
}

export async function enqueueEmail(
  data: EmailJobData,
  options?: EnqueueEmailOptions,
): Promise<void> {
  const recipient = data.kind === 'welcome' ? data.userId : data.email;
  const material = options?.dedupeKey ? `${recipient}-${options.dedupeKey}` : recipient;
  const name = `email-${data.kind}-${fingerprint(material).slice(0, 16)}`;
  await getQueue('email').add(data.kind, data, {
    jobId: jobId(name, Math.floor(Date.now() / 1000)),
  });
}
