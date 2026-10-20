// constants — the single place the web copy reads real product values (never invented).
// Every value cites where it comes from: PRD = .agents/PRD/PRD-001-rowta.md, OWNER = the owner's inputs of
// 20 Oct 2026, RULES = .agents/rules. Status per value is tracked in docs/legal/CLAIMS-EVIDENCE.md.
//
// NOTE (listed in docs/legal/OWNER-INPUTS.md): there is no repo-wide constants module yet (/shared holds only
// .gitkeep until Phase 2). This file is the web build's constant source; when /shared gains constants, these
// move there. The magic-link lifetime is an owner-decision conflict: OWNER wants 5 minutes, PRD/rule A13 say
// 15 minutes. The PRD was NOT edited; the web copy uses the owner's 5 minutes (PLANNED — auth not built yet).

export const C = {
  // --- contact (OWNER, 20 Oct 2026): the only contact channel, email only, no postal address ---
  contactEmail: 'rowtareply@gmail.com',

  // --- lifecycle (PRD 7.3, 8.10) ---
  accountDeletionGraceDays: 30, // PRD 8.10: cancel by signing in within 30 days
  teamRestoreDays: 30, // PRD 7.3
  shiftSoftDeleteDays: 90, // PRD 7.3
  tokenPurgeAfterExpiryDays: 7, // PRD 7.3: used/expired tokens and codes
  idempotencyKeyHours: 48, // PRD 7.3
  notificationLogDays: 30, // PRD 7.3 [DECISION: proposed, not agreed]

  // --- billing (PRD 5, 8.6) ---
  paymentGraceDays: 7, // PRD 8.6: past_due grace, notify day 0/3/6, then restricted
  starterSeatsIncluded: 5, // PRD 5: hard cap 5
  teamSeatsIncluded: 15,
  businessSeatsIncluded: 40,
  seatCeiling: 200, // PRD 5: configurable sanity ceiling (MAX_SEATS_CEILING=200 in .env.example)

  // --- auth (RULES A13 / PRD 8.1; PLANNED — server auth lands in Phase 2) ---
  magicLinkMinutes: 5, // OWNER decision (20 Oct 2026) — conflicts with PRD A13's 15 minutes; see OWNER-INPUTS.md
  accessTokenMinutes: 15, // PRD 15 defaults
  refreshTokenDays: 30, // PRD 15 defaults

  // --- people (OWNER, 20 Oct 2026; PRD 3.2) ---
  minimumAge: 16, // stated in Terms and the privacy policy; no marketing to children
};
