// Payment provider resolver (F7, PRD 8.6, G6b B2).
// Single source for resolvePaymentProvider(): simulator when PAYMENT_SIMULATOR_ENABLED=true,
// otherwise real FlutterwaveClient. service.ts and webhook-processor.ts import from here.

import { env } from '../config/env.ts';
import type { PaymentProvider } from './payment-provider.ts';
import { simulatorProvider } from './simulator.ts';
import { flutterwaveProvider } from './flutterwave-client.ts';

/** Resolve the payment provider: simulator when enabled, otherwise live Flutterwave client. */
export function resolvePaymentProvider(): PaymentProvider {
  if (env.PAYMENT_SIMULATOR_ENABLED) return simulatorProvider;
  return flutterwaveProvider;
}
