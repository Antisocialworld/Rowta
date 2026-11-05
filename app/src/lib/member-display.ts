// Pure helper for member display logic (rules S9, U8, PRD 8.11).
// Emails are withheld on the Members screen by default, shown only as a disambiguation
// safeguard when multiple members share the same display name.

export type MemberWithName = {
  readonly userId: string;
  readonly displayName: string;
};

/**
 * Returns a Set of userIds whose display names match another member on the team
 * (case-insensitive, whitespace-trimmed).
 * Used by MembersScreen to selectively display emails only to disambiguate members with duplicate names.
 */
export function membersNeedingEmail(members: readonly MemberWithName[]): Set<string> {
  const counts = new Map<string, number>();
  for (const member of members) {
    const key = member.displayName.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const needing = new Set<string>();
  for (const member of members) {
    const key = member.displayName.trim().toLowerCase();
    if ((counts.get(key) ?? 0) > 1) {
      needing.add(member.userId);
    }
  }
  return needing;
}

