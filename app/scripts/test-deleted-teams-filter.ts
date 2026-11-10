// test-deleted-teams-filter.ts — verifies the deleted-teams name filter (pure function).
// Zero I/O, zero database; all cases are pure function results.
// Run from the repo root:
//   npm exec --workspace @rowta/app -- tsx scripts/test-deleted-teams-filter.ts
import { filterDeletedTeamsByName } from '../src/screens/teams/deleted-teams-filter';

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}

const team1 = { id: 't-1', name: 'Acme Corp', deletedAt: '2026-01-01T00:00:00Z', restoreUntil: '2026-04-01T00:00:00Z' };
const team2 = { id: 't-2', name: 'Beta Labs', deletedAt: '2026-01-02T00:00:00Z', restoreUntil: '2026-04-02T00:00:00Z' };
const team3 = { id: 't-3', name: 'ACME Widgets', deletedAt: '2026-01-03T00:00:00Z', restoreUntil: '2026-04-03T00:00:00Z' };
const allTeams = [team1, team2, team3];

// Empty query returns all teams
const all = filterDeletedTeamsByName(allTeams, '');
check(all.length === 3, 'empty query returns all teams');

// Case-insensitive match
const acme = filterDeletedTeamsByName(allTeams, 'ACME');
check(acme.length === 2, 'case-insensitive match returns both ACME teams');
if (!acme[0] || !acme[1]) { check(false, 'case-insensitive match returns both ACME teams'); process.exit(1); }
check(acme[0].id === 't-1' && acme[1].id === 't-3', 'case-insensitive match returns correct teams');

// Match anywhere in name
const beta = filterDeletedTeamsByName(allTeams, 'eta');
check(beta.length === 1, 'match anywhere returns Beta Labs');
if (!beta[0]) { check(false, 'match anywhere returns Beta Labs'); process.exit(1); }
check(beta[0].id === 't-2', 'match anywhere returns correct team');

// Trimmed query
const trimmed = filterDeletedTeamsByName(allTeams, '  acme  ');
check(trimmed.length === 2, 'trimmed query works');

// No match returns empty
const none = filterDeletedTeamsByName(allTeams, 'zzz');
check(none.length === 0, 'no match returns empty list');

if (failures > 0) {
  console.error(`Deleted teams filter test failed with ${failures} error(s).`);
  process.exit(1);
} else {
  console.log('All deleted teams filter tests passed.');
  process.exit(0);
}
