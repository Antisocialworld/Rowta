// Money formatting (Task B2, PRD 8.6).
// Money is integer minor units (kobo for NGN). Format to naira with integer arithmetic —
// no floats anywhere. Rule: format minor units / 10^minor_unit using Intl.NumberFormat.
// Currency decimals are duplicated here (server source of truth is server/src/billing/proration.ts
// currencyDecimals); this is a client-side mirror for display only.
const CURRENCY_DECIMALS: Record<string, number> = { NGN: 2, USD: 2, JPY: 0 };

export function currencyDecimalsApp(code: string): number {
  return CURRENCY_DECIMALS[code.toUpperCase()] ?? 2;
}

// formatMinorToNaira formats minor units (kobo) to a naira display string.
// Uses Intl.NumberFormat with en-NG locale and NGN currency. Never produces floats in code.
export function formatMinorToNaira(amountMinor: number, currencyCode: string = 'NGN'): string {
  const decimals = currencyDecimalsApp(currencyCode);
  const major = amountMinor / Math.pow(10, decimals);
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(major);
}
