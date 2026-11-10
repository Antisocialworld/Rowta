// Phase 6 Stage 3 rate-limit inventory: devices routes declare registered limit ids
// with explicit fail modes (rules S14; skill rowta-rate-limiting-recipes).
import { describe, expect, it } from 'vitest';
import { registeredRoutes } from '../src/http/routes.ts';
import { LIMITS, limitDef } from '../src/security/limits.ts';
import { createDevicesRouter } from '../src/devices/routes.ts';

describe('Phase 6 Stage 3 devices rate-limit inventory', () => {
  createDevicesRouter();

  const deviceRoutes = registeredRoutes().filter(
    (route) => route.path === '/devices' || route.path === '/devices/:id/unregister',
  );

  it('registers both Phase 6 Stage 3 devices routes', () => {
    const keys = deviceRoutes.map((route) => `${route.method} ${route.path}`).sort();
    expect(keys).toEqual([
      'POST /devices',
      'POST /devices/:id/unregister',
    ]);
  });

  it('gives every devices route a known limit id and requires auth', () => {
    for (const route of deviceRoutes) {
      expect(route.limitIds.length).toBeGreaterThan(0);
      expect(route.auth).toBe(true);
      for (const id of route.limitIds) {
        expect(() => limitDef(id)).not.toThrow();
      }
    }
  });

  it('declares the two Phase 6 devices limits with explicit fail modes and values', () => {
    const regDef = LIMITS.find((row) => row.id === 'device.register');
    expect(regDef, 'device.register limit is missing').toBeDefined();
    expect(regDef?.key).toBe('user');
    expect(regDef?.max).toBe(30);
    expect(regDef?.windowSec).toBe(60);
    expect(regDef?.failMode).toBe('C');

    const unregDef = LIMITS.find((row) => row.id === 'device.unregister');
    expect(unregDef, 'device.unregister limit is missing').toBeDefined();
    expect(unregDef?.key).toBe('user');
    expect(unregDef?.max).toBe(30);
    expect(unregDef?.windowSec).toBe(60);
    expect(unregDef?.failMode).toBe('C');
  });
});

