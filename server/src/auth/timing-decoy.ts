// Timing decoys for the unknown-email failure branches (rule A7; ADR 0010 escalation run).
//
// ADR 0010's zero-row mirror equalised the attempts guard's ROUND TRIP but not its WRITE COST: on
// this machine a matched-row UPDATE (WAL + heap) measured ~11-13 ms while the random-id UPDATE
// matched nothing (~3.5 ms). As the Argon2id baseline shrank (the gate recorded ~52 ms pairs, later
// runs ~40 ms) that fixed gap grew from a 1.17 to a ~1.24 ratio — and jitter pushed a pair past the
// strict 1.25 assertion the owner refused to weaken. The owner's reserved escalation (BUILD-PROGRESS,
// 20 Oct 2026: "escalate to seeded decoy-row writes only if still >1.25, never weaken silently")
// therefore runs here: one seeded row per guard table — `pending_signups`, `password_resets`, plus
// the `users` row the reset row's FK needs — so the unknown branch's guard UPDATE matches ONE row
// and pays the identical write cost as the known path.
//
// Why these rows can never leak, collide with real data or be reached by a user flow:
//   - the emails carry no '@', and every API input validates through the shared emailField
//     (z.email()): no request can name them (A7: unreachable by any user flow);
//   - they hold no personal data — a constant display name, one random Argon2id hash per seed run
//     never verified against anything, expiry year 2099 (no cleanup job targets these tables);
//   - the guard's `SET attempts = CASE …` cycles 0-4 inside `WHERE attempts < 5`, so the counter
//     "resets by the server" inside the SAME single statement and the row always matches;
//   - `countries` ships EMPTY by design and `users`/`pending_signups` require a country: while no
//     country exists, no real row can exist either, so there is no known path to compare against
//     and the seed returns null — the caller falls back to ADR 0010's random-id mirror.
//
// Seeded lazily on the first unknown probe, memoised per process, idempotent
// (INSERT … ON CONFLICT (id) DO NOTHING) — safe across the sequential test files, concurrent
// probes and the separate worker process.
import { randomBytes } from 'node:crypto';
import { globalDb } from '../db/clients.ts';
import { logger } from '../lib/logger.ts';
import { hashSecret } from '../security/argon2.ts';

export type TimingDecoys = { pendingId: string; resetId: string };

const DECOY_USER_ID = 'de0ce0de-0000-4000-8000-000000000001';
const DECOY_PENDING_ID = 'de0ce0de-0000-4000-8000-000000000002';
const DECOY_RESET_ID = 'de0ce0de-0000-4000-8000-000000000003';
/** No '@': every API email field (z.email()) rejects it, so no user flow can ever reach the row. */
export const DECOY_USER_EMAIL = 'rowta-timing-decoy-user';
export const DECOY_PENDING_EMAIL = 'rowta-timing-decoy-pending';
const DECOY_DISPLAY_NAME = 'Rowta timing decoy';
const DECOY_EXPIRES_AT = new Date('2099-12-31T23:59:59.000Z');

let cached: TimingDecoys | null = null;
let inflight: Promise<TimingDecoys | null> | null = null;

async function seed(): Promise<TimingDecoys | null> {
  const db = globalDb();
  const country = await db.countries.findFirst({ orderBy: { code: 'asc' }, select: { code: true } });
  if (country === null) return null;
  const hash = await hashSecret(randomBytes(32));
  await db.$executeRaw`
    INSERT INTO users (id, email, display_name, country, password_hash, email_verified_at)
    VALUES (${DECOY_USER_ID}, ${DECOY_USER_EMAIL}, ${DECOY_DISPLAY_NAME}, ${country.code}, ${hash}, now())
    ON CONFLICT (id) DO NOTHING`;
  await db.$executeRaw`
    INSERT INTO pending_signups (id, email, display_name, country, password_hash, code_hash, attempts, expires_at)
    VALUES (${DECOY_PENDING_ID}, ${DECOY_PENDING_EMAIL}, ${DECOY_DISPLAY_NAME}, ${country.code}, ${hash}, ${hash}, 0, ${DECOY_EXPIRES_AT})
    ON CONFLICT (id) DO NOTHING`;
  await db.$executeRaw`
    INSERT INTO password_resets (id, user_id, code_hash, attempts, expires_at)
    VALUES (${DECOY_RESET_ID}, ${DECOY_USER_ID}, ${hash}, 0, ${DECOY_EXPIRES_AT})
    ON CONFLICT (id) DO NOTHING`;
  return { pendingId: DECOY_PENDING_ID, resetId: DECOY_RESET_ID };
}

/**
 * The decoy ids for this process's unknown-email branches — or null when the seed cannot run
 * (no country row yet, or a database error), in which case the caller falls back to the random-id
 * mirror. Success is memoised; null and errors are not, so the next probe retries.
 */
export function timingDecoys(): Promise<TimingDecoys | null> {
  if (cached !== null) return Promise.resolve(cached);
  inflight ??= seed()
    .then((ids) => {
      inflight = null;
      if (ids !== null) cached = ids;
      return ids;
    })
    .catch((err: unknown) => {
      inflight = null;
      logger.warn({ err }, 'timing decoy seed failed; using the random-id mirror');
      return null;
    });
  return inflight;
}
