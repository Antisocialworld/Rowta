// test-team-role.ts — pure tests for team role descriptive labels (Owner Decision D8).
import assert from 'node:assert/strict';
import { teamRoleKey } from '../src/lib/team-role';

function testTeamRoleKey(): void {
  assert.equal(teamRoleKey('owner'), 'team.role.owner', 'owner must map to team.role.owner');
  assert.equal(teamRoleKey('manager'), 'team.role.manager', 'manager must map to team.role.manager');
  assert.equal(teamRoleKey('staff'), 'team.role.staff', 'staff must map to team.role.staff');
  assert.equal(teamRoleKey('unknown'), 'team.role.staff', 'fallback to team.role.staff');
  assert.equal(teamRoleKey(''), 'team.role.staff', 'empty fallback to team.role.staff');
}

function runAll(): void {
  testTeamRoleKey();
  console.log('test-team-role: 5 assertions passed');
}

runAll();

