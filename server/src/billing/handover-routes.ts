// Billing hand-over router (Task B1, Stage 2).
// Holder-only endpoints: request, get, cancel. Admin-only endpoints: accept, decline.
// Idempotency-Key required on accept (payment-initiating endpoint).
import { Hono, type Context } from 'hono';
import { forTeam } from '../db/clients.ts';
import { registerPost, registerGet } from '../http/routes.ts';
import { HttpError, ok } from '../middleware/error.ts';
import * as service from './handover.ts';

function getUserId(c: Context): string {
  const userId = c.get('userId');
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new HttpError(401, 'auth.not_authenticated', 'Not authenticated.');
  }
  return userId;
}

function param(c: Context, name: string): string {
  const val = c.req.param(name);
  if (!val || typeof val !== 'string') {
    throw new HttpError(400, 'request.malformed', `Missing required path parameter ${name}.`);
  }
  return val;
}

/** Verify the caller is an active member of the team; otherwise 404. */
async function requireMember(shardClient: ReturnType<typeof forTeam>, teamId: string, userId: string): Promise<void> {
  const membership = await shardClient.memberships.findUnique({
    where: { team_id_user_id: { team_id: teamId, user_id: userId } },
  });
  if (!membership || membership.removed_at !== null) {
    throw new HttpError(404, 'team.notFound', 'Team not found.');
  }
}

export function createHandoverRouter(): Hono {
  const router = new Hono();

  // 1. Request a hand-over (holder only; Idempotency-Key not required — request is not payment-initiating)
  registerPost(
    router,
    '/teams/:teamId/billing/handover/request',
    { limits: ['settings.write'], auth: true },
    async (c) => {
      const userId = getUserId(c);
      const teamId = param(c, 'teamId');
      await requireMember(forTeam(teamId), teamId, userId);
      const result = await service.requestHandover(userId, teamId);
      return c.json(ok(result), 201);
    },
  );

  // 2. Get current hand-over (holder or Admin)
  registerGet(
    router,
    '/teams/:teamId/billing/handover',
    { limits: ['settings.read'], auth: true },
    async (c) => {
      const userId = getUserId(c);
      const teamId = param(c, 'teamId');
      await requireMember(forTeam(teamId), teamId, userId);
      const result = await service.getHandover(teamId, userId);
      return c.json(ok({ handover: result }));
    },
  );

  // 3. Accept a hand-over (Admin only; Idempotency-Key required)
  registerPost(
    router,
    '/teams/:teamId/billing/handover/:handoverId/accept',
    { limits: ['settings.write'], auth: true },
    async (c) => {
      const userId = getUserId(c);
      const teamId = param(c, 'teamId');
      const handoverId = param(c, 'handoverId');
      const idempotencyKey = c.req.header('idempotency-key');
      if (!idempotencyKey || idempotencyKey.trim().length === 0) {
        throw new HttpError(400, 'idempotency.missing', 'Idempotency-Key header is required.');
      }
      await requireMember(forTeam(teamId), teamId, userId);
      const result = await service.acceptHandover(userId, teamId, handoverId, idempotencyKey);
      return c.json(ok(result));
    },
  );

  // 4. Decline a hand-over (Admin only)
  registerPost(
    router,
    '/teams/:teamId/billing/handover/:handoverId/decline',
    { limits: ['settings.write'], auth: true },
    async (c) => {
      const userId = getUserId(c);
      const teamId = param(c, 'teamId');
      const handoverId = param(c, 'handoverId');
      await requireMember(forTeam(teamId), teamId, userId);
      const result = await service.declineHandover(userId, teamId, handoverId);
      return c.json(ok(result));
    },
  );

  // 5. Cancel a hand-over (holder only)
  registerPost(
    router,
    '/teams/:teamId/billing/handover/:handoverId/cancel',
    { limits: ['settings.write'], auth: true },
    async (c) => {
      const userId = getUserId(c);
      const teamId = param(c, 'teamId');
      const handoverId = param(c, 'handoverId');
      await requireMember(forTeam(teamId), teamId, userId);
      const result = await service.cancelHandover(userId, teamId, handoverId);
      return c.json(ok(result));
    },
  );

  return router;
}
