---
name: rowta-teams-roles-recipes
description: "Use when building Rowta teams, roles and invites: creating a team on its shard, memberships and the single owner, the central permission matrix, invite creation and acceptance with seat checks, deep links and web fallback, role changes, member removal and team switching."
---

# rowta-teams-roles-recipes

Part of the Rowta method. Scope: PRD 4, 5, 8.2, 8.10; rules S6 to S8, D2, D7, C3, A3, A6. Details marked [VERIFY] or [OPEN] must be confirmed.
Code here is a PATTERN: check every library call against current documentation [VERIFY] before using it, and never paste real secrets (rule S1).

## 1. Permission matrix as data
Encode PRD section 4 once as a table (action by role) used by BOTH the central `can` function (see `rowta-server-foundation-recipes`) and the generated permission tests (see `rowta-testing-recipes`). Manager invite and remove rights are limited to staff [DECISION]. Change a member's role: Owner only. Delete or restore the team: Owner only.

## 2. Create a team
Inside the team's shard in ONE transaction: insert `teams`, insert the creator's `memberships` row with role `owner` (the partial unique index allows exactly one active owner per team, D2). Then register `team_directory` and `user_team_index` in DB0. These two writes cannot share a transaction with the shard (D7), so order them so a crash leaves something the `repair-user-team-index` job can fix, and test a simulated crash between them. OPEN (P4): the PRD does not say what plan or subscription state a new team starts in (for example Starter, active, no payment until the owner upgrades). Propose the options and ask the owner before building Phase 7; do not choose silently.

## 3. Create invites (A3, A6)
Owner, or Manager for staff only. Rate-limited. Token is `selector.verifier` (recipe 3.2), valid 7 days, single use, role fixed at creation. Email is a job. The inviter ALWAYS sees "Invitation sent." whether or not the email already has an account. On Starter the server stops issuing invites when active non-owner members plus pending invites reach 5.

## 4. Accept an invite (C3)
One transaction on the shard: lock the invite row and the subscription row, re-check the token is unused and unexpired, count seats (active non-owner memberships; owner is not a seat), enforce the plan cap (Starter hard cap; Team and Business create a billable extra seat past the included seats), insert the membership (UNIQUE team and user), mark the invite accepted, write the activity event, then update `user_team_index`. Two simultaneous accepts at the last seat: exactly one wins (race test).
No account yet: the app shows `signUp` first and resumes the invite afterwards (U1). A removed member re-added clears `removed_at` instead of inserting a duplicate.

## 5. Deep links
`rowta://invite/<token>` opens the app and sets the AuthGate view (U1); the web fallback page `/invite/:token` (see `rowta-web-metadata`) is `noindex`. Prefer verified Android App Links over the custom scheme where possible [VERIFY]; tokens are single use and short-lived either way.

## 6. Roles and removal
Role changes and removals apply on the NEXT request because the role is read from `memberships` each time (S8). Removing a member sets `removed_at` (soft), frees the seat at once, and revokes nothing else. The only owner cannot be removed, demoted or leave: the server answers with the catalog message for deleting or transferring the team (ownership transfer is out of scope).

## 7. Team switch and scoping
"My teams" reads `user_team_index` in DB0 then asks each shard. Every team route carries the team ID and the policy function checks membership; a non-member gets 404 with the same body as a missing team (S7).

## 8. Tests (Phase 3 gate)
Every matrix cell with a raw HTTP client; team isolation on every route; Starter cannot invite or accept a sixth non-owner seat; invite single use and expiry; last-seat race; demotion takes effect on the next request; invite deep link lands in the right team.

## 9. Mistakes to avoid
Role stored on the token or index; an ad hoc role check in a route; counting the owner as a seat; check-then-insert for seats; showing a different message when the invited email has an account.
