// Phase 6 route/limit inventory: settings routes declare registered limit ids
// with explicit fail modes (rules S14; skill rowta-rate-limiting-recipes).
import { describe, expect, it } from 'vitest';
import { registeredRoutes } from '../src/http/routes.ts';
import { LIMITS, limitDef } from '../src/security/limits.ts';
import { createSettingsRouter } from '../src/settings/routes.ts';

describe('Phase 6 settings rate-limit inventory', () => {
  createSettingsRouter();

  const settingsRoutes = registeredRoutes().filter((route) => route.path === '/me/settings');

  it('registers both Phase 6 settings routes', () => {
    const keys = settingsRoutes.map((route) => `${route.method} ${route.path}`).sort();
    expect(keys).toEqual([
      'GET /me/settings',
      'POST /me/settings',
    ]);
  });

  it('gives every settings route a known limit id and requires auth', () => {
    for (const route of settingsRoutes) {
      expect(route.limitIds.length).toBeGreaterThan(0);
      expect(route.auth).toBe(true);
      for (const id of route.limitIds) {
        expect(() => limitDef(id)).not.toThrow();
      }
    }
  });

  it('declares the two Phase 6 limits with explicit fail modes and values', () => {
    const readDef = LIMITS.find((row) => row.id === 'settings.read');
    expect(readDef, 'settings.read limit is missing').toBeDefined();
    expect(readDef?.key).toBe('user');
    expect(readDef?.max).toBe(120);
    expect(readDef?.windowSec).toBe(60);
    expect(readDef?.failMode).toBe('O');

    const writeDef = LIMITS.find((row) => row.id === 'settings.write');
    expect(writeDef, 'settings.write limit is missing').toBeDefined();
    expect(writeDef?.key).toBe('user');
    expect(writeDef?.max).toBe(30);
    expect(writeDef?.windowSec).toBe(60);
    expect(writeDef?.failMode).toBe('C');
  });
});

