// Redaction: a fake secret logged through the app logger must never appear in the output (S9,
// skill rowta-server-foundation-recipes section 3). Uses pino's destination option so the test
// captures the same serialised line production would emit, with pretty-printing disabled.
import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { buildLoggerOptions, REDACT_PATHS } from '../src/lib/logger.ts';
import pino from 'pino';

const FAKE_SECRET = 'SUPER-SECRET-VALUE-do-not-log-9f3a';
const FAKE_TOKEN = 'tok_live_abcdefghijklmnop';
const FAKE_PASSWORD = 'hunter2-not-a-real-password';

function captureLogger() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  const log = pino(buildLoggerOptions('info'), stream);
  return { log, output: () => chunks.join('') };
}

describe('log redaction', () => {
  it('redacts a top-level password field', () => {
    const { log, output } = captureLogger();
    log.info({ password: FAKE_PASSWORD }, 'auth attempt');
    const text = output();
    expect(text).not.toContain(FAKE_PASSWORD);
    expect(text).toContain('******');
  });

  it('redacts a nested token one level down', () => {
    const { log, output } = captureLogger();
    log.info({ body: { token: FAKE_TOKEN } }, 'request body');
    const text = output();
    expect(text).not.toContain(FAKE_TOKEN);
    expect(text).toContain('******');
  });

  it('redacts the authorization header', () => {
    const { log, output } = captureLogger();
    log.info({ req: { headers: { authorization: `Bearer ${FAKE_SECRET}` } } }, 'inbound');
    const text = output();
    expect(text).not.toContain(FAKE_SECRET);
    expect(text).toContain('******');
  });

  it('redacts a secret field on a record', () => {
    const { log, output } = captureLogger();
    log.warn({ secretHash: FAKE_SECRET }, 'token record');
    expect(output()).not.toContain(FAKE_SECRET);
  });

  it('keeps ordinary fields readable', () => {
    const { log, output } = captureLogger();
    log.info({ requestId: 'req-1', status: 200, userId: 'user-abc' }, 'request');
    const text = output();
    expect(text).toContain('req-1');
    expect(text).toContain('user-abc');
    expect(text).toContain('200');
  });

  it('the redaction list is non-empty and uses the ****** censor', () => {
    expect(REDACT_PATHS.length).toBeGreaterThan(10);
    expect(buildLoggerOptions('info').redact).toMatchObject({ censor: '******' });
  });
});
