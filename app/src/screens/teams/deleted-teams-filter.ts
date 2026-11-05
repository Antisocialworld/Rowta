// Deleted-teams filter — pure function to filter deleted teams by name.
// Case-insensitive, trimmed, match anywhere. Testable in plain Node.
import type { DeletedTeamItem } from '../../lib/api';

export function filterDeletedTeamsByName(teams: readonly DeletedTeamItem[], query: string): readonly DeletedTeamItem[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return teams;
  return teams.filter((team) => team.name.toLowerCase().includes(q));
}
