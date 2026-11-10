// Account-level billing state (C8).
// Zustand store for billing UI state, keyed so a plan change refreshes everything.
// Every action key is generated once per user action and reused on retry (rule S14).
import { create } from 'zustand';

export type HandoverStatus = 'requested' | 'accepted' | 'declined' | 'cancelled' | 'expired';

export type BillingHandover = {
  id: string;
  status: HandoverStatus;
  fromUserId: string;
  toUserId: string;
  expiresAt: string;
  createdAt: string;
  resolvedAt: string | null;
  isExpired: boolean;
};

export type BillingSubscription = {
  plan: string;
  seats: number;
  status: string;
  interval: string;
  currency: string;
};

export type BillingIntent = {
  status: string;
  amountMinor: number;
  currency: string;
};

export type AccountStatus = {
  userId: string;
  plan: string;
  status: string;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  trialUsed: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  currency: string;
};

export type PlanEntitlements = {
  interval: string;
  basePriceMinor: number;
  freeTeams: number;
  extraTeamPriceMinor: number;
  peoplePerTeam: number;
  extraPersonPriceMinor: number;
  maxTeams: number;
  maxPeoplePerTeam: number;
  trialDays: number;
  trialTeams: number;
  trialPeople: number;
  minAddonChargeMinor: number;
};

export type BillingMove = {
  id: string;
  status: HandoverStatus;
  fromUserId: string;
  toUserId: string;
  teamId: string;
  expiresAt: string;
  createdAt: string;
  resolvedAt: string | null;
};

export type QuoteAction = 'subscribe' | 'add_team' | 'add_people' | 'switch_interval';

export type QuoteParams = {
  readonly action: QuoteAction;
  readonly interval?: 'monthly' | 'yearly';
  readonly teamId?: string;
  readonly people?: number;
} | null;

export type BillingState = {
  // Per-team legacy subscription (kept for compatibility during transition).
  subscription: BillingSubscription | null;
  intent: BillingIntent | null;
  handover: BillingHandover | null;
  // Account-level state (C8).
  account: AccountStatus | null;
  entitlements: PlanEntitlements | null;
  move: BillingMove | null;
  loading: boolean;
  error: string | null;
  /** Params carried from the previous screen into QuoteScreen (action, interval, teamId, people). */
  quoteParams: QuoteParams;
  // Idempotency keys per in-flight action, keyed by action name.
  idempotencyKeys: Record<string, string>;
  setSubscription: (sub: BillingSubscription | null) => void;
  setIntent: (intent: BillingIntent | null) => void;
  setHandover: (h: BillingHandover | null) => void;
  // Account-level setters.
  setAccount: (account: AccountStatus | null) => void;
  setEntitlements: (e: PlanEntitlements | null) => void;
  setMove: (m: BillingMove | null) => void;
  setQuoteParams: (p: QuoteParams) => void;
  clearQuoteParams: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  /** Returns the current attempt's key, generating one only when there is none yet. */
  ensureKey: (action: string) => string;
  clearKey: (action: string) => void;
  /** Generates a fresh key for a retry after a failure. */
  newKey: (action: string) => string;
  /** Refresh everything after a plan change (called by screens after a successful mutation). */
  refresh: () => void;
};

function newIdempotencyKey(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c !== undefined && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const useBilling = create<BillingState>((set, get) => ({
  subscription: null,
  intent: null,
  handover: null,
  account: null,
  entitlements: null,
  move: null,
  loading: false,
  error: null,
  quoteParams: null,
  idempotencyKeys: {},
  setSubscription: (sub) => set({ subscription: sub }),
  setIntent: (intent) => set({ intent }),
  setHandover: (handover) => set({ handover }),
  setAccount: (account) => set({ account }),
  setEntitlements: (entitlements) => set({ entitlements }),
  setMove: (move) => set({ move }),
  setQuoteParams: (p) => set({ quoteParams: p }),
  clearQuoteParams: () => set({ quoteParams: null }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  ensureKey: (action) => {
    const existing = get().idempotencyKeys[action];
    if (existing !== null && existing !== undefined) return existing;
    const key = newIdempotencyKey();
    set((state) => ({ idempotencyKeys: { ...state.idempotencyKeys, [action]: key } }));
    return key;
  },
  clearKey: (action) => {
    set((state) => {
      const { [action]: _removed, ...rest } = state.idempotencyKeys;
      return { idempotencyKeys: rest };
    });
  },
  newKey: (action) => {
    const key = newIdempotencyKey();
    set((state) => ({ idempotencyKeys: { ...state.idempotencyKeys, [action]: key } }));
    return key;
  },
  refresh: () => set((state) => ({ ...state })),
}));
