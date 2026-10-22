// Owner rule 22 Oct 2026: automated tests must NEVER open an SMTP connection — even when .env
// carries real provider values. Two proofs, no network in either:
//   1. with the capture OFF, sendEmail must reach the real-transporter path and THROW (the
//      guard in src/mail/transport.ts checks VITEST before it would build anything), and
//   2. with the capture ON, the message is recorded in process and no transporter is built.
// The guard lives in getTransporter() itself, so it holds no matter what .env contains.
import { afterEach, describe, expect, it } from 'vitest';
import { mailCaptureSnapshot, sendEmail, startMailCapture, stopMailCapture } from '../src/mail/transport.ts';

const MESSAGE = {
  kind: 'guard-test',
  to: 'captured@example.test',
  subject: 'A subject with no digits',
  text: 'body text',
  html: '<p>body text</p>',
};

describe('mail transport safety (tests never open SMTP)', () => {
  afterEach(() => {
    // Leave the module capturing, as the auth helpers expect when this file is done.
    startMailCapture();
  });

  it('without a capture, building the real SMTP transport throws under vitest', async () => {
    stopMailCapture();
    await expect(sendEmail(MESSAGE)).rejects.toThrow(/refusing to build the real SMTP transport/);
    expect(mailCaptureSnapshot()).toHaveLength(0);
  });

  it('with the capture installed, the message is recorded in process and nothing else runs', async () => {
    startMailCapture();
    await sendEmail(MESSAGE);
    const sent = mailCaptureSnapshot();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.kind).toBe('guard-test');
    expect(sent[0]?.to).toBe('captured@example.test');
    expect(sent[0]?.subject).toBe(MESSAGE.subject);
    expect(sent[0]?.text).toBe('body text');
    expect(sent[0]?.html).toBe('<p>body text</p>');
  });

  it('clear empties the capture without stopping it (per-test reset)', async () => {
    startMailCapture();
    await sendEmail(MESSAGE);
    const { clearMailCapture } = await import('../src/mail/transport.ts');
    clearMailCapture();
    expect(mailCaptureSnapshot()).toHaveLength(0);
    await sendEmail(MESSAGE);
    expect(mailCaptureSnapshot()).toHaveLength(1);
  });
});
