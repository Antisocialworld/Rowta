// Devices service (Phase 6 Stage 3; PRD 7.1, 8.7; rules S5, S7, S9, S14, V1, V3).
// Owns device registration, token uniqueness & ownership transfer, token rotation,
// per-user device cap (10), unregistration with uniform 404 response, and strict masking of push tokens.
import type { RegisterDeviceInput, DeviceView } from '@rowta/shared';
import { AUTH_MESSAGES } from '@rowta/shared';
import { globalDb, type JsonInput } from '../db/clients.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { HttpError } from '../middleware/error.ts';
import { fingerprint } from '../security/fingerprint.ts';
import { maskPushToken } from '../push/client.ts';
import { logger } from '../lib/logger.ts';

export const MAX_DEVICES_PER_USER = 10;

function isUniqueConstraintError(err: unknown): boolean {
  if (isUniqueViolation(err)) return true;
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: unknown }).code;
    return code === '23505' || code === 'P2002';
  }
  return false;
}

function toDeviceView(row: {
  id: string;
  platform: string;
  device_id: string;
  last_seen_at: Date;
  created_at: Date;
}): DeviceView {
  return {
    id: row.id,
    platform: row.platform,
    deviceId: row.device_id,
    lastSeenAt: row.last_seen_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Enforce max devices per user. If at or above limit, evict the oldest device by last_seen_at.
 */
async function enforceDeviceCap(userId: string, db: ReturnType<typeof globalDb>): Promise<void> {
  const count = await db.devices.count({ where: { user_id: userId } });
  if (count >= MAX_DEVICES_PER_USER) {
    const excess = count - MAX_DEVICES_PER_USER + 1;
    const oldest = await db.devices.findMany({
      where: { user_id: userId },
      orderBy: { last_seen_at: 'asc' },
      take: excess,
      select: { id: true },
    });
    const idsToEvict = oldest.map((d) => d.id);
    if (idsToEvict.length > 0) {
      await db.devices.deleteMany({
        where: { id: { in: idsToEvict } },
      });
      logger.info({ userId, evictedCount: idsToEvict.length }, 'Evicted oldest device(s) due to cap');
    }
  }
}

/**
 * Core registration attempt.
 * Handles:
 * 1. Token rotation (Item 2 & 3): if (user, deviceId) exists, delete old row holding new token
 *    and update user's row atomically in one db.$transaction.
 * 2. Ownership transfer: if token exists on another user/device, transfer ownership to this user.
 * 3. Brand new device: enforce device cap (10) and insert.
 */
async function executeRegisterDevice(
  userId: string,
  input: RegisterDeviceInput,
  deviceIdStr: string,
  db: ReturnType<typeof globalDb>,
): Promise<DeviceView> {
  const rowByToken = await db.devices.findFirst({
    where: { push_token: input.pushToken },
  });

  const rowByUserDevice = await db.devices.findUnique({
    where: {
      user_id_device_id: {
        user_id: userId,
        device_id: deviceIdStr,
      },
    },
  });

  let resultRow: {
    id: string;
    platform: string;
    device_id: string;
    last_seen_at: Date;
    created_at: Date;
  };

  if (rowByUserDevice) {
    // ROTATION or KEEP-ALIVE (Item 2 & Item 3):
    // Registering the same (user, deviceId) with a NEW push token updates that row's token and last_seen.
    // Deleting the old row holding this token and updating the user's row happens atomically in one $transaction.
    if (rowByToken && rowByToken.id !== rowByUserDevice.id) {
      resultRow = await db.$transaction(async (tx) => {
        await tx.devices.delete({ where: { id: rowByToken.id } });
        return tx.devices.update({
          where: { id: rowByUserDevice.id },
          data: {
            push_token: input.pushToken,
            platform: input.platform,
            last_seen_at: new Date(),
          },
        });
      });
    } else {
      resultRow = await db.devices.update({
        where: { id: rowByUserDevice.id },
        data: {
          push_token: input.pushToken,
          platform: input.platform,
          last_seen_at: new Date(),
        },
      });
    }

    logger.info(
      { userId, deviceId: resultRow.id, token: maskPushToken(input.pushToken) },
      'Device push token rotated/refreshed',
    );
  } else if (rowByToken) {
    // OWNERSHIP TRANSFER:
    // Device token was previously registered by another user/device. Transfer to this user.
    if (rowByToken.user_id !== userId) {
      await enforceDeviceCap(userId, db);
    }

    resultRow = await db.devices.update({
      where: { id: rowByToken.id },
      data: {
        user_id: userId,
        device_id: deviceIdStr,
        platform: input.platform,
        last_seen_at: new Date(),
      },
    });

    logger.info(
      { userId, deviceId: resultRow.id, token: maskPushToken(input.pushToken) },
      'Device push token ownership transferred',
    );
  } else {
    // BRAND NEW DEVICE:
    await enforceDeviceCap(userId, db);

    resultRow = await db.devices.create({
      data: {
        user_id: userId,
        device_id: deviceIdStr,
        push_token: input.pushToken,
        platform: input.platform,
        last_seen_at: new Date(),
      },
    });

    logger.info(
      { userId, deviceId: resultRow.id, token: maskPushToken(input.pushToken) },
      'New device registered',
    );
  }

  return toDeviceView(resultRow);
}

/**
 * Register a device with an Expo push token.
 * Token is unique across the whole system: if it exists, ownership moves to the signed-in user.
 * Oldest device by last_seen_at is evicted when user exceeds MAX_DEVICES_PER_USER (10).
 * Unique violations (23505 / P2002) from concurrent races are caught and retried deterministically.
 */
export async function registerDevice(
  userId: string,
  input: RegisterDeviceInput,
  idempotencyKey: string | undefined,
): Promise<DeviceView> {
  if (!idempotencyKey || idempotencyKey.trim().length === 0) {
    throw new HttpError(400, 'idempotency.missing', 'Idempotency-Key header is required.');
  }

  const db = globalDb();
  const scope = `device_register:${userId}`;
  const fp = fingerprint(
    JSON.stringify({
      pushToken: input.pushToken,
      platform: input.platform,
      deviceName: input.deviceName ?? null,
      deviceId: input.deviceId ?? null,
    }),
  );

  // 1. Idempotency replay check
  const existingKey = await db.idempotency_keys.findUnique({
    where: { scope_key: { scope, key: idempotencyKey } },
  });
  if (existingKey) {
    if (existingKey.request_fingerprint !== fp) {
      throw new HttpError(
        422,
        'idempotency.fingerprint_mismatch',
        'Idempotency key has already been used with a different request payload.',
      );
    }
    if (existingKey.state === 'in_flight') {
      throw new HttpError(409, 'idempotency.in_flight', 'A request with this idempotency key is already in progress.');
    }
    if (existingKey.state === 'done' && existingKey.response && typeof existingKey.response === 'object') {
      return existingKey.response as unknown as DeviceView;
    }
  }

  // 2. Insert in_flight record using real schema columns only
  try {
    await db.idempotency_keys.create({
      data: {
        scope,
        key: idempotencyKey,
        request_fingerprint: fp,
        state: 'in_flight',
      },
    });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      const racedKey = await db.idempotency_keys.findUnique({
        where: { scope_key: { scope, key: idempotencyKey } },
      });
      if (racedKey) {
        if (racedKey.request_fingerprint !== fp) {
          throw new HttpError(
            422,
            'idempotency.fingerprint_mismatch',
            'Idempotency key has already been used with a different request payload.',
          );
        }
        if (racedKey.state === 'in_flight') {
          throw new HttpError(409, 'idempotency.in_flight', 'A request with this idempotency key is already in progress.');
        }
        if (racedKey.state === 'done' && racedKey.response && typeof racedKey.response === 'object') {
          return racedKey.response as unknown as DeviceView;
        }
      }
    }
    throw err;
  }

  const deviceIdStr =
    input.deviceId ??
    (input.deviceName
      ? `${input.deviceName}-${input.pushToken.slice(-12, -1)}`
      : `dev-${input.pushToken.slice(-12, -1)}`);

  try {
    let view: DeviceView;

    try {
      view = await executeRegisterDevice(userId, input, deviceIdStr, db);
    } catch (err: unknown) {
      if (isUniqueConstraintError(err)) {
        // RACE: Two requests registered the same push token or (user, deviceId) concurrently.
        // Catch Postgres 23505 / Prisma P2002 and retry once deterministically.
        logger.warn(
          { userId, token: maskPushToken(input.pushToken) },
          'Unique constraint race detected on registerDevice; retrying once deterministically',
        );
        view = await executeRegisterDevice(userId, input, deviceIdStr, db);
      } else {
        throw err;
      }
    }

    // Mark idempotency key done with status_code 201
    await db.idempotency_keys.update({
      where: { scope_key: { scope, key: idempotencyKey } },
      data: {
        state: 'done',
        status_code: 201,
        response: view as unknown as JsonInput,
      },
    });

    return view;
  } catch (err: unknown) {
    // Delete in_flight record on failure so retries can succeed
    await db.idempotency_keys
      .delete({
        where: { scope_key: { scope, key: idempotencyKey } },
      })
      .catch(() => undefined);
    throw err;
  }
}

/**
 * Unregister a device by its ID.
 * Returns uniform 404 device.notFound if the device does not exist or does not belong to the user.
 */
export async function unregisterDevice(
  userId: string,
  deviceId: string,
  idempotencyKey: string | undefined,
): Promise<{ unregistered: true }> {
  if (!idempotencyKey || idempotencyKey.trim().length === 0) {
    throw new HttpError(400, 'idempotency.missing', 'Idempotency-Key header is required.');
  }

  const db = globalDb();
  const scope = `device_unregister:${userId}:${deviceId}`;
  const fp = fingerprint(JSON.stringify({ deviceId }));

  // Check idempotency
  const existingKey = await db.idempotency_keys.findUnique({
    where: { scope_key: { scope, key: idempotencyKey } },
  });
  if (existingKey) {
    if (existingKey.request_fingerprint !== fp) {
      throw new HttpError(
        422,
        'idempotency.fingerprint_mismatch',
        'Idempotency key has already been used with a different request payload.',
      );
    }
    if (existingKey.state === 'in_flight') {
      throw new HttpError(409, 'idempotency.in_flight', 'A request with this idempotency key is already in progress.');
    }
    if (existingKey.state === 'done') {
      return (existingKey.response as { unregistered: true }) ?? { unregistered: true };
    }
  }

  try {
    await db.idempotency_keys.create({
      data: {
        scope,
        key: idempotencyKey,
        request_fingerprint: fp,
        state: 'in_flight',
      },
    });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      const racedKey = await db.idempotency_keys.findUnique({
        where: { scope_key: { scope, key: idempotencyKey } },
      });
      if (racedKey) {
        if (racedKey.request_fingerprint !== fp) {
          throw new HttpError(
            422,
            'idempotency.fingerprint_mismatch',
            'Idempotency key has already been used with a different request payload.',
          );
        }
        if (racedKey.state === 'in_flight') {
          throw new HttpError(409, 'idempotency.in_flight', 'A request with this idempotency key is already in progress.');
        }
        if (racedKey.state === 'done') {
          return (racedKey.response as { unregistered: true }) ?? { unregistered: true };
        }
      }
    }
    throw err;
  }

  try {
    const device = await db.devices.findFirst({
      where: { id: deviceId, user_id: userId },
    });

    if (!device) {
      throw new HttpError(404, 'device.notFound', AUTH_MESSAGES['device.notFound']);
    }

    await db.devices.delete({
      where: { id: device.id },
    });

    logger.info({ userId, deviceId }, 'Device unregistered');

    const result = { unregistered: true as const };

    await db.idempotency_keys.update({
      where: { scope_key: { scope, key: idempotencyKey } },
      data: {
        state: 'done',
        status_code: 200,
        response: result as unknown as JsonInput,
      },
    });

    return result;
  } catch (err: unknown) {
    // Delete in_flight record on failure so retries can succeed
    await db.idempotency_keys
      .delete({
        where: { scope_key: { scope, key: idempotencyKey } },
      })
      .catch(() => undefined);
    throw err;
  }
}
