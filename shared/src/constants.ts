// Shared timing and policy constants (rules A8, A9, A10, A11, A13; PRD 8.1, 15).
//
// ONE definition per value, imported by the server (validation, TTLs), the email texts (expiry
// minutes) and the app (countdowns), so the three can never drift apart (A9).
export const CODE_TTL_SECONDS = 300; // A9: every 6-digit code lives 5 minutes.
export const RESEND_COOLDOWN_SECONDS = 60; // A9: resend cooldown on every code request.
export const CODE_MAX_ATTEMPTS = 5; // A9: 5 wrong attempts, then the code is dead.

// Magic link. Rule A13 and PRD 8.1 say 15 minutes; the owner decided 5 minutes (20 Oct 2026) and
// asked for the value to live in one shared constant. Recorded in docs/decisions/0008-*.
export const MAGIC_LINK_TTL_SECONDS = 300;

export const RESET_GRANT_TTL_SECONDS = 600; // A10: a verified code yields a 10-minute grant.
export const ACCESS_TOKEN_TTL_SECONDS = 900; // A11: access token 15 minutes.
export const REFRESH_TOKEN_TTL_SECONDS = 2_592_000; // A11: refresh token 30 days.

export const PASSWORD_MIN_LENGTH = 8; // A8: owner rule.
export const PASSWORD_MAX_LENGTH = 128; // A8: a giant input must not burn CPU.
export const DISPLAY_NAME_MIN_LENGTH = 1; // V8
export const DISPLAY_NAME_MAX_LENGTH = 60; // V8

export const INVITE_TTL_SECONDS = 7 * 24 * 3_600; // 7 days (PRD 8.2, skill rowta-teams-roles-recipes 3)
export const STARTER_SEAT_CAP = 5; // Starter includes up to 5 non-owner seats (PRD 5, Owner Decision 1)
export const TEAM_NAME_MIN_LENGTH = 1;
export const TEAM_NAME_MAX_LENGTH = 80;
