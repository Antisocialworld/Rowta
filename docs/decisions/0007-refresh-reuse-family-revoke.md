# 0007. Refresh-token replay: revoke the whole family and force a re-login

Date: 2026-10-20. Status: accepted. Phase 2 (PRD 8.1, rule A11).

## Context

Refresh tokens are rotating, one-time selectors (`selector.verifier`, 30-day TTL, Argon2id-hashed
verifier). When a refresh succeeds the old row is marked used and a child token is issued in the same
guarded update. A replay — someone presenting an already-used token — means one of two things: an
honest client retried a request whose response it never saw, or an attacker copied the token. The
server cannot tell which, so it must pick a safe default. Three options were on the table:

1. **Silent re-issue** (treat the replay as a lost response and mint a fresh token): keeps the honest
   client alive, but an attacker holding a stolen used token also stays alive — the theft is never
   discovered.
2. **Revoke only the replayed row**: the attacker's copy dies, but the attacker may have already
   rotated it once, so the live child they hold remains valid; the honest client is logged out anyway.
3. **Revoke the entire family** (every token descended from the same family id, attacker and honest
   child alike) **and answer 401**: both parties must sign in again; the incident is contained to one
   account's sessions and becomes visible (a forced re-login is the alarm).

## Decision

Option 3. `/auth/refresh` marks the presented token used with a guarded `UPDATE … WHERE used_at IS
NULL`; if the guard matches nothing, the handler treats it as a replay (`RotationLost`), revokes the
whole family (`family_id`), and answers the same generic 401 `auth.refresh_invalid` /
"Not authenticated." as any other invalid token — byte-identical, so the response itself reveals
nothing (A5). `logout` revokes the presented family; `logout-all` revokes every refresh token and
deletes every device row.

## Why

- A replay is treated as a compromise, not a glitch (PRD A11). Silently recovering would let a
  thief keep the session alive indefinitely.
- Revoking the family kills the attacker's *current* token too — revoking only the replayed row would
  leave a stolen-and-already-rotated child alive.
- The honest client loses its session, which is the correct cost: it proves the user still holds the
  device and makes the theft noticeable instead of invisible.
- The 401 body is the same as every other refresh failure, so probing the endpoint cannot distinguish
  "your token was revoked for reuse" from "your token expired" (A5/A6).
- Evidence: `server/tests/auth-sessions.test.ts` — rotate once, replay the used token → 401 and the
  brand-new child is dead too; cross-user tokens revoke nothing of the other user.

## What would change it

A product decision that silent recovery is acceptable for a low-risk consumer app (it is not, for a
work-scheduling tool), or a PRD change to A11. A shorter session-recovery flow (e.g. re-login that
preserves the last screen) is a UI concern and does not change this server rule.
