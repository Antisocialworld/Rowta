# 0017. Role clarity on team cards and shift creator attribution (D8, D9)

Date: 2026-10-28. Status: accepted (Owner Decisions D8 & D9; Phase 5 UX pass).
Applies to `TeamListScreen.tsx`, `ShiftDetailScreen.tsx`, shared shift types, and server shift routes.

## Problem

1. **Role ambiguity on team selection (Owner Decision D8):**
   The team card previously rendered a bare badge with the user's role ("Owner", "Manager", "Staff"). The bare word "Owner" created confusion among users, implying company-wide ownership rather than ownership of the specific team created.
2. **Missing shift attribution (Owner Decision D9):**
   The shift details screen displayed the assignee but omitted the creator of the shift. Knowing who created a shift is critical for operational trust and team accountability.

## Decisions

### 1. Plain-language team role descriptions (D8)

On the "Your teams" screen (`TeamListScreen.tsx`), each team card displays the signed-in user's role in that specific team using unambiguous phrasing placed directly beneath the team name:
- `"Owner of this team"` (`team.role.owner`)
- `"Manager of this team"` (`team.role.manager`)
- `"Staff in this team"` (`team.role.staff`)

Implemented via pure helper `teamRoleKey` in `app/src/lib/team-role.ts` and catalog strings in `app/src/i18n/en.ts`. Roster badges on other screens (`MembersScreen`, `InviteScreen`, `SearchScreen`) remain unchanged as they designate member ranks within team rosters rather than personal account permissions.

### 2. Shift creator attribution (D9)

On the shift details screen (`ShiftDetailScreen.tsx`), shift creator information is displayed as:
- `"Created by {name} ({role})"` when the creator is an active member of the team.
- `"Created by {name}"` if the creator is no longer a member of the team (`role: null`).

**Security and Privacy Rules:**
- **No email addresses:** Creator information contains display name only. Creator email is never included in the payload or rendered on the screen (conforming with the privacy boundary where Staff seeing member emails is an open decision).
- **Current role resolution:** The server resolves the creator's role dynamically from `memberships` (`removed_at IS NULL`), reflecting their current authority in the team at query time.
- **Contract synchronization:** `createdBy: { userId, displayName, role }` is added to `ShiftDetailView` in `shared/src/shifts.ts`, `shiftDetailViewSchema`, and the server `getShift` service mapper.

## Consequences

- Resolves user confusion around ownership scope.
- Provides immediate attribution on shifts without requiring database migrations (the `shifts.created_by` column already existed in `020-team.sql`).
- Client safe-parsing retains creator data without stripping.

