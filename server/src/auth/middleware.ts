// Authentication middleware: Bearer access token -> c.set('userId') (rules A4, A11, S8; skill 3.16).
//
// Every problem — missing header, wrong scheme, unknown algorithm, expired, tampered — is the
// same generic 401 with no reason attached. The token carries no role (S8); routes that need to
// know who the user is read c.get('userId') and load their data through the data-access layer.
import type { MiddlewareHandler } from 'hono';
import { HttpError } from '../middleware/error.ts';
import { verifyAccessToken } from '../security/access-token.ts';

const BEARER_PATTERN = /^Bearer\s+(\S+)$/;

function notAuthenticated(): HttpError {
  return new HttpError(401, 'auth.not_authenticated', 'Not authenticated.');
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('authorization');
  const match = header === undefined ? null : BEARER_PATTERN.exec(header);
  if (match === null || match[1] === undefined) throw notAuthenticated();

  const claims = await verifyAccessToken(match[1]);
  if (claims === null) throw notAuthenticated();

  c.set('userId', claims.sub);
  await next();
};
