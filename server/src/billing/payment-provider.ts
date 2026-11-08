// Payment provider interface (PRD 8.6, Task 4).
// The real provider (Flutterwave) is behind this interface; the dev-only simulator implements
// the same interface. All amounts are in minor units. Provider-unit conversion happens in
// toProviderAmount / fromProviderAmount (server/src/billing/money.ts); the provider unit is
// [VERIFY] and is not assumed here.

export interface CheckoutResult {
  readonly checkoutUrl: string;   // hosted checkout URL the app opens
  readonly txRef: string;         // provider transaction reference
}

export interface VerifyResult {
  readonly status: 'pending' | 'succeeded' | 'failed' | 'expired';
  readonly amountMinor: number;   // provider-reported amount, in minor units
  readonly currency: string;      // provider-reported currency
  readonly authorizationRef?: string; // provider payment authorisation reference (simulator returns one; real provider [VERIFY])
}

export interface ChargeResult {
  readonly status: 'succeeded' | 'failed';
  readonly txRef: string;
  readonly authorizationRef?: string; // provider payment authorisation reference (simulator returns one; real provider [VERIFY])
}

export interface PaymentProvider {
  readonly name: string;
  createCheckout(params: {
    amountMinor: number;
    currency: string;
    txRef: string;
    customerEmail?: string;
  }): Promise<CheckoutResult>;
  verifyTransaction(txRef: string): Promise<VerifyResult>;
  chargeAuthorisation(params: {
    authorizationRef: string;
    amountMinor: number;
    currency: string;
    txRef: string;
  }): Promise<ChargeResult>;
  /** Base checkout URL for a txRef, used to return to the app on idempotent replay. */
  checkoutUrlFor(txRef: string): Promise<string>;
  /** Create a payment authorisation (mandate/token) for a currency. Dev-only simulator implements
   *  this; the real provider is a throwing stub marked [VERIFY]. */
  createAuthorisation(params: {
    currency: string;
    txRef: string;
  }): Promise<{ authorizationRef: string }>;
}
