# 0018. Team soft deletion and ownership transfer

Date: 2026-10-30. Status: proposed (Owner Decisions; Phase 5).
Applies to `server/src/teams/`, `app/src/screens/teams/MembersScreen.tsx`, shared team types, and database schema.

## Problem

Teams currently have no mechanism for an Owner to delete a team or transfer ownership to an active colleague:
1. **Team deletion:** An Owner could not shut down or soft-delete a team. Without an explicit delete lifecycle, obsolete teams persisted indefinitely.
2. **Ownership transfer:** Teams have a strict single-owner rule (PRD Section 4: "exactly one active owner per team"). An Owner wishing to step down could not transfer ownership without violating this constraint or leaving the team orphaned.

## Decisions

### 1. Team deletion lifecycle

- **Owner-only:** Only the Owner of the team can initiate deletion. Managers and Staff receive 403 `team.forbidden`.
- **Endpoints:** One endpoint: `POST /teams/:teamId/delete`, body `{ confirmName: string }`. Project convention dictates that state-changing actions are POSTs; HTTP DELETE request bodies are unreliable across mobile network stacks, reverse proxies, and client environments.
- **Soft deletion:** Deletion sets `deleted_at = now()` and `deleted_by = callerUserId` on the `teams` row in the shard database. The row and its history are preserved.
- **Typed confirmation verified by server:** The app requires the Owner to type the exact team name into a confirmation modal (the confirm button remains disabled until it matches). The server independently verifies `confirmName === team.name`; a mismatch returns 422 `team.nameMismatch`.
- **Immediate 404:** Every team route (`/teams/:teamId/*`), roster query, shift route, swap route, activity feed, and search endpoint returns 404 `team.notFound` once `deleted_at IS NOT NULL`.
- **Cache eviction:** On successful deletion, the app immediately removes that team's query keys from TanStack Query cache, clears team selection, and resets shift navigation to avoid stale state.
- **Member notification:** Direct push/email notification to affected members is deferred to Phase 6 (worker outbox & quiet hours).
- **Migration:** Forward-only migration `040-teams-created-by-deleted-by.sql` is owner-run after database backup.

### 2. Ownership transfer

- **Owner-only:** Only the current Owner can transfer ownership.
- **Active member target:** The target must be an active member of the team (`removed_at IS NULL`) and cannot be the current Owner. An invalid or non-member target returns 422 `team.transferTargetInvalid`.
- **Single transaction:** In a single database transaction on the team's shard:
  1. The target member's role is updated to `'owner'`.
  2. The former Owner's role is updated to `'manager'`.
  3. An activity event `team.transferred` is recorded.
- **Creator attribution immutable:** `created_by` on the `teams` table remains unchanged, preserving historical attribution of who founded the team.
- **UI flow:** On the Members screen, the Owner selects "Transfer ownership", which opens a member picker dialog, followed by an explicit confirmation dialog. Non-owners never see this control.

## Consequences

- Teams can be safely decommissioned with two-layer confirmation (client and server).
- Single-owner integrity is strictly maintained during ownership transitions.
- The original team creator remains permanently recorded regardless of subsequent ownership transfers.
- No cross-database foreign keys are introduced; users reside in the global database and teams on shards.
