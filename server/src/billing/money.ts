// Money conversion between minor units (our storage, bigint) and provider units.
// The provider's expected unit per currency is [VERIFY] — not confirmed from the provider's
// current docs. Default: minor units (matches our storage). Change PROVIDER_UNIT per currency
// when confirmed; never assume.
//
// No floats are stored or persisted; conversion happens only at the provider boundary
// (checkout creation and webhook re-verification).

export type ProviderUnit = 'minor' | 'major';

export interface CurrencyConfig {
  readonly code: string;           // ISO 4217
  readonly minorUnit: number;      // currencies.minor_unit (decimals: 0, 2, or 3)
  readonly providerUnit: ProviderUnit; // [VERIFY] the unit the provider expects
}

export const PROVIDER_UNIT: Record<string, ProviderUnit> = {
  // [VERIFY] Flutterwave expects NAIRA (major units) per the owner (6 Nov 2026).
  // Confirm once in the Flutterwave sandbox before real provider keys are used.
  // NGN providerUnit = 'major': toProviderAmount converts kobo -> naira,
  // fromProviderAmount converts naira -> kobo.
  NGN: 'major',
  USD: 'minor',
  JPY: 'minor',
  EUR: 'minor',
  GBP: 'minor',
  KWD: 'minor',
};

export const CURRENCY_MINOR_UNIT: Record<string, number> = {
  NGN: 2,
  USD: 2,
  JPY: 0,
  EUR: 2,
  GBP: 2,
  KWD: 3,
};

export function currencyConfig(code: string): CurrencyConfig | null {
  const key = code.toUpperCase();
  const minorUnit = CURRENCY_MINOR_UNIT[key];
  const providerUnit = PROVIDER_UNIT[key];
  if (minorUnit === undefined || providerUnit === undefined) return null;
  return { code: key, minorUnit, providerUnit };
}

/**
 * Convert minor units (our storage) to provider units for the payment provider.
 * Provider unit is [VERIFY]; confirm before using real provider keys.
 * Returns null for unknown currency.
 * Accepts number | bigint because database amount_minor columns are bigint.
 */
export function toProviderAmount(minor: number | bigint, currencyCode: string): number | null {
  const config = currencyConfig(currencyCode);
  if (config === null) return null;
  const minorNum = toSafeInteger(minor, 'minor');
  if (minorNum === null) return null;
  if (config.providerUnit === 'minor') return minorNum;
  return minorNum / Math.pow(10, config.minorUnit);
}

/**
 * Convert provider units to minor units (our storage) for comparison with stored intents.
 * Provider unit is [VERIFY]; confirm before using real provider keys.
 * Returns null for unknown currency or non-exact conversion.
 * Accepts number | bigint because database amount_minor columns are bigint.
 */
export function fromProviderAmount(providerAmount: number | bigint, currencyCode: string): number | null {
  const config = currencyConfig(currencyCode);
  if (config === null) return null;
  const providerNum = toSafeInteger(providerAmount, 'providerAmount');
  if (providerNum === null) return null;
  if (config.providerUnit === 'minor') return providerNum;
  const minor = providerNum * Math.pow(10, config.minorUnit);
  if (!Number.isInteger(minor)) throw new Error(`fromProviderAmount: provider amount ${providerAmount} cannot be represented exactly in minor units for ${config.code}`);
  return minor;
}

/**
 * Coerce a number | bigint to a safe number. Returns null when the value is a bigint that
 * cannot be represented exactly as a number (safe-integer guard). Database amount_minor
 * columns are bigint; JavaScript numbers are safe only up to 2^53 - 1.
 */
function toSafeInteger(value: number | bigint, label: string): number | null {
  if (typeof value === 'bigint') {
    if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`${label} ${value.toString()} is outside the safe integer range`);
    }
    return Number(value);
  }
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer`);
  return value;
}
