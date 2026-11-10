// Phase 5 route/limit inventory: every swap route declares a registered limit id
// with an explicit fail mode (rules S14; skill rowta-rate-limiting-recipes).
import { describe, expect, it } from 'vitest';
import { registeredRoutes } from '../src/http/routes.ts';
import { LIMITS, limitDef } from '../src/security/limits.ts';
import { createSwapsRouter } from '../src/swaps/routes.ts';

describe('Phase 5 rate-limit inventory', () => {
  createSwapsRouter();

  const phase5Routes = registeredRoutes().filter(
    (route) =>
      route.path.includes('/swaps') ||
      route.path.endsWith('/swap'),
  );

  it('registers all six Phase 5 routes', () => {
    const keys = phase5Routes.map((route) => `${route.method} ${route.path}`).sort();
    expect(keys).toEqual([
      'GET /teams/:teamId/swaps',
      'GET /teams/:teamId/swaps/:swapId',
      'POST /teams/:teamId/shifts/:shiftId/swap',
      'POST /teams/:teamId/swaps',
      'POST /teams/:teamId/swaps/:swapId/cancel',
      'POST /teams/:teamId/swaps/:swapId/decide',
    ]);
  });

  it('gives every Phase 5 route a known limit id and requires auth', () => {
    for (const route of phase5Routes) {
      expect(route.limitIds.length).toBeGreaterThan(0);
      expect(route.auth).toBe(true);
      for (const id of route.limitIds) {
        expect(() => limitDef(id)).not.toThrow();
      }
    }
  });

  it('declares the five Phase 5 limits with explicit fail modes', () => {
    const expected = new Map([
      ['swap.request', 'C'],
      ['swaps.list', 'O'],
      ['swap.get', 'O'],
      ['swap.decide', 'C'],
      ['swap.cancel', 'C'],
    ]);
    for (const [id, mode] of expected) {
      const def = LIMITS.find((row) => row.id === id);
      expect(def, `limit ${id} is missing`).toBeDefined();
      expect(def?.failMode).toBe(mode);
    }
  });
});

