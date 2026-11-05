# ADR 0012: Teams, Roles, Invites, and Sharded Data Permissions

## Status

- **Accepted (server):** every option below is implemented in `server/src/teams/`, `server/src/security/policy.ts`,
  `server/src/jobs/repair/user-team-index.ts`, and `server/prisma/sql/020-team.sql`, proven by the Phase 3 server
  suite (29 files / 248 tests / 0 failed) and the evidence in `docs/gates/phase-3.md`.
- **Screens built (Phase 3 Part B):** the team-management UI is implemented in `app/src/screens/teams/`
  (TeamListScreen, CreateTeamScreen, MembersScreen, InviteScreen, InviteResultCard) with the flow state in
  `app/src/state/teams.ts` and `app/src/state/teams-view.ts`. The two device-free scripts pass:
  `scripts/test-invite-token-lifecycle.ts` and `scripts/test-teams-store.ts` (evidence:
  `docs/gates/evidence-phase-3-part-b.txt`).
- **Phase 3 gate — split status:** the WEB half of the PRD section 12 row "invite deep link lands in the
  right team" is **PROVEN** (owner browser walkthrough 27-28 Oct 2026: Expo web on 8081 + API on 3000, two
  real accounts; token parsed from `/invite/<token>`, automatic accept, "You joined &lt;team name&gt;.",
  correct role on the Members screen, wrong-email uniform failure card, token stripped from the address bar;
  evidence `docs/gates/evidence-web-address.txt`, `app/scripts/test-web-address.ts`). The NATIVE Android half
  (`rowta://` scheme and App Link hand-off on a device) is **NOT PROVEN** — no native run yet;
  `docs/gates/phase-3.md` §4e holds the owner's walkthrough; the row can be fully flipped only after that
  passes.
- **Deviation to note:** the invite raw token is generated in the REQUEST path (`createInvite`, service.ts) and
  passed to the email job payload, unlike codes and magic-link tokens which are generated inside the email job
  (ADR 0009). The DB stores only the Argon2id verifier hash either way, and a new test now proves the raw token
  never reaches the request logs; a future hardening step should move token generation into the job.

## Context and Problem Statement
Phase 3 introduces teams, roles (owner, manager, staff), membership management, email invitations, seat capacity tracking, and team settings. Because Rowta's architecture employs database sharding (DB0 for global tables + shard 0, and DB1 for shard 1), teams and their operational data (memberships, invites, shifts) live on the designated shard determined by `shardFor(teamId)`. 

We need to resolve:
1. How team creation reliably maintains global index records (`team_directory`, `user_team_index` in DB0) alongside shard-local tables (`teams`, `memberships` on Shard 0/1) without distributed 2PC transactions.
2. How permission enforcement is structured to guarantee "deny by default" and dynamic role checking on every request without token-cached roles (Rule S8).
3. How invite tokens are stored, validated, and looked up across shards securely while preventing account existence leakage (Rules A3, A6, A7).
4. How seat capacity and concurrent acceptances are serialized.

## Considered Options
- **Option 1**: Distributed transactions via two-phase commit (2PC) across DB0 and shard databases.
- **Option 2**: Shard-authoritative writes with synchronous DB0 index writes and daily idempotent reconciliation job (`repair-user-team-index`), pure data permission matrix evaluated on every request, selector.verifier invite tokens with cross-database search, and row-level locking (`FOR UPDATE`) for seat caps.

## Decision Outcome
Chosen **Option 2**.

### 1. Cross-Database Team Creation and Reconciliation
- Team creation starts with an Idempotency-Key header scoped to `create_team:<userId>` with fingerprinting on `['name']`.
- In one transaction on the team's shard, `teams` and `memberships` (role: owner) rows are created.
- Immediately following, `team_directory` and `user_team_index` are written to DB0.
- Should a network failure or process termination happen in the microscopic window between shard write and DB0 write, the daily `repair-user-team-index` cron job (scheduled at 03:30 UTC per PRD 8.11) inspects all active memberships across all shards, restores missing directory and index rows, and removes stale index orphans.

### 2. Permissions Engine as Pure Data (Rule S6, S8)
- A central `can(user, membership, action, resource)` policy engine evaluates requests against `PERMISSION_MATRIX` structured as a data table (PRD section 4), never ad-hoc procedural if-chains.
- The membership is loaded from the shard on every single request; roles are never cached in JWT claims or session indexes (Rule S8). Demotion or removal takes effect on the very next HTTP call.
- Any request lacking an explicit `teamId` throws immediately in data access (Rule S7). Cross-team resource access returns 404 `team.notFound`, never 403, preventing existence leakage.

### 3. Selector.Verifier Invites and Uniform Responses (Rules A3, A6, A7)
- Invite links use `<selector>.<verifier>`. The database stores only the selector and the Argon2id hash of the verifier (`verifier_hash`).
- When an invite is accepted via `/invites/accept`, the backend inspects both DB0 and DB1 for the selector. If the selector is not found or verifier is malformed, a dummy Argon2id verification (`getDummyHash()`) runs against a pre-warmed decoy hash, ensuring timing parity with the valid path (Rule A7).
- If the accepting account email does not match the invited email, or if the invite is expired/revoked/reused, the server returns the identical error code `auth.link.invalid` (Owner Decision 2, Rule A6).
- Resending an invitation replaces the previous open invite for that `(team_id, email)` pair to satisfy the `invites_one_open_idx` database constraint.

### 4. Seat Cap and Concurrency Control (Owner Decision 1)
- Teams on Starter tier (no active subscription row) have a hard seat cap of 5 non-owner seats (owner does not count).
- Both invite creation (`/teams/:teamId/invites`) and invite acceptance (`/invites/accept`) execute inside transactions with row locks (`SELECT ... FOR UPDATE` on team and invites) to ensure that concurrent accepts serialize and cannot breach the seat limit. In race conditions, exactly one accept succeeds (HTTP 200) and concurrent surplus accepts fail with HTTP 422 `team.seatLimit`.
