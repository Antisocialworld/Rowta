// test-shift-creator.ts — pure tests for shift creator formatting (PRD 8.3; Owner Decision D9).
import assert from 'node:assert/strict';
import { formatShiftCreator } from '../src/lib/shift-creator';

function testFormatShiftCreatorWithRole(): void {
  const owner = formatShiftCreator({ displayName: 'Alex Owner', role: 'owner' });
  assert.equal(owner, 'Created by Alex Owner (Admin)', 'owner role must be appended in parentheses as Admin');

  const manager = formatShiftCreator({ displayName: 'Bola Manager', role: 'manager' });
  assert.equal(manager, 'Created by Bola Manager (Manager)', 'manager role must be appended in parentheses');

  const staff = formatShiftCreator({ displayName: 'Sam Staff', role: 'staff' });
  assert.equal(staff, 'Created by Sam Staff (Staff)', 'staff role must be appended in parentheses');
}

function testFormatShiftCreatorWithoutRole(): void {
  // Creator is no longer a member of the team (role: null or undefined)
  const noRoleNull = formatShiftCreator({ displayName: 'Former Member', role: null });
  assert.equal(noRoleNull, 'Created by Former Member', 'null role must display name only without parentheses');

  const noRoleUndefined = formatShiftCreator({ displayName: 'Former Member', role: undefined });
  assert.equal(noRoleUndefined, 'Created by Former Member', 'undefined role must display name only without parentheses');
}

function testFormatShiftCreatorEmptyOrNull(): void {
  assert.equal(formatShiftCreator(null), '');
  assert.equal(formatShiftCreator(undefined), '');
  assert.equal(formatShiftCreator({ displayName: '' }), '');
  assert.equal(formatShiftCreator({ displayName: '   ' }), '');
}

function runAll(): void {
  testFormatShiftCreatorWithRole();
  testFormatShiftCreatorWithoutRole();
  testFormatShiftCreatorEmptyOrNull();
  console.log('test-shift-creator: 8 assertions passed');
}

runAll();

