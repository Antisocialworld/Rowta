// Simulator boot-guard test (Task 4).
// Proves the server refuses to start when PAYMENT_SIMULATOR_ENABLED is true in production.
// Imports ONLY assertNotProductionSimulator from src/config/env.ts.
import { describe, expect, it } from 'vitest';
import { assertNotProductionSimulator } from '../src/config/env.ts';

describe('payment simulator boot guard (rule P7)', () => {
  it('refuses to boot when PAYMENT_SIMULATOR_ENABLED=true and NODE_ENV=production', () => {
    expect(() =>
      assertNotProductionSimulator({ NODE_ENV: 'production', PAYMENT_SIMULATOR_ENABLED: true } as never),
    ).toThrow(/PAYMENT_SIMULATOR_ENABLED/);
  });
  it('allows boot when PAYMENT_SIMULATOR_ENABLED=false in production', () => {
    expect(() =>
      assertNotProductionSimulator({ NODE_ENV: 'production', PAYMENT_SIMULATOR_ENABLED: false } as never),
    ).not.toThrow();
  });
  it('allows boot when NODE_ENV=development and PAYMENT_SIMULATOR_ENABLED=true', () => {
    expect(() =>
      assertNotProductionSimulator({ NODE_ENV: 'development', PAYMENT_SIMULATOR_ENABLED: true } as never),
    ).not.toThrow();
  });
  it('allows boot when NODE_ENV=test and PAYMENT_SIMULATOR_ENABLED=true', () => {
    expect(() =>
      assertNotProductionSimulator({ NODE_ENV: 'test', PAYMENT_SIMULATOR_ENABLED: true } as never),
    ).not.toThrow();
  });
});
