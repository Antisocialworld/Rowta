// Phase 4 route/limit inventory: every shift, activity and search route declares a registered limit id
// with an explicit fail mode (rules S14; skill rowta-rate-limiting-recipes).
import { describe, expect, it } from 'vitest';
import { registeredRoutes } from '../src/http/routes.ts';
import { LIMITS, limitDef } from '../src/security/limits.ts';
import { createShiftsRouter } from '../src/shifts/routes.ts';

describe('Phase 4 rate-limit inventory', () => {
  createShiftsRouter();

  const phase4Routes = registeredRoutes().filter(
    (route) =>
      route.path.includes('/shifts') ||
      route.path.endsWith('/activity') ||
      route.path.endsWith('/search'),
  );

  it('registers all seven Phase 4 routes', () => {
    const keys = phase4Routes.map((route) => `${route.method} ${route.path}`).sort();
    expect(keys).toEqual([
      'GET /teams/:teamId/activity',
      'GET /teams/:teamId/search',
      'GET /teams/:teamId/shifts',
      'GET /teams/:teamId/shifts/:shiftId',
      'POST /teams/:teamId/shifts',
      'POST /teams/:teamId/shifts/:shiftId/delete',
      'POST /teams/:teamId/shifts/:shiftId/update',
    ]);
  });

  it('gives every Phase 4 route a known limit id and requires auth', () => {
    for (const route of phase4Routes) {
      expect(route.limitIds.length).toBeGreaterThan(0);
      expect(route.auth).toBe(true);
      for (const id of route.limitIds) {
        expect(() => limitDef(id)).not.toThrow();
      }
    }
  });

  it('declares the four Phase 4 limits with explicit fail modes', () => {
    const expected = new Map([
      ['shift.read', 'O'],
      ['shift.write', 'C'],
      ['activity.read', 'O'],
      ['search.read', 'O'],
    ]);
    for (const [id, mode] of expected) {
      const def = LIMITS.find((row) => row.id === id);
      expect(def, `limit ${id} is missing`).toBeDefined();
      expect(def?.failMode).toBe(mode);
    }
  });
});
