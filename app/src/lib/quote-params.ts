/**
 * Pure helper for QuoteScreen parameter resolution (Task H16).
 * No React Native dependencies — runnable directly in Node / tsx test runners.
 */
import type { QuoteAction, QuoteParams } from '../state/billing';

export type ResolvedQuoteParams = {
  readonly action: QuoteAction;
  readonly interval?: 'monthly' | 'yearly';
  readonly teamId?: string;
  readonly people?: number;
};

export const DEFAULT_QUOTE_PARAMS: ResolvedQuoteParams = {
  action: 'subscribe',
  interval: 'monthly',
  teamId: undefined,
  people: undefined,
};

export function resolveQuoteParams(quoteParams: QuoteParams): ResolvedQuoteParams {
  if (quoteParams !== null && quoteParams !== undefined) {
    return quoteParams;
  }
  return DEFAULT_QUOTE_PARAMS;
}

