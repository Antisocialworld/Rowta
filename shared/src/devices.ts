// Devices schemas and types (Phase 6 Stage 3; PRD 7.1, 8.7; rules V1, V3).
import { z } from 'zod';

export const EXPO_PUSH_TOKEN_REGEX = /^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_\-]+\]$/;

export const expoPushTokenSchema = z
  .string()
  .trim()
  .regex(EXPO_PUSH_TOKEN_REGEX, 'device.push_token_invalid');

export const devicePlatformSchema = z.enum(['ios', 'android', 'web']);
export type DevicePlatform = z.infer<typeof devicePlatformSchema>;

export const registerDeviceSchema = z.strictObject({
  pushToken: expoPushTokenSchema,
  platform: devicePlatformSchema,
  deviceName: z.string().trim().min(1).max(100).optional(),
  deviceId: z.string().trim().min(1).max(128).optional(),
});
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

export const unregisterDeviceParamsSchema = z.strictObject({
  id: z.string().uuid(),
});
export type UnregisterDeviceParams = z.infer<typeof unregisterDeviceParamsSchema>;

export interface DeviceView {
  id: string;
  platform: string;
  deviceId: string;
  lastSeenAt: string;
  createdAt: string;
}

