// Billing holder tests (Task 8, Stage 1).
// Imports from server/src/billing/holder.ts only (plus test helpers).
// Run from the repo root:  npm test --workspace @rowta/server -- billing-holder
import { describe, expect, it } from 'vitest';
import { isBillingHolder, getBillingHolder, takeOverBilling, cancelOpenHandover } from '../src/billing/holder.ts';

describe('billing holder (Task 8)', () => {
  it('isBillingHolder is a function', () => {
    expect(typeof isBillingHolder).toBe('function');
  });
  it('getBillingHolder is a function', () => {
    expect(typeof getBillingHolder).toBe('function');
  });
  it('takeOverBilling is a function', () => {
    expect(typeof takeOverBilling).toBe('function');
  });
  it('cancelOpenHandover is a function', () => {
    expect(typeof cancelOpenHandover).toBe('function');
  });
});
