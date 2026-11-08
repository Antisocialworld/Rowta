// Account-level billing API client (C8).
// Uses the real client from app/src/lib/api.ts (no `send` from missing './api').
// Matches the server routes from C4 (GET/POST /billing/account/*) and C6
// (POST/GET /teams/:teamId/billing/move/*).
import { send } from '../lib/api.ts';
import { z } from 'zod';

const accountResponseSchema = z.object({
  account: z
    .object({
      userId: z.string(),
      plan: z.string(),
      status: z.string(),
      trialStartedAt: z.string().nullable(),
      trialEndsAt: z.string().nullable(),
      trialUsed: z.boolean(),
      periodStart: z.string().nullable(),
      periodEnd: z.string().nullable(),
      cancelAtPeriodEnd: z.boolean(),
      currency: z.string(),
    })
    .nullable(),
  entitlements: z
    .object({
      interval: z.string(),
      basePriceMinor: z.number(),
      freeTeams: z.number(),
      extraTeamPriceMinor: z.number(),
      peoplePerTeam: z.number(),
      extraPersonPriceMinor: z.number(),
      maxTeams: z.number(),
      maxPeoplePerTeam: z.number(),
      trialDays: z.number(),
      trialTeams: z.number(),
      trialPeople: z.number(),
      minAddonChargeMinor: z.number(),
    })
    .nullable(),
});

const quoteResponseSchema = z.object({
  action: z.string(),
  amountMinor: z.number(),
  currency: z.string(),
  description: z.string(),
  interval: z.string(),
  effectiveFrom: z.string(),
});

const checkoutResponseSchema = z.object({
  checkoutUrl: z.string(),
  txRef: z.string(),
  amountMinor: z.number(),
  currency: z.string(),
});

const cancelResponseSchema = z.object({
  cancelled: z.boolean(),
});

const resumeResponseSchema = z.object({
  resumed: z.boolean(),
});

const moveResponseSchema = z.object({
  moveId: z.string(),
});

const moveViewSchema = z.object({
  id: z.string(),
  status: z.string(),
  fromUserId: z.string(),
  toUserId: z.string(),
  teamId: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});

const emptyObjectSchema = z.object({});

export const billingApi = {
  // GET /billing/account — account status for the owner.
  async accountStatus() {
    const out = await send({
      method: 'GET',
      path: '/billing/account',
      auth: true,
      dataSchema: accountResponseSchema,
    });
    return out.data as {
      account: {
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
      } | null;
      entitlements: {
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
      } | null;
    };
  },

  // POST /billing/account/quote — price preview before anything is charged.
  async quote(input: {
    action: 'subscribe' | 'add_team' | 'add_people' | 'switch_interval';
    interval?: 'monthly' | 'yearly';
    teamId?: string;
    people?: number;
  }) {
    const out = await send({
      method: 'POST',
      path: '/billing/account/quote',
      body: input,
      auth: true,
      dataSchema: quoteResponseSchema,
    });
    return out.data as {
      action: string;
      amountMinor: number;
      currency: string;
      description: string;
      interval: string;
      effectiveFrom: 'now' | 'next_renewal';
    };
  },

  // POST /billing/account/checkout — Idempotency-Key REQUIRED (400 without it).
  async checkout(
    input: {
      action: 'subscribe' | 'add_team' | 'add_people' | 'switch_interval';
      interval?: 'monthly' | 'yearly';
      teamId?: string;
      people?: number;
    },
    idempotencyKey: string,
  ) {
    const out = await send({
      method: 'POST',
      path: '/billing/account/checkout',
      body: input,
      headers: { 'idempotency-key': idempotencyKey },
      auth: true,
      dataSchema: checkoutResponseSchema,
    });
    return out.data as { checkoutUrl: string; txRef: string; amountMinor: number; currency: string };
  },

  // POST /billing/account/cancel — cancel at period end.
  async cancel(idempotencyKey: string) {
    const out = await send({
      method: 'POST',
      path: '/billing/account/cancel',
      body: { confirm: 'cancel' },
      headers: { 'idempotency-key': idempotencyKey },
      auth: true,
      dataSchema: cancelResponseSchema,
    });
    return out.data as { cancelled: boolean };
  },

  // POST /billing/account/resume — resume cancelled-at-period-end subscription.
  async resume(idempotencyKey: string) {
    const out = await send({
      method: 'POST',
      path: '/billing/account/resume',
      headers: { 'idempotency-key': idempotencyKey },
      auth: true,
      dataSchema: resumeResponseSchema,
    });
    return out.data as { resumed: boolean };
  },

  // POST /teams/:teamId/billing/move/request — owner starts a move.
  async requestMove(teamId: string, receiverUserId: string, idempotencyKey: string) {
    const out = await send({
      method: 'POST',
      path: `/teams/${encodeURIComponent(teamId)}/billing/move/request`,
      body: { receiverUserId },
      headers: { 'idempotency-key': idempotencyKey },
      auth: true,
      dataSchema: moveResponseSchema,
    });
    return out.data as { moveId: string };
  },

  // GET /teams/:teamId/billing/move — view current open move.
  async getMove(teamId: string) {
    const out = await send({
      method: 'GET',
      path: `/teams/${encodeURIComponent(teamId)}/billing/move`,
      auth: true,
      dataSchema: z.object({ move: moveViewSchema.nullable() }),
    });
    return out.data as { move: { id: string; status: string; fromUserId: string; toUserId: string; teamId: string; expiresAt: string; createdAt: string; resolvedAt: string | null } | null };
  },

  // POST /teams/:teamId/billing/move/:moveId/accept — Admin accepts.
  async acceptMove(teamId: string, moveId: string, idempotencyKey: string) {
    const out = await send({
      method: 'POST',
      path: `/teams/${encodeURIComponent(teamId)}/billing/move/${encodeURIComponent(moveId)}/accept`,
      headers: { 'idempotency-key': idempotencyKey },
      auth: true,
      dataSchema: emptyObjectSchema,
    });
    return out.data as { accepted: boolean };
  },

  // POST /teams/:teamId/billing/move/:moveId/decline — Admin declines.
  async declineMove(teamId: string, moveId: string) {
    const out = await send({
      method: 'POST',
      path: `/teams/${encodeURIComponent(teamId)}/billing/move/${encodeURIComponent(moveId)}/decline`,
      auth: true,
      dataSchema: emptyObjectSchema,
    });
    return out.data as { declined: boolean };
  },

  // POST /teams/:teamId/billing/move/:moveId/cancel — owner cancels.
  async cancelMove(teamId: string, moveId: string, idempotencyKey: string) {
    const out = await send({
      method: 'POST',
      path: `/teams/${encodeURIComponent(teamId)}/billing/move/${encodeURIComponent(moveId)}/cancel`,
      headers: { 'idempotency-key': idempotencyKey },
      auth: true,
      dataSchema: emptyObjectSchema,
    });
    return out.data as { cancelled: boolean };
  },
};
