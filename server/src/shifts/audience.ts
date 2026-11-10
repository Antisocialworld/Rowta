// Audience filter for activity feed events (rule S7).
// Pure function: returns a Prisma.sql WHERE fragment that filters activity_events
// by audience rules given the viewer's userId and role.
// Rules:
//   'team'       -> every member of the team
//   'managers'   -> owner or manager only
//   'involved'   -> owner or manager, or the actor themselves,
//                 or (for swap events) the swap requester or target
//   anything else -> owner or manager only (fail closed)
import { Prisma } from '../../prisma/generated/db0/client.ts';

export function activityAudienceFilter(userId: string, role: string): Prisma.Sql {
  return Prisma.sql`
    AND (
      audience = 'team'
      OR (audience = 'managers' AND ${role} IN ('owner', 'manager'))
      OR (
        audience = 'involved'
        AND (
          ${role} IN ('owner', 'manager')
          OR actor_user_id = ${userId}::uuid
          OR (
            kind LIKE 'swap.%'
            AND EXISTS (
              SELECT 1 FROM swap_requests
              WHERE swap_requests.id::text = activity_events.subject_id::text
                AND swap_requests.team_id = activity_events.team_id
                AND (
                  swap_requests.requested_by = ${userId}::uuid
                  OR swap_requests.target_user_id = ${userId}::uuid
                )
            )
          )
        )
      )
      OR (audience NOT IN ('team', 'managers', 'involved') AND ${role} IN ('owner', 'manager'))
    )
  `;
}
