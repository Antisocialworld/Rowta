/**
 * Shared account status polling routine (PRD 8.6, Task H10 / H13).
 * Pure TypeScript module (no react-native imports) used by both QuoteScreen and App.tsx.
 * Polls GET /billing/account every intervalMs (default 2s) up to timeoutMs (default 30s)
 * until account status is 'active'.
 */
import { billingApi } from '../api/billing';

export type AccountStatusFetcher = () => Promise<{ account?: { status?: string } | null }>;

export interface PollAccountOptions {
  timeoutMs?: number;
  intervalMs?: number;
  shouldContinue?: () => boolean;
  fetchStatus?: AccountStatusFetcher;
}

export async function pollAccountActive(options: PollAccountOptions = {}): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const shouldContinue = options.shouldContinue ?? (() => true);
  const fetchStatus = options.fetchStatus ?? (() => billingApi.accountStatus());

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!shouldContinue()) return false;
    try {
      const acc = await fetchStatus();
      if (acc.account?.status === 'active') return true;
    } catch {
      // transient network or server error while polling; retry until deadline
    }
    if (!shouldContinue()) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

