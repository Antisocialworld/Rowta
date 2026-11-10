// Structured logger (skill rowta-server-foundation-recipes section 3, rule S9).
//
// One redaction list, applied by pino at serialisation time (pino redaction is init-time config
// only and the paths are case-sensitive: https://github.com/pinojs/pino/blob/master/docs/redaction.md).
// Censor is the literal ****** everywhere. pino-pretty is development-only; production gets plain
// JSON on stdout so a log collector can parse it.
import pino, { type Logger, type LoggerOptions } from 'pino';
import { env } from '../config/env.ts';

export type AppLogger = Logger;

/**
 * Anything that could carry a credential, a one-time code or a token. Top-level names cover flat
 * objects; `*.` covers one nesting level (bodies, record fields); the explicit req/res/err paths
 * cover HTTP shapes. Never add a name that would redact something a human needs to debug.
 */
export const REDACT_PATHS: readonly string[] = [
  // flat fields
  'password',
  'newPassword',
  'currentPassword',
  'code',
  'token',
  'refreshToken',
  'secret',
  'secretHash',
  'selector',
  'verifier',
  // one level down (request bodies, record fields, job payloads)
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.code',
  '*.token',
  '*.refreshToken',
  '*.secret',
  '*.secretHash',
  '*.selector',
  '*.verifier',
  // HTTP shapes
  'headers.authorization',
  'headers.cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'req.body.password',
  'req.body.newPassword',
  'req.body.currentPassword',
  'req.body.code',
  'req.body.token',
  'res.headers["set-cookie"]',
  'err.config.headers.authorization',
] as const;

export function buildLoggerOptions(level: string): LoggerOptions {
  return {
    level,
    redact: { paths: [...REDACT_PATHS], censor: '******' },
    serializers: { err: pino.stdSerializers.err },
    base: { service: 'rowta-server' },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
}

export function buildLogger(overrides: { level?: string; pretty?: boolean } = {}): AppLogger {
  const level = overrides.level ?? env.LOG_LEVEL;
  const options = buildLoggerOptions(level);
  const pretty = overrides.pretty ?? env.NODE_ENV !== 'production';
  if (!pretty) return pino(options);
  return pino({
    ...options,
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,service' },
    },
  });
}

/** The process-wide server logger. Entry points may replace it once with a child logger. */
export const logger: AppLogger = buildLogger();
