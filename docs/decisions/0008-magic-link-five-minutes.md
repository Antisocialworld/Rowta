# 0008. Magic-link lifetime is 5 minutes (owner override of PRD A13's 15)

Date: 2026-10-20. Status: accepted (owner decision, 20 Oct 2026). Phase 2 (PRD 8.1 / A13).

## Context

PRD section 8.1 (A13) states the magic sign-in link lives 15 minutes. The owner reviewed this during
the Phase 2 build and chose **5 minutes** instead: the link is a bearer credential that signs the
holder straight in, it travels by email, and a password-reset code — the same class of secret —
already lives only 5 minutes (A9). 15 minutes is a long window for an unattended inbox.

## Decision

`MAGIC_LINK_TTL_SECONDS = 300` in `shared/src/constants.ts`, the single definition imported by the
server (token creation and the consume check) and by the email templates (the "expires in 5 minutes"
wording). The email text and the token row's `expires_at` can never disagree because both read the
same constant. The PRD text is not edited; this ADR is the deviation record.

## Why

- Owner decision beats PRD default (the owner's call is final; rule P).
- Consistency with A9: every short email-borne secret (code, magic link) lives 5 minutes; the
  long-lived secrets are the ones the device holds itself (15-minute access token, 30-day refresh
  token — A11).
- One constant, two consumers (check + copy) means the email cannot claim a different lifetime than
  the server enforces.
- Evidence: `server/tests/auth-reset-magic.test.ts` — the email says "The link expires in 5 minutes
  and works once."; an expired token fails with the same generic 401 body as a used one.

## What would change it

The owner changing their mind (one constant + the matching template assertion), or a PRD revision
that supersedes the override. A per-team TTL is deliberately not offered: a shorter universal window
is simpler and safer than a configurable one.
