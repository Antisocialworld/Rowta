// The ONE rate-limit config file (rules S14, A7, A9; skill rowta-rate-limiting-recipes section 3).
//
// One row per limiter: id, key kind, max, window, fail mode, one-line reason. Routes declare the
// limit ids they run (see src/http/routes.ts); a route without a limit id does not register, and a
// test walks the registry to prove every route has one. Values are the skill's inventory rows for
// the Phase 2 auth surface; later phases add their rows here.
//
// Fail mode: 'C' = fail closed (generic 503 when Redis is down), 'O' = fail open with a warning.

export type LimitKeyKind =
  | 'ip' // client address (socket, or X-Forwarded-For only when TRUST_PROXY_HOPS > 0)
  | 'emailHash' // blake2b512 of the NFKC, lower-cased email from the body
  | 'ipEmail' // one combined key: client address and normalised email
  | 'user' // authenticated user id (runs after authentication)
  | 'bodyToken' // blake2b512 of a token-like body field (grant, token) — never the raw value
  | 'deviceId'; // device id from the body when the client sends one

export interface LimitDef {
  readonly id: string;
  readonly key: LimitKeyKind;
  /** Body field holding the key material (bodyToken / deviceId kinds only). */
  readonly field?: string;
  readonly max: number;
  readonly windowSec: number;
  readonly failMode: 'C' | 'O';
  readonly reason: string;
}

export const LIMITS: readonly LimitDef[] = [
  // Sign-up group (skill section 3): sign up and resend share one budget.
  { id: 'signup.ip', key: 'ip', max: 10, windowSec: 3_600, failMode: 'C', reason: 'stop mass signup and email bombing' },
  { id: 'signup.email', key: 'emailHash', max: 5, windowSec: 3_600, failMode: 'C', reason: 'stop mass signup and email bombing' },

  // Code check: the stored 5 attempts guard each code (A9); this is the per-IP backstop.
  { id: 'code.ip', key: 'ip', max: 30, windowSec: 900, failMode: 'C', reason: '6-digit codes are guessable without it' },

  // Sign-in (A7): per IP, per hashed email, and per ip+email pair.
  { id: 'signin.ip', key: 'ip', max: 30, windowSec: 900, failMode: 'C', reason: 'stop guessing without locking the account' },
  { id: 'signin.email', key: 'emailHash', max: 10, windowSec: 900, failMode: 'C', reason: 'stop guessing without locking the account' },
  { id: 'signin.both', key: 'ipEmail', max: 5, windowSec: 900, failMode: 'C', reason: 'stop guessing without locking the account' },

  // Session (A11).
  { id: 'refresh.ip', key: 'ip', max: 120, windowSec: 60, failMode: 'C', reason: 'stolen-token abuse, client loops' },
  { id: 'refresh.device', key: 'deviceId', field: 'deviceId', max: 30, windowSec: 60, failMode: 'C', reason: 'stolen-token abuse, client loops' },
  { id: 'logout.user', key: 'user', max: 10, windowSec: 60, failMode: 'O', reason: 'cheap, low risk' },
  // GET /auth/me: cheap authenticated profile read for session restore (Phase 2 app views).
  { id: 'me.user', key: 'user', max: 120, windowSec: 60, failMode: 'O', reason: 'cheap profile read; fail open like logout' },
  // GET /auth/countries: public sign-up reference read (PRD 8.1 country list).
  { id: 'countries.read', key: 'ip', max: 120, windowSec: 60, failMode: 'O', reason: 'public sign-up reference read; fail open like me' },

  // Forgot group: email bombing and enumeration (the response is uniform either way, A6).
  { id: 'forgot.email', key: 'emailHash', max: 5, windowSec: 3_600, failMode: 'C', reason: 'email bombing, enumeration' },
  { id: 'forgot.ip', key: 'ip', max: 20, windowSec: 3_600, failMode: 'C', reason: 'email bombing, enumeration' },

  // Reset (set-new-password needs a grant; the window equals the grant lifetime, so "5 tries").
  { id: 'reset.ip', key: 'ip', max: 20, windowSec: 3_600, failMode: 'C', reason: 'grant guessing' },
  { id: 'reset.grant', key: 'bodyToken', field: 'grant', max: 5, windowSec: 600, failMode: 'C', reason: 'grant guessing' },

  // Magic link.
  { id: 'magicRequest.email', key: 'emailHash', max: 5, windowSec: 3_600, failMode: 'C', reason: 'email bombing' },
  { id: 'magicRequest.ip', key: 'ip', max: 20, windowSec: 3_600, failMode: 'C', reason: 'email bombing' },
  { id: 'magicConsume.ip', key: 'ip', max: 30, windowSec: 900, failMode: 'C', reason: 'token guessing' },
  { id: 'magicConsume.token', key: 'bodyToken', field: 'token', max: 10, windowSec: 3_600, failMode: 'C', reason: 'token guessing' },

  // Phase 3 — Teams, roles, invites, settings.
  { id: 'team.create', key: 'user', max: 10, windowSec: 3_600, failMode: 'C', reason: 'stop mass team creation' },
  { id: 'teams.list', key: 'user', max: 120, windowSec: 60, failMode: 'O', reason: 'cheap user teams list read' },
  { id: 'team.get', key: 'user', max: 120, windowSec: 60, failMode: 'O', reason: 'cheap team details read' },
  { id: 'members.list', key: 'user', max: 120, windowSec: 60, failMode: 'O', reason: 'cheap member roster read' },
  { id: 'member.role', key: 'user', max: 30, windowSec: 60, failMode: 'C', reason: 'member role change write' },
  { id: 'member.remove', key: 'user', max: 30, windowSec: 60, failMode: 'C', reason: 'member removal write' },
  { id: 'member.leave', key: 'user', max: 10, windowSec: 60, failMode: 'C', reason: 'leave team write' },
  { id: 'invites.list', key: 'user', max: 60, windowSec: 60, failMode: 'O', reason: 'pending invites read' },
  { id: 'invite.create', key: 'user', max: 30, windowSec: 3_600, failMode: 'C', reason: 'stop mass invites, email abuse' },
  { id: 'invite.revoke', key: 'user', max: 30, windowSec: 60, failMode: 'C', reason: 'revoke invite write' },
  { id: 'invite.accept', key: 'ip', max: 30, windowSec: 900, failMode: 'C', reason: 'stop brute force on invite tokens' },
  { id: 'team.settings', key: 'user', max: 30, windowSec: 60, failMode: 'C', reason: 'team settings update write' },

  // Phase 4 — Shifts, calendar, activity feed, search.
  { id: 'shift.read', key: 'user', max: 120, windowSec: 60, failMode: 'O', reason: 'cheap calendar and detail reads' },
  { id: 'shift.write', key: 'user', max: 30, windowSec: 60, failMode: 'C', reason: 'shift create, edit and soft-delete writes' },
  { id: 'activity.read', key: 'user', max: 120, windowSec: 60, failMode: 'O', reason: 'cheap cursor-paginated feed read' },
  { id: 'search.read', key: 'user', max: 60, windowSec: 60, failMode: 'O', reason: 'cheap team-scoped search read' },

  // Phase 5 — Swaps.
  { id: 'swap.request', key: 'user', max: 30, windowSec: 60, failMode: 'C', reason: 'swap request write' },
  { id: 'swaps.list', key: 'user', max: 120, windowSec: 60, failMode: 'O', reason: 'cheap swaps list read' },
  { id: 'swap.get', key: 'user', max: 120, windowSec: 60, failMode: 'O', reason: 'cheap swap detail read' },
  { id: 'swap.decide', key: 'user', max: 30, windowSec: 60, failMode: 'C', reason: 'swap decide (approve/reject) write' },
  { id: 'swap.cancel', key: 'user', max: 30, windowSec: 60, failMode: 'C', reason: 'swap cancel write' },
];

const BY_ID = new Map(LIMITS.map((def) => [def.id, def]));

/** Resolve a limit id, failing at registration time when a route names an unknown one. */
export function limitDef(id: string): LimitDef {
  const def = BY_ID.get(id);
  if (def === undefined) throw new Error(`unknown rate limit id "${id}" — add a row to src/security/limits.ts`);
  return def;
}
