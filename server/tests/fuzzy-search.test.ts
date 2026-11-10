// fuzzy-search.test.ts — verifies typo-tolerant fuzzy team search (PRD 8.4; ADR 0022; rules S6, S7, D4).
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEARCH_RESULT_LIMIT } from '@rowta/shared';
import { forTeam, globalDb } from '../src/db/clients.ts';
import { signAccessToken } from '../src/security/access-token.ts';
import {
  clearRateKeys,
  createVerifiedUser,
  dataOf,
  ensureTestCountries,
  errorOf,
  post,
  shutdownAuthTest,
  testApp,
  uniqueEmail,
} from './helpers/auth-test.ts';

let app: Hono;

async function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return app.request(path, { method: 'GET', headers });
}

interface Fixture {
  ownerId: string;
  staff1Id: string;
  staff2Id: string;
  teamId: string;
  ownerAuth: { authorization: string };
  staff1Auth: { authorization: string };
  teamBId: string;
  teamBOwnerId: string;
  teamBOwnerAuth: { authorization: string };
}

async function createTeamFor(ownerAuth: { authorization: string }, name: string): Promise<string> {
  const res = await post(app, '/teams', { name }, { ...ownerAuth, 'idempotency-key': randomUUID() });
  expect(res.status).toBe(201);
  return (await dataOf(res)).id as string;
}

async function addMember(teamId: string, userId: string, role: 'manager' | 'staff'): Promise<void> {
  await forTeam(teamId).memberships.create({ data: { team_id: teamId, user_id: userId, role } });
}

async function createShift(
  teamId: string,
  auth: { authorization: string },
  assigneeId: string,
  label: string,
  notes?: string,
): Promise<string> {
  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1_000);
  const endsAt = new Date(startsAt.getTime() + 4 * 60 * 60 * 1_000);
  const res = await post(
    app,
    `/teams/${teamId}/shifts`,
    {
      assignedUserId: assigneeId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      label,
      notes: notes ?? null,
    },
    { ...auth, 'idempotency-key': randomUUID() },
  );
  expect(res.status).toBe(201);
  return (await dataOf(res)).id as string;
}

describe('Fuzzy (typo-tolerant) team search (PRD 8.4, ADR 0022)', () => {
  let f: Fixture;

  beforeAll(async () => {
    await clearRateKeys();
    await ensureTestCountries();
    app = testApp('fuzzy-search');

    const ownerEmail = uniqueEmail('fuzzy-owner');
    const staff1Email = uniqueEmail('fuzzy-staff1');
    const staff2Email = uniqueEmail('fuzzy-staff2');
    const teamBOwnerEmail = uniqueEmail('fuzzy-b-owner');

    const ownerId = await createVerifiedUser(ownerEmail, 'OwnerPass123#');
    const staff1Id = await createVerifiedUser(staff1Email, 'Staff1Pass123#');
    const staff2Id = await createVerifiedUser(staff2Email, 'Staff2Pass123#');
    const teamBOwnerId = await createVerifiedUser(teamBOwnerEmail, 'OwnerBPass123#');

    const db = globalDb();
    await db.users.update({ where: { id: ownerId }, data: { display_name: 'Alice Owner' } });
    await db.users.update({ where: { id: staff1Id }, data: { display_name: 'Robert Manager' } });
    await db.users.update({ where: { id: staff2Id }, data: { display_name: 'User%One_Special' } });
    await db.users.update({ where: { id: teamBOwnerId }, data: { display_name: 'Foreign User' } });

    const ownerAuth = { authorization: `Bearer ${await signAccessToken(ownerId)}` };
    const staff1Auth = { authorization: `Bearer ${await signAccessToken(staff1Id)}` };
    const teamBOwnerAuth = { authorization: `Bearer ${await signAccessToken(teamBOwnerId)}` };

    const teamId = await createTeamFor(ownerAuth, 'Fuzzy Team A');
    await addMember(teamId, staff1Id, 'staff');
    await addMember(teamId, staff2Id, 'staff');

    const teamBId = await createTeamFor(teamBOwnerAuth, 'Fuzzy Team B');

    f = {
      ownerId,
      staff1Id,
      staff2Id,
      teamId,
      ownerAuth,
      staff1Auth,
      teamBId,
      teamBOwnerId,
      teamBOwnerAuth,
    };
  });

  afterAll(async () => {
    await shutdownAuthTest();
  });

  it('1. finds member display name with typo (e.g. "alise" -> "Alice Owner", "robrt" -> "Robert Manager")', async () => {
    const resAlice = await get(`/teams/${f.teamId}/search?q=alise`, f.ownerAuth);
    expect(resAlice.status).toBe(200);
    const dataAlice = await dataOf(resAlice);
    const memberNamesAlice = (dataAlice.members as Array<{ displayName: string }>).map((m) => m.displayName);
    expect(memberNamesAlice).toContain('Alice Owner');

    const resRobert = await get(`/teams/${f.teamId}/search?q=robrt`, f.ownerAuth);
    expect(resRobert.status).toBe(200);
    const dataRobert = await dataOf(resRobert);
    const memberNamesRobert = (dataRobert.members as Array<{ displayName: string }>).map((m) => m.displayName);
    expect(memberNamesRobert).toContain('Robert Manager');
  });

  it('2. finds shift label with typo (e.g. "mornig" and "shfit" -> "Morning Shift")', async () => {
    await createShift(f.teamId, f.ownerAuth, f.staff1Id, 'Morning Shift', 'Standard morning duties');

    const resMornig = await get(`/teams/${f.teamId}/search?q=mornig`, f.ownerAuth);
    expect(resMornig.status).toBe(200);
    const dataMornig = await dataOf(resMornig);
    const shiftLabelsMornig = (dataMornig.shifts as Array<{ label: string }>).map((s) => s.label);
    expect(shiftLabelsMornig).toContain('Morning Shift');

    const resShfit = await get(`/teams/${f.teamId}/search?q=shfit`, f.ownerAuth);
    expect(resShfit.status).toBe(200);
    const dataShfit = await dataOf(resShfit);
    const shiftLabelsShfit = (dataShfit.shifts as Array<{ label: string }>).map((s) => s.label);
    expect(shiftLabelsShfit).toContain('Morning Shift');
  });

  it('3. finds activity label with typo in activity_events data->>\'label\'', async () => {
    await createShift(f.teamId, f.ownerAuth, f.staff1Id, 'Emergency Coverage');

    const res = await get(`/teams/${f.teamId}/search?q=emergnecy`, f.ownerAuth);
    expect(res.status).toBe(200);
    const data = await dataOf(res);
    const activityLabels = (data.activity as Array<{ data: { label?: string } }>).map((a) => a.data?.label);
    expect(activityLabels).toContain('Emergency Coverage');
  });

  it('4. queries under 4 characters (2- and 3-character) get no fuzzy matches (prefix/contains only)', async () => {
    // Exact prefix "Al" matches Alice Owner
    const resPrefix = await get(`/teams/${f.teamId}/search?q=Al`, f.ownerAuth);
    expect(resPrefix.status).toBe(200);
    const dataPrefix = await dataOf(resPrefix);
    const names = (dataPrefix.members as Array<{ displayName: string }>).map((m) => m.displayName);
    expect(names).toContain('Alice Owner');

    // 2-character non-matching query ("Az") does NOT fuzzy-match
    const resFuzzy2 = await get(`/teams/${f.teamId}/search?q=Az`, f.ownerAuth);
    expect(resFuzzy2.status).toBe(200);
    const dataFuzzy2 = await dataOf(resFuzzy2);
    expect((dataFuzzy2.members as unknown[]).length).toBe(0);
    expect((dataFuzzy2.shifts as unknown[]).length).toBe(0);

    // 3-character prefix "Rob" matches Robert Manager (prefix match)
    const resPrefix3 = await get(`/teams/${f.teamId}/search?q=Rob`, f.ownerAuth);
    expect(resPrefix3.status).toBe(200);
    const dataPrefix3 = await dataOf(resPrefix3);
    const names3 = (dataPrefix3.members as Array<{ displayName: string }>).map((m) => m.displayName);
    expect(names3).toContain('Robert Manager');

    // 3-character typo ("shf") does NOT fuzzy-match "Morning Shift" because char_length < 4
    const resFuzzy3 = await get(`/teams/${f.teamId}/search?q=shf`, f.ownerAuth);
    expect(resFuzzy3.status).toBe(200);
    const dataFuzzy3 = await dataOf(resFuzzy3);
    expect((dataFuzzy3.shifts as unknown[]).length).toBe(0);
    expect((dataFuzzy3.members as unknown[]).length).toBe(0);
  });

  it('5. notes are not fuzzy-matched (tsquery and substring ILIKE only, no trigram fuzzy on notes)', async () => {
    await createShift(f.teamId, f.ownerAuth, f.staff1Id, 'Briefing Shift', 'Special handover procedures');

    // Typo of a word in notes ("handovr", length 7 >= 4) does NOT match because notes are not fuzzy-matched
    const resTypo = await get(`/teams/${f.teamId}/search?q=handovr`, f.ownerAuth);
    expect(resTypo.status).toBe(200);
    const dataTypo = await dataOf(resTypo);
    const labelsTypo = (dataTypo.shifts as Array<{ label: string }>).map((s) => s.label);
    expect(labelsTypo).not.toContain('Briefing Shift');

    // Exact word in notes ("handover") DOES match via tsquery / notes ILIKE
    const resExact = await get(`/teams/${f.teamId}/search?q=handover`, f.ownerAuth);
    expect(resExact.status).toBe(200);
    const dataExact = await dataOf(resExact);
    const labelsExact = (dataExact.shifts as Array<{ label: string }>).map((s) => s.label);
    expect(labelsExact).toContain('Briefing Shift');
  });

  it('6. tie-break ordering within fuzzy tier: "shfit" returns "Shift" before "Shower duty"', async () => {
    await createShift(f.teamId, f.ownerAuth, f.staff1Id, 'Shift');
    await createShift(f.teamId, f.ownerAuth, f.staff1Id, 'Shower duty');

    // Both "Shift" and "Shower duty" have word_similarity('shfit', label) = 0.3333
    // But similarity('shfit', 'Shift') = 0.20 > similarity('shfit', 'Shower duty') = 0.125
    // The tie-breaker ensures "Shift" ranks ahead of "Shower duty"
    const res = await get(`/teams/${f.teamId}/search?q=shfit`, f.ownerAuth);
    expect(res.status).toBe(200);
    const data = await dataOf(res);
    const labels = (data.shifts as Array<{ label: string }>).map((s) => s.label);

    const shiftIndex = labels.indexOf('Shift');
    const showerDutyIndex = labels.indexOf('Shower duty');

    expect(shiftIndex).toBeGreaterThanOrEqual(0);
    expect(showerDutyIndex).toBeGreaterThanOrEqual(0);
    expect(shiftIndex).toBeLessThan(showerDutyIndex);
  });

  it('7. treats % and _ wildcards literally', async () => {
    // Queries of 4+ characters also go through fuzzy, which ignores punctuation, so this proof uses a 2-character query.
    await createShift(f.teamId, f.ownerAuth, f.staff1Id, '5% off');
    await createShift(f.teamId, f.ownerAuth, f.staff1Id, '50 off');

    // Searching 5% (2 chars, fuzzy off) matches only '5% off', not '50 off'
    const resPercent = await get(`/teams/${f.teamId}/search?q=5%25`, f.ownerAuth);
    expect(resPercent.status).toBe(200);
    const dataPercent = await dataOf(resPercent);
    const labelsPercent = (dataPercent.shifts as Array<{ label: string }>).map((s) => s.label);
    expect(labelsPercent).toContain('5% off');
    expect(labelsPercent).not.toContain('50 off');

    // Searching a_b (3 chars, fuzzy off) matches only literal underscore, not single-character wildcard
    await createShift(f.teamId, f.ownerAuth, f.staff1Id, 'a_b shift');
    await createShift(f.teamId, f.ownerAuth, f.staff1Id, 'axb shift');

    const resUnderscore = await get(`/teams/${f.teamId}/search?q=a_b`, f.ownerAuth);
    expect(resUnderscore.status).toBe(200);
    const dataUnderscore = await dataOf(resUnderscore);
    const labelsUnderscore = (dataUnderscore.shifts as Array<{ label: string }>).map((s) => s.label);
    expect(labelsUnderscore).toContain('a_b shift');
    expect(labelsUnderscore).not.toContain('axb shift');

    // Member with literal % and _
    const resWildcardMember = await get(`/teams/${f.teamId}/search?q=%25One_`, f.ownerAuth);
    expect(resWildcardMember.status).toBe(200);
    const dataWildcardMember = await dataOf(resWildcardMember);
    const wildcardNames = (dataWildcardMember.members as Array<{ displayName: string }>).map((m) => m.displayName);
    expect(wildcardNames).toContain('User%One_Special');
  });

  it('8. ranking order: exact match, then starts-with, then contains, then fuzzy', async () => {
    await createShift(f.teamId, f.ownerAuth, f.staff1Id, 'Inventory'); // exact
    await createShift(f.teamId, f.ownerAuth, f.staff1Id, 'Inventory Planning'); // starts-with
    await createShift(f.teamId, f.ownerAuth, f.staff1Id, 'Annual Inventory Review'); // contains
    await createShift(f.teamId, f.ownerAuth, f.staff1Id, 'Invntory Audit'); // fuzzy typo

    const res = await get(`/teams/${f.teamId}/search?q=Inventory`, f.ownerAuth);
    expect(res.status).toBe(200);
    const data = await dataOf(res);
    const shifts = data.shifts as Array<{ label: string }>;
    const labels = shifts.map((s) => s.label);

    const exactIndex = labels.indexOf('Inventory');
    const startsIndex = labels.indexOf('Inventory Planning');
    const containsIndex = labels.indexOf('Annual Inventory Review');
    const fuzzyIndex = labels.indexOf('Invntory Audit');

    expect(exactIndex).toBeGreaterThanOrEqual(0);
    expect(startsIndex).toBeGreaterThan(exactIndex);
    expect(containsIndex).toBeGreaterThan(startsIndex);
    expect(fuzzyIndex).toBeGreaterThan(containsIndex);
  });

  it('9. team isolation: another team\'s data is never returned', async () => {
    // Create shift in Team B assigned to Team B's owner
    await createShift(f.teamBId, f.teamBOwnerAuth, f.teamBOwnerId, 'Confidential Team B Shift');

    // Query in Team A for Team B label
    const resA = await get(`/teams/${f.teamId}/search?q=Confidential`, f.ownerAuth);
    expect(resA.status).toBe(200);
    const dataA = await dataOf(resA);
    const labelsA = (dataA.shifts as Array<{ label: string }>).map((s) => s.label);
    expect(labelsA).not.toContain('Confidential Team B Shift');

    // Query from non-member outsider returns 404
    const resOutsider = await get(`/teams/${f.teamId}/search?q=Alice`, f.teamBOwnerAuth);
    expect(resOutsider.status).toBe(404);
    const err = await errorOf(resOutsider);
    expect(err.code).toBe('team.notFound');
  });

  it('10. soft-deleted shifts are still hidden from search results', async () => {
    const shiftId = await createShift(f.teamId, f.ownerAuth, f.staff1Id, 'Discontinued Shift');

    // Soft-delete the shift
    const deleteRes = await post(app, `/teams/${f.teamId}/shifts/${shiftId}/delete`, undefined, f.ownerAuth);
    expect(deleteRes.status).toBe(200);

    // Search for deleted shift label or typo
    const res = await get(`/teams/${f.teamId}/search?q=Discontinued`, f.ownerAuth);
    expect(res.status).toBe(200);
    const data = await dataOf(res);
    const labels = (data.shifts as Array<{ label: string }>).map((s) => s.label);
    expect(labels).not.toContain('Discontinued Shift');
  });

  it('11. result limit is enforced at SEARCH_RESULT_LIMIT (20)', async () => {
    const res = await get(`/teams/${f.teamId}/search?q=Shift`, f.ownerAuth);
    expect(res.status).toBe(200);
    const data = await dataOf(res);
    expect((data.shifts as unknown[]).length).toBeLessThanOrEqual(SEARCH_RESULT_LIMIT);
    expect((data.members as unknown[]).length).toBeLessThanOrEqual(SEARCH_RESULT_LIMIT);
    expect((data.activity as unknown[]).length).toBeLessThanOrEqual(SEARCH_RESULT_LIMIT);
  });
});

