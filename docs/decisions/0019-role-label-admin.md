# 0019. Team role user-facing label: Admin

Date: 2026-10-30. Status: proposed (Owner Decision; Phase 3 / UX pass).
Applies to `app/src/i18n/en.ts`, `app/src/screens/teams/`, `app/src/screens/shifts/`, `app/src/lib/team-role.ts`.

## Problem

The highest-authority role in a team was initially labeled "Owner" across the user interface. In customer-facing context, this terminology caused confusion:
1. **Scope misunderstanding:** Users frequently assumed "Owner" referred to an overall company owner, business proprietor, or account billing owner, rather than the administrator of a specific scheduling team.
2. **Architecture mismatch:** Rowta's domain architecture has no concept of a company-level super-owner; teams are isolated units with their own autonomous roster and roles.

## Decisions

1. **User-facing label is "Admin":**
   - The top role is displayed as **Admin** across all screens, badges, member rows, activity entries, and shift headers.
   - Specifically:
     - `role.owner` maps to `'Admin'`
     - `team.role.owner` maps to `'Admin in this team'`
     - Warning messages (such as `teams.leave.blocked`) state: "The admin cannot leave the team. Transfer ownership or delete the team first."
2. **Meaning of Admin:**
   - Admin strictly means "the person who runs this team". It does NOT signify ownership of the company or billing responsibility.
3. **Internal and API identifiers remain unchanged:**
   - The stored role in PostgreSQL (`memberships.role`) remains `'owner'`.
   - The shared Zod schema (`teamRoleSchema`) and API response contracts retain `'owner'`.
   - Central policy rules (`can()`) and server-side authorization checks continue using `'owner'`.
4. **Consistency:**
   - Shift creator formatting outputs `Created by {name} (Admin)` instead of `(Owner)`.
   - Transfer ownership and team deletion lifecycle workflows remain structurally identical.

## Consequences

- End users clearly understand the administrative scope within the team without conflating it with corporate or legal ownership.
- Zero database migration or wire protocol breaking changes are required.

