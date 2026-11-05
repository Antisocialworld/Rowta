// Rate limiting: one atomic Redis step per limiter, wired as route middleware
// (rules S13, S14, A7, C5; skill rowta-rate-limiting-recipes sections 1, 2, 4, 6).
//
// Counter: a small Lua script INCRs the key and sets its expiry on the first hit, returning the
// count and the remaining TTL — one round trip, atomic across every server instance, because the
// counter lives in Redis, never in process memory.
// Key text: `rl:<limitId>:<blake2b512 of the key value>` — a raw email, IP or token never appears
// in a key or a log line (S13).
// 429: catalog message, `Retry-After` header, and the same answer whether or not the account
// exists (A7). Fail mode C answers a generic 503 when Redis is down; O logs and continues.
//
// Phases (the route helper src/http/routes.ts picks them by key kind):
//   pre  — IP keys, before the body is read at all;
//   body — keys taken from the parsed body (email, grant, token, deviceId), before authentication;
//   post — user keys, after authentication set c.get('userId').
import type { Context, MiddlewareHandler } from 'hono';
import { Redis } from 'ioredis';
import { AUTH_MESSAGES, RESEND_COOLDOWN_SECONDS, normaliseEmail } from '@rowta/shared';
import { env } from '../config/env.ts';
import { logger } from '../lib/logger.ts';
import { HttpError } from '../middleware/error.ts';
import { clientIp } from './client-ip.ts';
import { fingerprint } from './fingerprint.ts';
import { limitDef, type LimitDef } from './limits.ts';

const log = logger.child({ module: 'rate-limit' });

// Re-exported for convenience: keys and key prefixes in this module and its tests use the one
// non-secret fingerprint helper (A4).
export { fingerprint } from './fingerprint.ts';

let sharedRedis: Redis | null = null;
let injectedRedis: Redis | null = null;
let sharedReady: Promise<void> | null = null;

function redis(): Redis {
  if (injectedRedis !== null) return injectedRedis;
  if (sharedRedis === null) {
    sharedRedis = new Redis(env.REDIS_URL, {
      // Fail fast on a dead Redis instead of queueing commands (fail modes C/O need the error).
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    // With the offline queue disabled, a command issued before the socket is writable fails with
    // "Stream isn't writeable" even though Redis is healthy — the lazy first use races the TCP
    // connect. Wait for readiness once per process, bounded so a dead Redis still fails fast.
    sharedReady = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 500);
      sharedRedis?.once('ready', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  return sharedRedis;
}

/** The shared client, after its first connection has settled (no wait on an injected test client). */
async function readyRedis(): Promise<Redis> {
  const client = redis();
  if (injectedRedis === null && sharedReady !== null) await sharedReady;
  return client;
}

/** Tests only: inject a client (for example one that errors) or reset to the shared one. */
export function __setRateLimitRedisForTests(client: Redis | null): void {
  injectedRedis = client;
}

/** Tests only: close the shared connection. */
export async function closeRateLimitRedis(): Promise<void> {
  const open = sharedRedis;
  sharedRedis = null;
  sharedReady = null;
  if (open !== null) await open.quit().catch(() => undefined);
}

const INCR_WITH_EXPIRE = `local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}`;

interface IncrementResult {
  count: number;
  ttl: number;
}

async function increment(def: LimitDef, keyValue: string): Promise<IncrementResult> {
  const key = `rl:${def.id}:${fingerprint(keyValue)}`;
  const reply = (await (await readyRedis()).eval(INCR_WITH_EXPIRE, 1, key, String(def.windowSec))) as unknown;
  if (!Array.isArray(reply)) throw new Error('rate limit script returned an unexpected reply');
  const [count, ttl] = reply as [unknown, unknown];
  return { count: Number(count), ttl: Number(ttl) };
}

function bodyObject(c: Context): Record<string, unknown> {
  const body = c.get('parsedBody');
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

function stringField(body: Record<string, unknown>, field: string): string | null {
  const value = body[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The raw key material for a limit (already secret-free or about to be fingerprinted).
 * Returns null when the body does not carry the field — the request then fails validation right
 * after, and limits keyed on other dimensions still ran.
 */
function keyMaterial(c: Context, def: LimitDef): string | null {
  switch (def.key) {
    case 'ip':
      return clientIp(c);
    case 'emailHash': {
      const email = stringField(bodyObject(c), 'email');
      return email === null ? null : normaliseEmail(email);
    }
    case 'ipEmail': {
      const email = stringField(bodyObject(c), 'email');
      return email === null ? null : `${clientIp(c)}|${normaliseEmail(email)}`;
    }
    case 'user': {
      const userId = c.get('userId');
      if (userId === undefined) {
        // post-auth phase without an authenticated user means a wiring bug: fail like 401 (S8).
        throw new HttpError(401, 'auth.not_authenticated', 'Not authenticated.');
      }
      return userId;
    }
    case 'bodyToken': {
      const field = def.field;
      if (field === undefined) throw new Error(`limit ${def.id} needs a field`);
      return stringField(bodyObject(c), field);
    }
    case 'deviceId':
      return stringField(bodyObject(c), 'deviceId');
  }
}

export type LimitPhase = 'pre' | 'body' | 'post';

const PHASE_OF: Record<LimitDef['key'], LimitPhase> = {
  ip: 'pre',
  emailHash: 'body',
  ipEmail: 'body',
  bodyToken: 'body',
  deviceId: 'body',
  user: 'post',
};

/** Middleware running every registered id whose key kind belongs to this phase. */
export function limitFor(ids: readonly string[], phase: LimitPhase): MiddlewareHandler {
  const defs = ids.map(limitDef).filter((def) => PHASE_OF[def.key] === phase);
  if (defs.length === 0) {
    return async (_c, next) => {
      await next();
    };
  }
  return async (c, next) => {
    for (const def of defs) {
      const material = keyMaterial(c, def); // may throw the defensive 401 above
      if (material === null) continue; // body lacks the field; schema validation rejects next
      let result: IncrementResult;
      try {
        result = await increment(def, material);
      } catch (err) {
        // Fail modes (skill section 6): C = generic 503, O = log a warning and continue.
        log.error({ limitId: def.id, failMode: def.failMode, err }, 'rate limit store unavailable');
        if (def.failMode === 'C') {
          throw new HttpError(503, 'service.unavailable', AUTH_MESSAGES['generic.error']);
        }
        continue;
      }
      if (result.count > def.max) {
        const retryAfter = Math.max(1, Math.min(result.ttl > 0 ? result.ttl : def.windowSec, def.windowSec));
        // Structured line: route, limit id, hashed key prefix. Never the raw email or IP (S13).
        log.warn(
          {
            route: c.req.routePath ?? c.req.path,
            limitId: def.id,
            keyPrefix: fingerprint(material).slice(0, 12),
            retryAfterSeconds: retryAfter,
          },
          'rate limited',
        );
        throw new HttpError(429, 'rate.limited', AUTH_MESSAGES['auth.rateLimited'], {
          'Retry-After': String(retryAfter),
        });
      }
    }
    await next();
  };
}

// ---------------------------------------------------------------------------------------------
// Resend cooldowns (A9: 60 seconds on every code request). A Redis key with the shared constant
// as TTL, checked in the request so a resend inside the window gets the SAME uniform answer and
// restarts nothing (skill rowta-testing-recipes: "a resend before 60 s is refused with the same
// answer and restarts nothing").
// ---------------------------------------------------------------------------------------------

export type CooldownFlow = 'signup' | 'reset';

function cooldownKey(flow: CooldownFlow, email: string): string {
  return `cooldown:${flow}:${fingerprint(normaliseEmail(email))}`;
}

/** Seconds left on the resend cooldown for this flow and email; 0 when none is running. */
export async function cooldownSeconds(flow: CooldownFlow, email: string): Promise<number> {
  try {
    const ttl = await (await readyRedis()).ttl(cooldownKey(flow, email));
    return ttl > 0 ? Math.min(Math.ceil(ttl), RESEND_COOLDOWN_SECONDS) : 0;
  } catch (err) {
    // Cooldown is an email-bombing brake, not an auth decision: fail open with a warning (skill 6).
    log.warn({ flow, err }, 'cooldown check unavailable; allowing resend');
    return 0;
  }
}

/** Start (or leave running) the resend cooldown. SET NX so parallel requests do not extend it. */
export async function startCooldown(flow: CooldownFlow, email: string): Promise<void> {
  try {
    await (await readyRedis()).set(cooldownKey(flow, email), '1', 'EX', RESEND_COOLDOWN_SECONDS, 'NX');
  } catch (err) {
    log.warn({ flow, err }, 'cooldown start failed');
  }
}
