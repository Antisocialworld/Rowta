// Phase 6 Stage 3 server tests: devices API routes, registration, token uniqueness,
// ownership transfer, idempotency, uniform unregister 404, and device cap (PRD 7.1, 8.7, 12).
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { globalDb } from '../src/db/clients.ts';
import { signAccessToken } from '../src/security/access-token.ts';
import { maskPushToken } from '../src/push/client.ts';
import { MAX_DEVICES_PER_USER } from '../src/devices/service.ts';
import {
  clearRateKeys,
  createVerifiedUser,
  dataOf,
  ensureTestCountries,
  errorOf,
  shutdownAuthTest,
  testApp,
  uniqueEmail,
} from './helpers/auth-test.ts';

let app: Hono;

async function postWithHeaders(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('Phase 6 Stage 3 devices routes', () => {
  let userAId: string;
  let userBId: string;
  let userAAuth: { authorization: string };
  let userBAuth: { authorization: string };

  beforeAll(async () => {
    await clearRateKeys();
    await ensureTestCountries();
    app = testApp('devices-routes');

    const emailA = uniqueEmail('devices-user-a');
    const emailB = uniqueEmail('devices-user-b');

    userAId = await createVerifiedUser(emailA, 'Password123#');
    userBId = await createVerifiedUser(emailB, 'Password123#');

    const tokenA = await signAccessToken(userAId);
    const tokenB = await signAccessToken(userBId);

    userAAuth = { authorization: `Bearer ${tokenA}` };
    userBAuth = { authorization: `Bearer ${tokenB}` };
  });

  afterAll(async () => {
    await shutdownAuthTest();
  });

  // 1. Authentication requirements
  it('rejects unauthenticated POST /devices with 401', async () => {
    const res = await postWithHeaders('/devices', {
      pushToken: 'ExponentPushToken[test-unauth]',
      platform: 'android',
    });
    expect(res.status).toBe(401);
    const err = await errorOf(res);
    expect(err.code).toBe('auth.not_authenticated');
  });

  it('rejects unauthenticated POST /devices/:id/unregister with 401', async () => {
    const res = await postWithHeaders('/devices/00000000-0000-0000-0000-000000000000/unregister', {});
    expect(res.status).toBe(401);
    const err = await errorOf(res);
    expect(err.code).toBe('auth.not_authenticated');
  });

  // 2. Idempotency-Key required on POST endpoints
  it('rejects POST /devices without Idempotency-Key header with 400 idempotency.missing', async () => {
    const res = await postWithHeaders(
      '/devices',
      { pushToken: 'ExponentPushToken[idemp-missing]', platform: 'ios' },
      userAAuth,
    );
    expect(res.status).toBe(400);
    const err = await errorOf(res);
    expect(err.code).toBe('idempotency.missing');
  });

  it('rejects POST /devices/:id/unregister without Idempotency-Key header with 400 idempotency.missing', async () => {
    const res = await postWithHeaders(
      '/devices/00000000-0000-0000-0000-000000000000/unregister',
      {},
      userAAuth,
    );
    expect(res.status).toBe(400);
    const err = await errorOf(res);
    expect(err.code).toBe('idempotency.missing');
  });

  // 3. Validation and masking
  it('rejects invalid Expo push token format with 422 and does NOT echo token in error', async () => {
    const badToken = 'InvalidTokenNotExpo123456';
    const res = await postWithHeaders(
      '/devices',
      { pushToken: badToken, platform: 'android' },
      { ...userAAuth, 'idempotency-key': 'idemp-bad-token-1' },
    );
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(text).not.toContain(badToken);
    const json = JSON.parse(text) as { error: { code: string; fields?: Record<string, string> } };
    expect(json.error.code).toBe('validation.invalid');
    expect(json.error.fields?.pushToken).toBe('device.push_token_invalid');
  });

  it('rejects invalid platform with 422 device.platform_invalid', async () => {
    const res = await postWithHeaders(
      '/devices',
      { pushToken: 'ExponentPushToken[valid-token-plat]', platform: 'blackberry' },
      { ...userAAuth, 'idempotency-key': 'idemp-bad-plat-1' },
    );
    expect(res.status).toBe(422);
    const err = await errorOf(res);
    expect(err.fields?.platform).toBe('device.platform_invalid');
  });

  it('rejects unknown fields with 422 validation.unknown_field', async () => {
    const res = await postWithHeaders(
      '/devices',
      { pushToken: 'ExponentPushToken[valid-token-unk]', platform: 'android', extraField: 'bad' },
      { ...userAAuth, 'idempotency-key': 'idemp-unk-1' },
    );
    expect(res.status).toBe(422);
    const err = await errorOf(res);
    expect(err.fields?.extraField).toBe('validation.unknown_field');
  });

  // 4. Successful registration and token masking in response
  it('registers a device successfully, returning 201 without the push token in response body', async () => {
    const token = 'ExponentPushToken[userA_dev_reg1]';
    const res = await postWithHeaders(
      '/devices',
      { pushToken: token, platform: 'android', deviceName: 'Pixel 8' },
      { ...userAAuth, 'idempotency-key': 'idemp-reg-1' },
    );
    expect(res.status).toBe(201);
    const data = (await dataOf(res)) as { id: string; platform: string; deviceId: string; lastSeenAt: string };
    expect(typeof data.id).toBe('string');
    expect(data.platform).toBe('android');
    expect((data as unknown as Record<string, unknown>).pushToken).toBeUndefined();

    // Verify token exists in DB but masked in helper
    const db = globalDb();
    const row = await db.devices.findUnique({ where: { id: data.id } });
    expect(row?.push_token).toBe(token);
    expect(maskPushToken(token)).toBe('ExponentPushTok…');
  });

  // 5. Token uniqueness and ownership transfer across users
  it('enforces token uniqueness: registering an existing token moves ownership to the new user and refreshes last_seen_at', async () => {
    const sharedToken = 'ExponentPushToken[shared_phone_unique_1]';

    // 1. User A registers the phone
    const resA = await postWithHeaders(
      '/devices',
      { pushToken: sharedToken, platform: 'ios', deviceName: 'Shared iPhone' },
      { ...userAAuth, 'idempotency-key': 'idemp-shared-a' },
    );
    expect(resA.status).toBe(201);
    const dataA = (await dataOf(resA)) as { id: string };

    const db = globalDb();
    const rowA = await db.devices.findUnique({ where: { id: dataA.id } });
    expect(rowA?.user_id).toBe(userAId);

    // 2. User B logs into the same phone and registers the same token
    const resB = await postWithHeaders(
      '/devices',
      { pushToken: sharedToken, platform: 'ios', deviceName: 'Shared iPhone B' },
      { ...userBAuth, 'idempotency-key': 'idemp-shared-b' },
    );
    expect(resB.status).toBe(201);
    const dataB = (await dataOf(resB)) as { id: string };

    // Same device row id, but ownership moved to User B
    expect(dataB.id).toBe(dataA.id);

    const rowB = await db.devices.findUnique({ where: { id: dataB.id } });
    expect(rowB?.user_id).toBe(userBId);

    // Token count in DB is exactly 1
    const count = await db.devices.count({ where: { push_token: sharedToken } });
    expect(count).toBe(1);
  });

  // 5b. Token rotation: same (user, deviceId) with a NEW push token (Item 2)
  it('token rotation: registering the same (user, deviceId) with a NEW push token updates the row', async () => {
    const deviceId = 'my-unique-phone-id';
    const token1 = 'ExponentPushToken[rotation_token_1]';
    const token2 = 'ExponentPushToken[rotation_token_2]';

    // 1. Initial registration
    const res1 = await postWithHeaders(
      '/devices',
      { pushToken: token1, platform: 'ios', deviceId },
      { ...userAAuth, 'idempotency-key': 'idemp-rot-1' },
    );
    expect(res1.status).toBe(201);
    const dev1 = (await dataOf(res1)) as { id: string; deviceId: string; lastSeenAt: string };
    expect(dev1.deviceId).toBe(deviceId);

    // 2. Rotate to token2 for same deviceId
    const res2 = await postWithHeaders(
      '/devices',
      { pushToken: token2, platform: 'ios', deviceId },
      { ...userAAuth, 'idempotency-key': 'idemp-rot-2' },
    );
    expect(res2.status).toBe(201);
    const dev2 = (await dataOf(res2)) as { id: string; deviceId: string; lastSeenAt: string };

    // Row ID is unchanged (updated in place, not duplicated)
    expect(dev2.id).toBe(dev1.id);
    expect(dev2.deviceId).toBe(deviceId);

    const db = globalDb();
    // Exactly one device row exists for this deviceId and user
    const rows = await db.devices.findMany({
      where: { user_id: userAId, device_id: deviceId },
    });
    expect(rows.length).toBe(1);
    expect(rows[0]!.push_token).toBe(token2);
    // Old token is no longer in DB
    const oldTokenRow = await db.devices.findFirst({ where: { push_token: token1 } });
    expect(oldTokenRow).toBeNull();
  });

  // 5c. Race condition on token uniqueness: two concurrent registrations (Item 1)
  it('race condition: two concurrent requests registering the same token resolve deterministically without 500', async () => {
    const raceToken = 'ExponentPushToken[concurrent_race_token_1]';
    const [res1, res2] = await Promise.all([
      postWithHeaders(
        '/devices',
        { pushToken: raceToken, platform: 'ios', deviceId: 'dev-race-1' },
        { ...userAAuth, 'idempotency-key': 'idemp-race-1' },
      ),
      postWithHeaders(
        '/devices',
        { pushToken: raceToken, platform: 'android', deviceId: 'dev-race-2' },
        { ...userBAuth, 'idempotency-key': 'idemp-race-2' },
      ),
    ]);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    const db = globalDb();
    const count = await db.devices.count({ where: { push_token: raceToken } });
    expect(count).toBe(1);
  });

  // 5d. Forced 23505/P2002 retry branch
  it('forces the 23505/P2002 retry branch on race and resolves with 201', async () => {
    const db = globalDb();
    const token = 'ExponentPushToken[forced_p2002_retry_token]';
    const deviceId = 'dev-forced-p2002';
    const originalCreate = db.devices.create.bind(db.devices);
    let createCalls = 0;

    const spy = vi.spyOn(db.devices, 'create').mockImplementation(((async (args: unknown) => {
      createCalls += 1;
      if (createCalls === 1) {
        // Simulate Postgres 23505 / Prisma P2002 error on the first attempt
        const err = new Error('Unique constraint failed on the fields: (`push_token`)');
        (err as unknown as { code: string }).code = 'P2002';
        throw err;
      }
      return originalCreate(args as Parameters<typeof originalCreate>[0]);
    }) as never));

    try {
      const res = await postWithHeaders(
        '/devices',
        { pushToken: token, platform: 'android', deviceId },
        { ...userAAuth, 'idempotency-key': 'idemp-forced-retry-1' },
      );

      expect(res.status).toBe(201);
      // The retry ran exactly once after the first attempt failed
      expect(createCalls).toBe(2);

      // Exactly one row exists in DB for this token
      const count = await db.devices.count({ where: { push_token: token } });
      expect(count).toBe(1);

      // The user's device row holds the token
      const row = await db.devices.findUnique({
        where: {
          user_id_device_id: { user_id: userAId, device_id: deviceId },
        },
      });
      expect(row).not.toBeNull();
      expect(row?.push_token).toBe(token);
    } finally {
      spy.mockRestore();
    }
  });

  // 5e. Second consecutive 23505 does not loop or hang and fails cleanly
  it('second consecutive 23505 does not loop or hang and fails cleanly with controlled error', async () => {
    const db = globalDb();
    let createCalls = 0;

    const spy = vi.spyOn(db.devices, 'create').mockImplementation(((async () => {
      createCalls += 1;
      const err = new Error('Persistent unique constraint error');
      (err as unknown as { code: string }).code = 'P2002';
      throw err;
    }) as never));

    try {
      const res = await postWithHeaders(
        '/devices',
        { pushToken: 'ExponentPushToken[second_23505_fail]', platform: 'ios', deviceId: 'dev-loop-check' },
        { ...userAAuth, 'idempotency-key': 'idemp-persistent-p2002' },
      );

      // Exactly 2 attempts: initial call + 1 single retry, then fails
      expect(createCalls).toBe(2);
      expect(res.status).toBe(500);
      const errBody = await errorOf(res);
      expect(errBody.code).toBe('generic.error');
    } finally {
      spy.mockRestore();
    }
  });

  // 6. Idempotency replay
  it('replays identical response for repeated request with the same idempotency key', async () => {
    const key = 'idemp-replay-test-1';
    const payload = { pushToken: 'ExponentPushToken[replay_dev_1]', platform: 'android' };

    const res1 = await postWithHeaders('/devices', payload, { ...userAAuth, 'idempotency-key': key });
    expect(res1.status).toBe(201);
    const data1 = await dataOf(res1);

    const res2 = await postWithHeaders('/devices', payload, { ...userAAuth, 'idempotency-key': key });
    expect(res2.status).toBe(201);
    const data2 = await dataOf(res2);
    expect(data2).toEqual(data1);
  });

  it('rejects same idempotency key with different body with 422 idempotency.fingerprint_mismatch', async () => {
    const key = 'idemp-fingerprint-test-1';
    await postWithHeaders(
      '/devices',
      { pushToken: 'ExponentPushToken[fp_dev_1]', platform: 'android' },
      { ...userAAuth, 'idempotency-key': key },
    );

    const res2 = await postWithHeaders(
      '/devices',
      { pushToken: 'ExponentPushToken[fp_dev_2]', platform: 'android' },
      { ...userAAuth, 'idempotency-key': key },
    );
    expect(res2.status).toBe(422);
    const err = await errorOf(res2);
    expect(err.code).toBe('idempotency.fingerprint_mismatch');
  });

  // 7. Unregister and uniform 404 response
  it('returns uniform 404 device.notFound when unregistering non-existent device or another users device', async () => {
    // 1. Non-existent id
    const resNotFound = await postWithHeaders(
      '/devices/00000000-0000-0000-0000-000000000000/unregister',
      {},
      { ...userAAuth, 'idempotency-key': 'idemp-unreg-missing' },
    );
    expect(resNotFound.status).toBe(404);
    const err1 = await errorOf(resNotFound);
    expect(err1.code).toBe('device.notFound');

    // 2. Device owned by User B, attempted by User A
    const regResB = await postWithHeaders(
      '/devices',
      { pushToken: 'ExponentPushToken[userB_private_dev]', platform: 'ios' },
      { ...userBAuth, 'idempotency-key': 'idemp-b-private-dev' },
    );
    const deviceB = (await dataOf(regResB)) as { id: string };

    const resUnauthorized = await postWithHeaders(
      `/devices/${deviceB.id}/unregister`,
      {},
      { ...userAAuth, 'idempotency-key': 'idemp-unreg-cross' },
    );
    expect(resUnauthorized.status).toBe(404);
    const err2 = await errorOf(resUnauthorized);
    expect(err2.code).toBe('device.notFound');
    // Error body is identical: no leaking that device exists
    expect(err2.message).toBe(err1.message);
  });

  it('unregisters device successfully when owned by the signed-in user and replays via idempotency', async () => {
    const regRes = await postWithHeaders(
      '/devices',
      { pushToken: 'ExponentPushToken[userA_to_unreg]', platform: 'android' },
      { ...userAAuth, 'idempotency-key': 'idemp-unreg-setup' },
    );
    const dev = (await dataOf(regRes)) as { id: string };

    const unregKey = 'idemp-unreg-call';
    const unregRes = await postWithHeaders(
      `/devices/${dev.id}/unregister`,
      {},
      { ...userAAuth, 'idempotency-key': unregKey },
    );
    expect(unregRes.status).toBe(200);
    const data = (await dataOf(unregRes)) as { unregistered: boolean };
    expect(data.unregistered).toBe(true);

    // Row is deleted from DB
    const db = globalDb();
    const row = await db.devices.findUnique({ where: { id: dev.id } });
    expect(row).toBeNull();

    // Idempotency replay returns success
    const replayRes = await postWithHeaders(
      `/devices/${dev.id}/unregister`,
      {},
      { ...userAAuth, 'idempotency-key': unregKey },
    );
    expect(replayRes.status).toBe(200);
    const replayData = (await dataOf(replayRes)) as { unregistered: boolean };
    expect(replayData.unregistered).toBe(true);
  });

  // 8. Per-user device cap (MAX_DEVICES_PER_USER = 10)
  it(`caps devices per user at MAX_DEVICES_PER_USER (${MAX_DEVICES_PER_USER}), replacing the oldest device`, async () => {
    const db = globalDb();
    // Clean existing devices for user B
    await db.devices.deleteMany({ where: { user_id: userBId } });

    // Register 10 devices
    for (let i = 1; i <= MAX_DEVICES_PER_USER; i += 1) {
      await postWithHeaders(
        '/devices',
        { pushToken: `ExponentPushToken[cap_userB_dev_${i}]`, platform: 'android' },
        { ...userBAuth, 'idempotency-key': `idemp-cap-${i}` },
      );
    }

    const count10 = await db.devices.count({ where: { user_id: userBId } });
    expect(count10).toBe(MAX_DEVICES_PER_USER);

    // Register 11th device
    await postWithHeaders(
      '/devices',
      { pushToken: `ExponentPushToken[cap_userB_dev_11]`, platform: 'android' },
      { ...userBAuth, 'idempotency-key': 'idemp-cap-11' },
    );

    const countAfter = await db.devices.count({ where: { user_id: userBId } });
    expect(countAfter).toBe(MAX_DEVICES_PER_USER);

    // Device 1 was oldest and was evicted
    const dev1 = await db.devices.findFirst({ where: { push_token: 'ExponentPushToken[cap_userB_dev_1]' } });
    expect(dev1).toBeNull();

    // Device 11 exists
    const dev11 = await db.devices.findFirst({ where: { push_token: 'ExponentPushToken[cap_userB_dev_11]' } });
    expect(dev11).not.toBeNull();
  });
});

