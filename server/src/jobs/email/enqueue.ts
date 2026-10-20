// Enqueue helpers for the `email` queue (rule C2: a request only enqueues; J1 defaults apply).
//
// Job IDs collapse duplicates: same kind + same target + same second = one job (skill section 3
// rules: no colon, never digits-only — jobId() enforces both).
import { fingerprint } from '../../security/fingerprint.ts';
import { getQueue, jobId } from '../queues.ts';
import type { EmailJobData } from './types.ts';

export async function enqueueEmail(data: EmailJobData): Promise<void> {
  const material = data.kind === 'welcome' ? data.userId : data.email;
  const name = `email-${data.kind}-${fingerprint(material).slice(0, 16)}`;
  await getQueue('email').add(data.kind, data, {
    jobId: jobId(name, Math.floor(Date.now() / 1000)),
  });
}
