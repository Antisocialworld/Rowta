// test-team-restore.ts — pure tests for team restore visibility, day calculation, and UI copy (PRD 4, 8.10; rules U1, U5, S5).
// Verifies:
// 1. calculateDaysLeftToRestore correctly computes whole days remaining and clamps to 0.
// 2. The Deleted teams section visibility rule (rendered ONLY when deleted teams array has items).
// 3. Copy audit: confirms "schedules data removal" has been removed and 30-day restore window is stated.
// Run from repo root:
//   npm exec --workspace @rowta/app -- tsx scripts/test-team-restore.ts
import { calculateDaysLeftToRestore } from '../src/state/teams';
import { shouldShowDeletedTeamsTrigger } from '../src/lib/deleted-teams-logic';
import { t } from '../src/i18n/en';

let failures = 0;
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

// ---------------------------------------------------------------------------------------------
// 1. Day-count calculation helper
// ---------------------------------------------------------------------------------------------
console.log('--- 1. calculateDaysLeftToRestore calculation ---');
const now = new Date('2026-10-31T12:00:00.000Z');

// Exactly 30 days ahead
const thirtyDaysAhead = new Date('2026-11-30T12:00:00.000Z');
check(calculateDaysLeftToRestore(thirtyDaysAhead, now) === 30, '30 days ahead returns 30');
check(calculateDaysLeftToRestore(thirtyDaysAhead.toISOString(), now) === 30, 'works with ISO string');

// Partial day rounding up (29 days and 2 hours ahead -> 30 days left)
const partialDayAhead = new Date(now.getTime() + (29 * 24 + 2) * 60 * 60 * 1_000);
check(calculateDaysLeftToRestore(partialDayAhead, now) === 30, 'partial day rounds up (29d 2h -> 30)');

// 1 day ahead
const oneDayAhead = new Date('2026-11-01T12:00:00.000Z');
check(calculateDaysLeftToRestore(oneDayAhead, now) === 1, '1 day ahead returns 1');

// 2 hours ahead (same day) -> rounds up to 1 day left
const twoHoursAhead = new Date(now.getTime() + 2 * 60 * 60 * 1_000);
check(calculateDaysLeftToRestore(twoHoursAhead, now) === 1, '2 hours ahead rounds up to 1 day left');

// Exact now -> 0
check(calculateDaysLeftToRestore(now, now) === 0, 'exact match returns 0');

// Already expired in the past -> clamps to 0
const pastDate = new Date('2026-10-15T12:00:00.000Z');
check(calculateDaysLeftToRestore(pastDate, now) === 0, 'expired date in past clamps to 0');

// ---------------------------------------------------------------------------------------------
// 2. Visibility rule for Deleted teams trigger button
// ---------------------------------------------------------------------------------------------
console.log('\n--- 2. Visibility rule for Deleted teams trigger button ---');
check(shouldShowDeletedTeamsTrigger(undefined) === false, 'undefined teams hides trigger button');
check(shouldShowDeletedTeamsTrigger(null) === false, 'null teams hides trigger button');
check(shouldShowDeletedTeamsTrigger([]) === false, 'empty teams array hides trigger button');
check(shouldShowDeletedTeamsTrigger([{ id: 'team-1', name: 'Deleted Team' }]) === true, 'array with items shows trigger button');

// ---------------------------------------------------------------------------------------------
// 3. Copy audit: danger zone warning and DeleteTeamModal
// ---------------------------------------------------------------------------------------------
console.log('\n--- 3. Copy audit ---');
const dangerWarning = t('teams.settings.dangerWarning');
check(!dangerWarning.includes('schedules data removal'), 'dangerWarning does not mention "schedules data removal"');
check(dangerWarning.includes('30 days'), 'dangerWarning explicitly states "30 days" restore window');

const deleteDesc = t('teams.delete.description', { name: 'Acme Corp' });
check(!deleteDesc.includes('schedules data removal'), 'delete description does not mention "schedules data removal"');
check(deleteDesc.includes('30 days'), 'delete description explicitly states "30 days" restore window');

const expiredMsg = t('team.restoreExpired');
check(expiredMsg.includes('30-day restore window'), 'restoreExpired message states 30-day window');

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

