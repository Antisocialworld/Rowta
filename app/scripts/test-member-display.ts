// Test: Disambiguation email safeguard for MembersScreen (rule S9, PRD 8.11).
// Run: npm exec --workspace @rowta/app -- tsx scripts/test-member-display.ts

import { membersNeedingEmail, type MemberWithName } from '../src/lib/member-display';

let failures = 0;
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

// 1. Empty roster returns empty set
const emptyResult = membersNeedingEmail([]);
check(emptyResult.size === 0, 'empty roster returns empty set');

// 2. Single member roster returns empty set
const singleResult = membersNeedingEmail([{ userId: 'u1', displayName: 'Ada Lovelace' }]);
check(singleResult.size === 0, 'single member roster returns empty set');

// 3. Roster with all unique display names returns empty set
const uniqueMembers: MemberWithName[] = [
  { userId: 'u1', displayName: 'Ada Lovelace' },
  { userId: 'u2', displayName: 'Grace Hopper' },
  { userId: 'u3', displayName: 'Katherine Johnson' },
];
const uniqueResult = membersNeedingEmail(uniqueMembers);
check(uniqueResult.size === 0, 'roster with unique display names returns empty set');

// 4. Exact duplicate display names are identified
const exactDuplicates: MemberWithName[] = [
  { userId: 'u1', displayName: 'Alex Smith' },
  { userId: 'u2', displayName: 'Alex Smith' },
  { userId: 'u3', displayName: 'Jane Doe' },
];
const exactResult = membersNeedingEmail(exactDuplicates);
check(exactResult.size === 2, 'two members with exact same name are identified');
check(exactResult.has('u1') && exactResult.has('u2'), 'identified set contains both duplicate userIds');
check(!exactResult.has('u3'), 'unique member is not in the identified set');

// 5. Case-insensitive duplicate names are identified
const caseDuplicates: MemberWithName[] = [
  { userId: 'u1', displayName: 'John Doe' },
  { userId: 'u2', displayName: 'john doe' },
  { userId: 'u3', displayName: 'JOHN DOE' },
  { userId: 'u4', displayName: 'Unique User' },
];
const caseResult = membersNeedingEmail(caseDuplicates);
check(caseResult.size === 3, 'three members with case variations of same name are all identified');
check(
  caseResult.has('u1') && caseResult.has('u2') && caseResult.has('u3'),
  'case-insensitive duplicate set contains u1, u2, u3',
);
check(!caseResult.has('u4'), 'unique user is excluded');

// 6. Whitespace-trimmed duplicate names are identified
const whitespaceDuplicates: MemberWithName[] = [
  { userId: 'u1', displayName: '  Sam Wilson  ' },
  { userId: 'u2', displayName: 'Sam Wilson' },
  { userId: 'u3', displayName: 'Sam  Wilson' }, // Internal whitespace difference is distinct
];
const wsResult = membersNeedingEmail(whitespaceDuplicates);
check(wsResult.size === 2, 'leading/trailing whitespace trimmed duplicates match');
check(wsResult.has('u1') && wsResult.has('u2'), 'u1 and u2 match after trimming');
check(!wsResult.has('u3'), 'internal double space is distinct name and not grouped');

// 7. Multiple duplicate groups in the same roster
const multiGroup: MemberWithName[] = [
  { userId: 'u1', displayName: 'Michael' },
  { userId: 'u2', displayName: 'michael' },
  { userId: 'u3', displayName: 'Sarah' },
  { userId: 'u4', displayName: 'Sarah' },
  { userId: 'u5', displayName: 'Peter' },
];
const multiResult = membersNeedingEmail(multiGroup);
check(multiResult.size === 4, 'identifies all members belonging to duplicate groups');
check(
  multiResult.has('u1') && multiResult.has('u2') && multiResult.has('u3') && multiResult.has('u4'),
  'contains both pairs of duplicate names',
);
check(!multiResult.has('u5'), 'unique user Peter excluded');

if (failures > 0) {
  console.error(`Member display check failed with ${failures} error(s).`);
  process.exit(1);
} else {
  console.log('All member display tests passed.');
  process.exit(0);
}

