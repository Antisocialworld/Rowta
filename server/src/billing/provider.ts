// Payment provider resolver (F7, PRD 8.6).
// Single source for resolvePaymentProvider(): simulator when PAYMENT_SIMULATOR_ENABLED=true,
// otherwise a typed stub that throws. service.ts and webhook-processor.ts import from here;
// their duplicate resolvers are deleted.

import { env } from '../config/env.ts';
import type { PaymentProvider } from './payment-provider.ts';
import { simulatorProvider } from './simulator.ts';

/** Resolve the payment provider: simulator when enabled, otherwise a throwing stub. */
export function resolvePaymentProvider(): PaymentProvider {
  if (env.PAYMENT_SIMULATOR_ENABLED) return simulatorProvider;
  return {
    name: 'stub-provider',
    async createCheckout() {
      throw new Error('provider not configured');
    },
    async verifyTransaction() {
      throw new Error('provider not configured');
    },
    async chargeAuthorisation() {
      throw new Error('provider not configured');
    },
    async checkoutUrlFor() {
      throw new Error('provider not configured');
    },
    async createAuthorisation() {
      throw new Error('provider not configured');
    },
  };
}
