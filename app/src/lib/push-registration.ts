// Push registration — registers the Expo push token with the Rowta server once per
// signed-in session (PRD 7.1, 8.7). Pure decision helpers are exported for testing.
// Never logs or prints a push token (S1, S9).
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { devicesApi } from './api';
import { useShiftNav } from '../state/shift-nav';

// ---------------------------------------------------------------------------------------------
// Pure decision helpers (exported for testing)
// ---------------------------------------------------------------------------------------------

/** True only when iOS notification permission has not yet been asked. */
export function shouldAskPermission(iosStatus: Notifications.IosAuthorizationStatus | null | undefined): boolean {
  return iosStatus === Notifications.IosAuthorizationStatus.NOT_DETERMINED;
}

/** True only when permission was granted. */
export function shouldRegister(granted: boolean): boolean {
  return granted === true;
}

/** True only when the payload is a shift-only tap with a non-empty shiftId. */
export function isShiftTap(data: unknown): data is { type: 'shift'; shiftId: string } {
  if (!data || typeof data !== 'object') return false;
  const record = data as Record<string, unknown>;
  return record.type === 'shift' && typeof record.shiftId === 'string' && record.shiftId.length > 0;
}

// ---------------------------------------------------------------------------------------------
// Idempotency key — same pattern as state/teams.ts:65-73
// ---------------------------------------------------------------------------------------------

function newIdempotencyKey(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c !== undefined && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ---------------------------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------------------------

/** Register the Expo push token with the server once per signed-in session.
 *  Swallows all failures so registration can never crash or block the app.
 *  On the next app start (next mount while signed in) the caller may try once more.
 */
export async function registerPushDevice(): Promise<void> {
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (shouldAskPermission(permission.ios?.status ?? null)) {
      const result = await Notifications.requestPermissionsAsync();
      if (!shouldRegister(result.granted)) return; // denied — stop silently, no UI, no retry loop
    }

    const expoPushToken = await Notifications.getExpoPushTokenAsync({});
    const platform = Platform.OS as 'ios' | 'android' | 'web';

    const idempotencyKey = newIdempotencyKey();
    await devicesApi.registerDevice(
      {
        pushToken: expoPushToken.data,
        platform,
        deviceName: 'Rowta',
      },
      idempotencyKey
    );
  } catch {
    // Swallow every error — network, missing projectId, 4xx/5xx, etc. Never crash or block.
  }
}

// ---------------------------------------------------------------------------------------------
// Foreground notification handler (set once)
// ---------------------------------------------------------------------------------------------

/** Show banner and list, no sound, no badge while the app is open. */
export function setupNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

// ---------------------------------------------------------------------------------------------
// Notification tap listener
// ---------------------------------------------------------------------------------------------

/** Handle a tap on a notification. Only shift payloads open the shift detail screen. */
export function setupTapListener(): Notifications.EventSubscription {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data;
    if (isShiftTap(data)) {
      useShiftNav.getState().open({ name: 'detail', shiftId: data.shiftId });
    }
    // Every other payload is ignored.
  });
}

// ---------------------------------------------------------------------------------------------
// Cold-start notification (app started from a tap while not running)
// ---------------------------------------------------------------------------------------------

/** If the app was cold-started by a notification tap, handle it once with the same
 *  shift-only validation, then clear the stored response so it is not handled again.
 */
export async function handleColdStartNotification(): Promise<void> {
  try {
    const response = Notifications.getLastNotificationResponse();
    if (!response) return;
    const data = response.notification.request.content.data;
    if (isShiftTap(data)) {
      useShiftNav.getState().open({ name: 'detail', shiftId: data.shiftId });
    }
    Notifications.clearLastNotificationResponse();
  } catch {
    // Swallow — cold-start handling must never crash the app.
  }
}
