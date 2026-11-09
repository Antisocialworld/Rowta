// THE API CLIENT — the app's ONE door to the Rowta server (rules V1, V3, V5, S5, S14i, A11; PRD 9.3).
//
// Contract: every response is safeParsed with the SHARED envelope schemas ({ data, meta } on success,
// { error: { code, message, requestId, fields? } } on failure). A body that does not match is rejected
// here as a transport error instead of reaching a screen (V1, S5). Success hands back `data` (plus a
// typed `meta` where the server sends timers). Failure throws ApiError carrying the server's error
// CODE, the per-field catalog codes of a 422 and the 429 Retry-After DELTA SECONDS — never a clock
// time, never raw server text (S14i). Screens map codes to catalog keys with errorMessageKey /
// fieldErrorKey (V5); unknown codes become generic.error.
//
// Authentication: the caller supplies a runtime (set by the session layer) whose getAccessToken may
// refresh single-flight (A11). On a 401 of an authenticated call, onUnauthorized runs ONCE and the
// request retries with the new token; if it reports failure the original 401 surfaces. This module
// never logs, prints or stores a token (S1, S9) and never sends a request body it was not given.
//
// Transport: one AbortController timeout per request (default 15 s, rule S11's client side); a network
// failure becomes ApiError(0, 'client.network') and a timeout ApiError(0, 'client.timeout'), both of
// which map to generic.error — the app never shows raw error text (V5).
import { z } from 'zod';
import {
  authTokensResponseSchema,
  codeTimerMetaSchema,
  countryListResponseSchema,
  emptyResponseSchema,
  errorEnvelopeSchema,
  forgotSchema,
  grantTimerMetaSchema,
  logoutSchema,
  magicConsumeSchema,
  magicRequestSchema,
  meResponseSchema,
  messageResponseSchema,
  refreshSchema,
  resendCodeSchema,
  resetCodeSchema,
  resetGrantResponseSchema,
  resetNewPasswordSchema,
  signInSchema,
  signUpSchema,
  successEnvelopeSchema,
  verifyCodeSchema,
  acceptInviteResponseSchema,
  acceptInviteSchema,
  activityPageSchema,
  calendarResponseSchema,
  changeMemberRoleSchema,
  createShiftSchema,
  createTeamSchema,
  registerDeviceSchema,
  inviteListResponseSchema,
  inviteItemSchema,
  type InviteItem,
  deleteTeamSchema,
  deleteTeamResponseSchema,
  type DeleteTeamInput,
  type DeleteTeamResponse,
  deletedTeamItemSchema,
  deletedTeamsResponseSchema,
  restoreTeamResponseSchema,
  type DeletedTeamItem,
  type DeletedTeamsResponse,
  type RestoreTeamResponse,
  inviteMemberSchema,
  memberListResponseSchema,
  memberRoleResponseSchema,
  searchResultsSchema,
  shiftDetailViewSchema,
  shiftViewSchema,
  teamListResponseSchema,
  teamResponseSchema,
  teamCreatorSchema,
  type TeamCreator,
  teamSettingsResponseSchema,
  transferTeamSchema,
  transferTeamResponseSchema,
  type TransferTeamInput,
  type TransferTeamResponse,
  updateShiftSchema,
  updateTeamSettingsSchema,
  decideSwapSchema,
  requestSwapSchema,
  type AcceptInviteResponse,
  type ActivityPagePayload,
  type AuthTokensResponse,
  type CalendarResponse,
  type CodeTimerMeta,
  type CountryItem,
  type GrantTimerMeta,
  type InviteListResponse,
  type MeResponse,
  type MemberListResponse,
  type MemberRoleResponse,
  type MessageResponse,
  type ResetGrantResponse,
  type SearchResultsPayload,
  type ShiftDetailPayload,
  type ShiftView,
  type SwapListResponse,
  type SwapRequestView,
  type TeamListResponse,
  type TeamResponse,
  type TeamSettingsResponse,
  type DeviceView,
} from '@rowta/shared';
import { isMessageKey, type MessageKey } from '../i18n/en';

// ---------------------------------------------------------------------------------------------
// Configuration (S4: EXPO_PUBLIC_API_URL is public by design — a base URL, never a secret)
// ---------------------------------------------------------------------------------------------

function baseUrl(): string {
  const raw = process.env.EXPO_PUBLIC_API_URL;
  if (raw === undefined || raw.trim() === '') {
    throw new ApiError(0, 'client.config', 'EXPO_PUBLIC_API_URL is not set');
  }
  return raw.replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------------------------
// Errors (V5: codes and field codes only — the server's message text is never surfaced)
// ---------------------------------------------------------------------------------------------

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly requestId: string,
    readonly fields?: Record<string, string>,
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

/** Server error code -> catalog key. Unknown codes (and transport errors) fall back to generic.error;
 *  raw server text is never a candidate (V5, U8). */
const CODE_KEYS: Record<string, MessageKey> = {
  'auth.failed': 'auth.signIn.failed',
  'auth.code_invalid': 'auth.code.invalid',
  'auth.link_invalid': 'auth.link.invalid',
  'auth.link.invalid': 'auth.link.invalid',
  'auth.not_authenticated': 'generic.error',
  'auth.refresh_invalid': 'generic.error',
  'auth.deleteOwner.blocked': 'auth.deleteOwner.blocked',
  'team.notFound': 'team.notFound',
  'team.forbidden': 'team.forbidden',
  'team.seatLimit': 'team.seatLimit',
  'shift.notFound': 'shift.notFound',
  'shift.timeOrder': 'shift.timeOrder',
  'shift.time.invalid': 'shift.time.invalid',
  'shift.label.required': 'shift.label.required',
  'shift.label.tooLong': 'shift.label.tooLong',
  'shift.notes.tooLong': 'shift.notes.tooLong',
  'shift.assignee.invalid': 'shift.assignee.invalid',
  'shift.range.invalid': 'shift.range.invalid',
  'shift.range.tooLong': 'shift.range.tooLong',
  'activity.cursor.invalid': 'activity.cursor.invalid',
  'search.query.tooShort': 'search.query.tooShort',
  'swap.notFound': 'swap.notFound',
  'swap.shift.notFound': 'swap.shift.notFound',
  'swap.shift.inPast': 'swap.shift.inPast',
  'swap.shift.notAssigned': 'swap.shift.notAssigned',
  'swap.already_pending': 'swap.already_pending',
  'swap.target_invalid': 'swap.target_invalid',
  'swap.target_required': 'swap.target_required',
  'swap.self_swap': 'swap.self_swap',
  'swap.not_pending': 'swap.not_pending',
  'swap.conflict': 'swap.conflict',
  'swap.cannot_cancel': 'swap.cannot_cancel',
  'swap.assignee_changed': 'swap.assignee_changed',
  'swap.requester_removed': 'swap.requester_removed',
  'swap.shift_deleted': 'swap.shift_deleted',
  'idempotency.missing': 'idempotency.missing',
  'idempotency.fingerprint_mismatch': 'idempotency.fingerprint_mismatch',
  'idempotency.in_flight': 'idempotency.in_flight',
  'billing.not_payer': 'billing.error.notPayer',
  'billing.receiver_team_cap': 'billing.error.teamCap',
  'billing.receiver_invalid': 'billing.error.receiverInvalid',
  'billing.team_restricted': 'billing.error.teamRestricted',
  'billing.account_inactive': 'billing.error.accountInactive',
  'billing.cannot_resume': 'billing.error.cannotResume',
  'billing.payer_cannot_leave': 'billing.error.payerCannotLeave',
  'billing.payer_cannot_leave_self': 'billing.error.payerCannotLeaveSelf',
  'billing.checkout_moved': 'billing.error.checkoutMoved',
  'billing.switch_not_available_yet': 'billing.error.switchNotAvailableYet',
  'rate.limited': 'auth.rateLimited',
  'validation.failed': 'generic.error',
  'request.malformed': 'generic.error',
  'service.unavailable': 'generic.error',
  'generic.error': 'generic.error',
  'client.network': 'generic.error',
  'client.timeout': 'generic.error',
  'client.malformed': 'generic.error',
  'client.config': 'generic.error',
};

export function errorMessageKey(code: string): MessageKey {
  return CODE_KEYS[code] ?? 'generic.error';
}

/** A 422 `fields` value arrives as a catalog key; anything unknown falls back (V5, U8). */
export function fieldErrorKey(fieldCode: string): MessageKey {
  return isMessageKey(fieldCode) ? fieldCode : 'generic.error';
}

/** Text for an ApiError's first problem field when it has one, else its top-level code. */
export function errorTextKey(error: ApiError): MessageKey {
  const first = Object.values(error.fields ?? {})[0];
  return first === undefined ? errorMessageKey(error.code) : fieldErrorKey(first);
}

// ---------------------------------------------------------------------------------------------
// Runtime (wired by the session layer; kept here so this module stays pure and testable)
// ---------------------------------------------------------------------------------------------

export const FORBIDDEN_REFETCH_COOLDOWN_MS = 5_000;

/** Pure helper deciding whether enough time has passed since the last refetch to permit another. */
export function shouldTriggerRoleRefetch(
  lastRefetchAtMs: number,
  nowMs: number,
  cooldownMs: number = FORBIDDEN_REFETCH_COOLDOWN_MS,
): boolean {
  if (lastRefetchAtMs <= 0) return true;
  return nowMs - lastRefetchAtMs >= cooldownMs;
}

export type ApiRuntime = {
  /** Current access token, or null when signed out. May run the single-flight refresh (A11). */
  getAccessToken(): Promise<string | null>;
  /** A 401 on an authenticated call: refresh single-flight, true = retried with a fresh token. */
  onUnauthorized?(): Promise<boolean>;
  /** A 404 team.notFound on any team-scoped request. */
  onTeamNotFound?(teamId: string | null): void;
  /** A 403 team.forbidden on any team-scoped request. */
  onTeamForbidden?(teamId: string | null): void;
};

let runtime: ApiRuntime = { getAccessToken: async () => null };

export function setApiRuntime(next: ApiRuntime): void {
  runtime = { ...runtime, ...next };
}

export function setOnTeamNotFound(fn: (teamId: string | null) => void): void {
  runtime.onTeamNotFound = fn;
}

export function setOnTeamForbidden(fn: (teamId: string | null) => void): void {
  runtime.onTeamForbidden = fn;
}

/** Test seam: swap the fetch implementation (scripts/test-api-client.ts); pass null to restore. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
let fetchImpl: FetchLike = (input, init) => fetch(input, init);
export function setFetchForTests(next: FetchLike | null): void {
  fetchImpl = next === null ? (input, init) => fetch(input, init) : next;
}

export const DEFAULT_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------------------------
// The one request function
// ---------------------------------------------------------------------------------------------

type RequestInput = {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  /** Shared response schema for `data` (the envelope is built from it). */
  dataSchema: z.ZodType;
  /** When present, `meta` MUST be present and match (code timers — remaining SECONDS, A9). */
  metaSchema?: z.ZodType;
  /** Attach the access token; a 401 then goes through onUnauthorized once (A11). */
  auth?: boolean;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Internal: stops the 401 refresh-and-retry from looping (one retry only). */
  retried?: boolean;
};

type RequestOutput = { data: unknown; meta?: unknown };

export async function send(input: RequestInput): Promise<RequestOutput> {
  const {
    method,
    path,
    body,
    dataSchema,
    metaSchema,
    auth = false,
    headers: inputHeaders = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retried = false,
  } = input;

  const headers: Record<string, string> = {
    accept: 'application/json',
    ...inputHeaders,
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth) {
    const token = await runtime.getAccessToken();
    if (token === null) throw new ApiError(401, 'auth.not_authenticated', '');
    headers.authorization = `Bearer ${token}`;
  }

  const url = `${baseUrl()}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();

    if (
      response.status === 401 &&
      auth &&
      retried !== true &&
      runtime.onUnauthorized !== undefined &&
      (await runtime.onUnauthorized())
    ) {
      return send({ ...input, retried: true });
    }

    if (response.ok) {
      let json: unknown;
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        throw new ApiError(response.status, 'client.malformed', '');
      }
      const envelope = successEnvelopeSchema(dataSchema).safeParse(json);
      if (!envelope.success) throw new ApiError(response.status, 'client.malformed', '');
      const rawMeta = (envelope.data as { meta?: unknown }).meta;
      let meta: unknown = rawMeta;
      if (metaSchema !== undefined) {
        const parsedMeta = metaSchema.safeParse(rawMeta);
        if (!parsedMeta.success) throw new ApiError(response.status, 'client.malformed', '');
        meta = parsedMeta.data;
      }
      return { data: envelope.data.data, meta };
    }

    // Failure: parse the shared error envelope; a non-envelope body (proxy page) never leaks text.
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      throw new ApiError(response.status, 'generic.error', '');
    }
    const parsed = errorEnvelopeSchema.safeParse(json);
    if (!parsed.success) throw new ApiError(response.status, 'generic.error', '');
    const headerRetry = Number(response.headers.get('Retry-After'));
    const retryAfterSeconds =
      response.status === 429 && Number.isInteger(headerRetry) && headerRetry >= 0 ? headerRetry : undefined;
    const { code, requestId, fields } = parsed.data.error;
    if (response.status === 404 && code === 'team.notFound') {
      const match = /\/teams\/([0-9a-fA-F-]+)/.exec(path);
      try {
        const teamId = match && match[1] ? match[1] : null;
        runtime.onTeamNotFound?.(teamId);
      } catch {
        // Lifecycle hook failure must not suppress throwing the ApiError
      }
    }
    if (response.status === 403 && code === 'team.forbidden') {
      const match = /\/teams\/([0-9a-fA-F-]+)/.exec(path);
      try {
        const teamId = match && match[1] ? match[1] : null;
        runtime.onTeamForbidden?.(teamId);
      } catch {
        // Lifecycle hook failure must not suppress throwing the ApiError
      }
    }
    throw new ApiError(response.status, code, requestId, fields, retryAfterSeconds);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const aborted = (error as { name?: string } | null)?.name === 'AbortError';
    throw new ApiError(0, aborted ? 'client.timeout' : 'client.network', '');
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------------------------
// Endpoints (shared request schemas validate the INPUT the app sends — V1 — and the shared response
// schemas above validate every byte the app trusts — S5)
// ---------------------------------------------------------------------------------------------

const deviceViewSchema = z.object({
  id: z.string(),
  platform: z.string(),
  deviceId: z.string(),
  lastSeenAt: z.string(),
  createdAt: z.string(),
});

export type SignInResult = { kind: 'tokens'; tokens: AuthTokensResponse } | { kind: 'prompt'; meta: CodeTimerMeta };

export const authApi = {
  async signUp(input: z.input<typeof signUpSchema>): Promise<{ data: MessageResponse; meta: CodeTimerMeta }> {
    signUpSchema.parse(input);
    const out = await send({
      method: 'POST',
      path: '/auth/signup',
      body: input,
      dataSchema: messageResponseSchema,
      metaSchema: codeTimerMetaSchema,
    });
    return { data: out.data as MessageResponse, meta: out.meta as CodeTimerMeta };
  },

  async verifyCode(input: z.input<typeof verifyCodeSchema>): Promise<AuthTokensResponse> {
    verifyCodeSchema.parse(input);
    const out = await send({
      method: 'POST',
      path: '/auth/signup/verify',
      body: input,
      dataSchema: authTokensResponseSchema,
    });
    return out.data as AuthTokensResponse;
  },

  async resendCode(input: z.input<typeof resendCodeSchema>): Promise<{ data: MessageResponse; meta: CodeTimerMeta }> {
    resendCodeSchema.parse(input);
    const out = await send({
      method: 'POST',
      path: '/auth/signup/resend',
      body: input,
      dataSchema: messageResponseSchema,
      metaSchema: codeTimerMetaSchema,
    });
    return { data: out.data as MessageResponse, meta: out.meta as CodeTimerMeta };
  },

  /** Signs in, or returns the uniform "check your email" prompt for an unverified account (8.1).
   *  The server answers with EITHER tokens OR { message } plus code-timer meta — one union parse,
   *  then the branch is discriminated on the token key. */
  async signIn(input: z.input<typeof signInSchema>): Promise<SignInResult> {
    signInSchema.parse(input);
    const out = await send({
      method: 'POST',
      path: '/auth/signin',
      body: input,
      dataSchema: z.union([authTokensResponseSchema, messageResponseSchema]),
    });
    const data = out.data as AuthTokensResponse | MessageResponse;
    if ('accessToken' in data) return { kind: 'tokens', tokens: data };
    const parsedMeta = codeTimerMetaSchema.safeParse(out.meta);
    if (!parsedMeta.success) throw new ApiError(200, 'client.malformed', '');
    return { kind: 'prompt', meta: parsedMeta.data };
  },

  async refresh(input: z.input<typeof refreshSchema>): Promise<AuthTokensResponse> {
    refreshSchema.parse(input);
    const out = await send({
      method: 'POST',
      path: '/auth/refresh',
      body: input,
      dataSchema: authTokensResponseSchema,
    });
    return out.data as AuthTokensResponse;
  },

  async logout(input: z.input<typeof logoutSchema>): Promise<void> {
    logoutSchema.parse(input);
    await send({ method: 'POST', path: '/auth/logout', body: input, dataSchema: emptyResponseSchema, auth: true });
  },

  async logoutAll(): Promise<void> {
    await send({ method: 'POST', path: '/auth/logout-all', body: {}, dataSchema: emptyResponseSchema, auth: true });
  },

  async me(): Promise<MeResponse> {
    const out = await send({ method: 'GET', path: '/auth/me', dataSchema: meResponseSchema, auth: true });
    return out.data as MeResponse;
  },

  /** The offered sign-up countries (PRD 8.1): the server owns the list (S5). */
  async countries(): Promise<CountryItem[]> {
    const out = await send({ method: 'GET', path: '/auth/countries', dataSchema: countryListResponseSchema });
    return out.data as CountryItem[];
  },

  async forgot(input: z.input<typeof forgotSchema>): Promise<{ data: MessageResponse; meta: CodeTimerMeta }> {
    forgotSchema.parse(input);
    const out = await send({
      method: 'POST',
      path: '/auth/forgot',
      body: input,
      dataSchema: messageResponseSchema,
      metaSchema: codeTimerMetaSchema,
    });
    return { data: out.data as MessageResponse, meta: out.meta as CodeTimerMeta };
  },

  async forgotResend(input: z.input<typeof forgotSchema>): Promise<{ data: MessageResponse; meta: CodeTimerMeta }> {
    forgotSchema.parse(input);
    const out = await send({
      method: 'POST',
      path: '/auth/forgot/resend',
      body: input,
      dataSchema: messageResponseSchema,
      metaSchema: codeTimerMetaSchema,
    });
    return { data: out.data as MessageResponse, meta: out.meta as CodeTimerMeta };
  },

  async forgotVerify(
    input: z.input<typeof resetCodeSchema>,
  ): Promise<{ data: ResetGrantResponse; meta: GrantTimerMeta }> {
    resetCodeSchema.parse(input);
    const out = await send({
      method: 'POST',
      path: '/auth/forgot/verify',
      body: input,
      dataSchema: resetGrantResponseSchema,
      metaSchema: grantTimerMetaSchema,
    });
    return { data: out.data as ResetGrantResponse, meta: out.meta as GrantTimerMeta };
  },

  async resetNewPassword(input: z.input<typeof resetNewPasswordSchema>): Promise<MessageResponse> {
    resetNewPasswordSchema.parse(input);
    const out = await send({
      method: 'POST',
      path: '/auth/reset',
      body: input,
      dataSchema: messageResponseSchema,
    });
    return out.data as MessageResponse;
  },

  async magicRequest(input: z.input<typeof magicRequestSchema>): Promise<MessageResponse> {
    magicRequestSchema.parse(input);
    const out = await send({
      method: 'POST',
      path: '/auth/magic/request',
      body: input,
      dataSchema: messageResponseSchema,
    });
    return out.data as MessageResponse;
  },

  async magicConsume(input: z.input<typeof magicConsumeSchema>): Promise<AuthTokensResponse> {
    magicConsumeSchema.parse(input);
    const out = await send({
      method: 'POST',
      path: '/auth/magic/consume',
      body: input,
      dataSchema: authTokensResponseSchema,
    });
    return out.data as AuthTokensResponse;
  },
};

export const teamsApi = {
  async createTeam(input: z.input<typeof createTeamSchema>, idempotencyKey: string): Promise<TeamResponse> {
    createTeamSchema.parse(input);
    const out = await send({
      method: 'POST',
      path: '/teams',
      body: input,
      headers: { 'idempotency-key': idempotencyKey },
      auth: true,
      dataSchema: teamResponseSchema,
    });
    return out.data as TeamResponse;
  },

  async listTeams(): Promise<TeamListResponse> {
    const out = await send({
      method: 'GET',
      path: '/teams',
      auth: true,
      dataSchema: teamListResponseSchema,
    });
    return out.data as TeamListResponse;
  },

  async getTeam(teamId: string): Promise<TeamResponse> {
    const out = await send({
      method: 'GET',
      path: `/teams/${encodeURIComponent(teamId)}`,
      auth: true,
      dataSchema: teamResponseSchema,
    });
    return out.data as TeamResponse;
  },

  async listMembers(teamId: string): Promise<MemberListResponse> {
    const out = await send({
      method: 'GET',
      path: `/teams/${encodeURIComponent(teamId)}/members`,
      auth: true,
      dataSchema: memberListResponseSchema,
    });
    return out.data as MemberListResponse;
  },

  async changeMemberRole(
    teamId: string,
    userId: string,
    input: z.input<typeof changeMemberRoleSchema>,
  ): Promise<MemberRoleResponse> {
    changeMemberRoleSchema.parse(input);
    const out = await send({
      method: 'POST',
      path: `/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}/role`,
      body: input,
      auth: true,
      dataSchema: memberRoleResponseSchema,
    });
    return out.data as MemberRoleResponse;
  },

  async removeMember(teamId: string, userId: string): Promise<{ removed: boolean }> {
    const out = await send({
      method: 'POST',
      path: `/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}/remove`,
      body: {},
      auth: true,
      dataSchema: z.object({ removed: z.boolean() }),
    });
    return out.data as { removed: boolean };
  },

  async leaveTeam(teamId: string): Promise<{ left: boolean }> {
    const out = await send({
      method: 'POST',
      path: `/teams/${encodeURIComponent(teamId)}/leave`,
      body: {},
      auth: true,
      dataSchema: z.object({ left: z.boolean() }),
    });
    return out.data as { left: boolean };
  },

  async listInvites(teamId: string): Promise<InviteListResponse> {
    const out = await send({
      method: 'GET',
      path: `/teams/${encodeURIComponent(teamId)}/invites`,
      auth: true,
      dataSchema: inviteListResponseSchema,
    });
    return out.data as InviteListResponse;
  },

  async createInvite(teamId: string, input: z.input<typeof inviteMemberSchema>): Promise<MessageResponse> {
    inviteMemberSchema.parse(input);
    const out = await send({
      method: 'POST',
      path: `/teams/${encodeURIComponent(teamId)}/invites`,
      body: input,
      auth: true,
      dataSchema: messageResponseSchema,
    });
    return out.data as MessageResponse;
  },

  async revokeInvite(teamId: string, inviteId: string): Promise<{ revoked: boolean }> {
    const out = await send({
      method: 'POST',
      path: `/teams/${encodeURIComponent(teamId)}/invites/${encodeURIComponent(inviteId)}/revoke`,
      body: {},
      auth: true,
      dataSchema: z.object({ revoked: z.boolean() }),
    });
    return out.data as { revoked: boolean };
  },

  async acceptInvite(input: z.input<typeof acceptInviteSchema>): Promise<AcceptInviteResponse> {
    acceptInviteSchema.parse(input);
    const out = await send({
      method: 'POST',
      path: '/invites/accept',
      body: input,
      auth: true,
      dataSchema: acceptInviteResponseSchema,
    });
    return out.data as AcceptInviteResponse;
  },

  async updateTeamSettings(
    teamId: string,
    input: z.input<typeof updateTeamSettingsSchema>,
  ): Promise<TeamSettingsResponse> {
    updateTeamSettingsSchema.parse(input);
    const out = await send({
      method: 'POST',
      path: `/teams/${encodeURIComponent(teamId)}/settings`,
      body: input,
      auth: true,
      dataSchema: teamSettingsResponseSchema,
    });
    return out.data as TeamSettingsResponse;
  },

  async deleteTeam(teamId: string, input: z.input<typeof deleteTeamSchema>): Promise<DeleteTeamResponse> {
    deleteTeamSchema.parse(input);
    const out = await send({
      method: 'POST',
      path: `/teams/${encodeURIComponent(teamId)}/delete`,
      body: input,
      auth: true,
      dataSchema: deleteTeamResponseSchema,
    });
    return out.data as DeleteTeamResponse;
  },

  async transferTeam(
    teamId: string,
    input: z.input<typeof transferTeamSchema>,
  ): Promise<TransferTeamResponse> {
    transferTeamSchema.parse(input);
    const out = await send({
      method: 'POST',
      path: `/teams/${encodeURIComponent(teamId)}/transfer`,
      body: input,
      auth: true,
      dataSchema: transferTeamResponseSchema,
    });
    return out.data as TransferTeamResponse;
  },

  async listDeletedTeams(): Promise<DeletedTeamsResponse> {
    const out = await send({
      method: 'GET',
      path: '/teams/deleted',
      auth: true,
      dataSchema: deletedTeamsResponseSchema,
    });
    return out.data as DeletedTeamsResponse;
  },

  async restoreTeam(teamId: string): Promise<RestoreTeamResponse> {
    const out = await send({
      method: 'POST',
      path: `/teams/${encodeURIComponent(teamId)}/restore`,
      body: {},
      auth: true,
      dataSchema: restoreTeamResponseSchema,
    });
    return out.data as RestoreTeamResponse;
  },
};

/** Phase 4: shifts, calendar, activity feed and search (PRD 6.1, 8.3, 8.4). Every call is team
 *  scoped and authenticated; the shared schemas validate input here and every response byte. */
export const shiftsApi = {
  async listCalendar(teamId: string, from: string, to: string): Promise<CalendarResponse> {
    const out = await send({
      method: 'GET',
      path: `/teams/${encodeURIComponent(teamId)}/shifts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      auth: true,
      dataSchema: calendarResponseSchema,
    });
    return out.data as CalendarResponse;
  },

  async getShift(teamId: string, shiftId: string): Promise<ShiftDetailPayload> {
    const out = await send({
      method: 'GET',
      path: `/teams/${encodeURIComponent(teamId)}/shifts/${encodeURIComponent(shiftId)}`,
      auth: true,
      dataSchema: shiftDetailViewSchema,
    });
    return out.data as ShiftDetailPayload;
  },

  async createShift(
    teamId: string,
    input: z.input<typeof createShiftSchema>,
    idempotencyKey: string,
  ): Promise<ShiftView> {
    createShiftSchema.parse(input);
    const out = await send({
      method: 'POST',
      path: `/teams/${encodeURIComponent(teamId)}/shifts`,
      body: input,
      headers: { 'idempotency-key': idempotencyKey },
      auth: true,
      dataSchema: shiftViewSchema,
    });
    return out.data as ShiftView;
  },

  async updateShift(teamId: string, shiftId: string, input: z.input<typeof updateShiftSchema>): Promise<ShiftView> {
    updateShiftSchema.parse(input);
    const out = await send({
      method: 'POST',
      path: `/teams/${encodeURIComponent(teamId)}/shifts/${encodeURIComponent(shiftId)}/update`,
      body: input,
      auth: true,
      dataSchema: shiftViewSchema,
    });
    return out.data as ShiftView;
  },

  async deleteShift(teamId: string, shiftId: string): Promise<{ deleted: true }> {
    const out = await send({
      method: 'POST',
      path: `/teams/${encodeURIComponent(teamId)}/shifts/${encodeURIComponent(shiftId)}/delete`,
      body: {},
      auth: true,
      dataSchema: z.object({ deleted: z.literal(true) }),
    });
    return out.data as { deleted: true };
  },

  async listActivity(
    teamId: string,
    cursor?: string,
    limit?: number,
    since?: string,
  ): Promise<ActivityPagePayload> {
    const params = new URLSearchParams();
    if (cursor !== undefined) params.set('cursor', cursor);
    if (limit !== undefined) params.set('limit', String(limit));
    if (since !== undefined) params.set('since', since);
    const suffix = params.toString().length === 0 ? '' : `?${params.toString()}`;
    const out = await send({
      method: 'GET',
      path: `/teams/${encodeURIComponent(teamId)}/activity${suffix}`,
      auth: true,
      dataSchema: activityPageSchema,
    });
    return out.data as ActivityPagePayload;
  },

  async search(teamId: string, q: string): Promise<SearchResultsPayload> {
    const out = await send({
      method: 'GET',
      path: `/teams/${encodeURIComponent(teamId)}/search?q=${encodeURIComponent(q)}`,
      auth: true,
      dataSchema: searchResultsSchema,
    });
    return out.data as SearchResultsPayload;
  },
};

export const swapViewSchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  shiftId: z.string().uuid(),
  requestedBy: z.string().uuid(),
  targetUserId: z.string().uuid().nullable(),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']),
  decidedBy: z.string().uuid().nullable(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  shiftLabel: z.string().optional(),
  shiftStartsAt: z.string().optional(),
  shiftEndsAt: z.string().optional(),
  shiftDeleted: z.boolean().optional(),
  requesterName: z.string().optional(),
  targetName: z.string().nullable().optional(),
});

export type InferredSwapView = z.infer<typeof swapViewSchema>;

/** Parse a raw swap payload into a typed SwapRequestView without type assertions. */
export function parseSwapView(input: unknown): SwapRequestView {
  return swapViewSchema.parse(input);
}

const swapListSchema = z.object({
  swaps: z.array(swapViewSchema),
  nextCursor: z.string().nullable(),
});

export const swapsApi = {
  async requestSwap(
    teamId: string,
    input: { shiftId: string; targetUserId?: string | null },
    idempotencyKey: string,
  ): Promise<SwapRequestView> {
    requestSwapSchema.parse(input);
    const out = await send({
      method: 'POST',
      path: `/teams/${encodeURIComponent(teamId)}/swaps`,
      body: input,
      headers: { 'idempotency-key': idempotencyKey },
      auth: true,
      dataSchema: swapViewSchema,
    });
    return out.data as SwapRequestView;
  },

  async listSwaps(
    teamId: string,
    query?: { cursor?: string; limit?: number; status?: 'pending' | 'approved' | 'rejected' | 'cancelled'; shiftId?: string },
  ): Promise<SwapListResponse> {
    const params = new URLSearchParams();
    if (query?.cursor !== undefined) params.set('cursor', query.cursor);
    if (query?.limit !== undefined) params.set('limit', String(query.limit));
    if (query?.status !== undefined) params.set('status', query.status);
    if (query?.shiftId !== undefined) params.set('shiftId', query.shiftId);
    const suffix = params.toString().length === 0 ? '' : `?${params.toString()}`;
    const out = await send({
      method: 'GET',
      path: `/teams/${encodeURIComponent(teamId)}/swaps${suffix}`,
      auth: true,
      dataSchema: swapListSchema,
    });
    return out.data as SwapListResponse;
  },

  async getSwap(teamId: string, swapId: string): Promise<SwapRequestView> {
    const out = await send({
      method: 'GET',
      path: `/teams/${encodeURIComponent(teamId)}/swaps/${encodeURIComponent(swapId)}`,
      auth: true,
      dataSchema: swapViewSchema,
    });
    return out.data as SwapRequestView;
  },

  async decideSwap(
    teamId: string,
    swapId: string,
    input: { status: 'approved'; targetUserId?: string | null } | { status: 'rejected'; declineReason: string },
  ): Promise<SwapRequestView> {
    const validated = decideSwapSchema.parse(input);
    const body =
      validated.status === 'approved'
        ? { status: 'approved' as const, targetUserId: validated.targetUserId ?? null }
        : { status: 'rejected' as const, declineReason: validated.declineReason as string };
    const out = await send({
      method: 'POST',
      path: `/teams/${encodeURIComponent(teamId)}/swaps/${encodeURIComponent(swapId)}/decide`,
      body,
      auth: true,
      dataSchema: swapViewSchema,
    });
    return out.data as SwapRequestView;
  },

  async cancelSwap(teamId: string, swapId: string): Promise<SwapRequestView> {
    const out = await send({
      method: 'POST',
      path: `/teams/${encodeURIComponent(teamId)}/swaps/${encodeURIComponent(swapId)}/cancel`,
      body: {},
      auth: true,
      dataSchema: swapViewSchema,
    });
    return out.data as SwapRequestView;
  },
};

export const devicesApi = {
  async registerDevice(
    input: z.input<typeof registerDeviceSchema>,
    idempotencyKey: string,
  ): Promise<DeviceView> {
    registerDeviceSchema.parse(input);
    const out = await send({
      method: 'POST',
      path: '/devices',
      body: input,
      headers: { 'idempotency-key': idempotencyKey },
      auth: true,
      dataSchema: deviceViewSchema,
    });
    return out.data as DeviceView;
  },
};

export {
  teamCreatorSchema,
  type TeamCreator,
  teamResponseSchema,
  deleteTeamSchema,
  deleteTeamResponseSchema,
  type DeleteTeamInput,
  type DeleteTeamResponse,
  deletedTeamItemSchema,
  deletedTeamsResponseSchema,
  restoreTeamResponseSchema,
  type DeletedTeamItem,
  type DeletedTeamsResponse,
  type RestoreTeamResponse,
  transferTeamSchema,
  transferTeamResponseSchema,
  type TransferTeamInput,
  type TransferTeamResponse,
  inviteItemSchema,
  type InviteItem,
};
