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
 * Convert a major-unit number or string to minor units (e.g. Naira -> kobo)
 * using string/integer parsing with zero floating-point multiplication errors.
 * Rejects numbers with more decimal places than allowed.
 */
export function parseMajorToMinor(amount: number | string | bigint, decimals = 2): number {
  if (typeof amount === 'bigint') {
    amount = Number(amount);
  }
  const str = typeof amount === 'number' ? amount.toString() : amount.trim();
  if (!/^\d+(\.\d+)?$/.test(str)) {
    throw new Error(`Invalid major amount format: ${str}`);
  }
  const [wholeStr, fracStr = ''] = str.split('.');
  if (fracStr.length > decimals) {
    throw new Error(`Amount has more than ${decimals} decimal places: ${str}`);
  }
  const whole = parseInt(wholeStr ?? '0', 10);
  const frac = parseInt((fracStr ?? '').padEnd(decimals, '0'), 10);
  return whole * Math.pow(10, decimals) + frac;
}

/**
 * Convert kobo (minor units) to a decimal string (e.g. 650000 -> "6500.00")
 * using integer math only (no float operations).
 */
export function koboToDecimalString(kobo: number | bigint): string {
  const koboNum = typeof kobo === 'bigint' ? Number(kobo) : kobo;
  if (!Number.isInteger(koboNum) || koboNum < 0) {
    throw new Error(`Invalid minor amount: ${kobo}`);
  }
  const major = Math.floor(koboNum / 100);
  const minor = koboNum % 100;
  return `${major}.${minor.toString().padStart(2, '0')}`;
}

/**
 * Convert provider units to minor units (our storage) for comparison with stored intents.
 * Uses exact decimal-string parsing for major units; rejects more than 2 decimals.
 * Accepts number | bigint because database amount_minor columns are bigint.
 */
export function fromProviderAmount(providerAmount: number | bigint, currencyCode: string): number | null {
  const config = currencyConfig(currencyCode);
  if (config === null) return null;
  if (config.providerUnit === 'minor') {
    const minorNum = toSafeInteger(providerAmount, 'providerAmount');
    return minorNum;
  }
  return parseMajorToMinor(providerAmount, config.minorUnit);
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
