// Access token security tests (Rules A4, A11, S8; PRD 8.1).
// Proves:
// 1. Wrong key is rejected.
// 2. Algorithm substitution (e.g. HS384) is rejected.
// 3. Unsigned token with alg 'none' is rejected.
// 4. Expired token is rejected.
// 5. Tampered payload is rejected.
// 6. Valid token verifies and returns the exact userId.
// 7. Token payload contains no role or team id (Rule S8).
import { randomUUID } from 'node:crypto';
import { SignJWT, decodeJwt } from 'jose';
import { describe, expect, it } from 'vitest';
import { env } from '../src/config/env.ts';
import { signAccessToken, verifyAccessToken } from '../src/security/access-token.ts';

const REAL_KEY = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

describe('access-token security (HS512, pinned alg, minimal claims)', () => {
  it('rejects a token signed with the wrong key', async () => {
    const wrongKey = new Uint8Array(64).fill(7);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS512' })
      .setSubject('usr_wrong_key')
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 900)
      .sign(wrongKey);

    const claims = await verifyAccessToken(token);
    expect(claims).toBeNull();
  });

  it('rejects a token signed with an alternative algorithm such as HS384', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS384' })
      .setSubject('usr_alt_alg')
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + 900)
      .sign(REAL_KEY);

    const claims = await verifyAccessToken(token);
    expect(claims).toBeNull();
  });

  it('rejects an unsigned token with alg none', async () => {
    const headerB64 = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payloadB64 = Buffer.from(
      JSON.stringify({
        sub: 'usr_unsigned',
        jti: randomUUID(),
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 900,
      }),
    ).toString('base64url');
    const unsignedToken = `${headerB64}.${payloadB64}.`;

    const claims = await verifyAccessToken(unsignedToken);
    expect(claims).toBeNull();
  });

  it('rejects an expired token', async () => {
    const pastTime = Math.floor(Date.now() / 1000) - 30;
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS512' })
      .setSubject('usr_expired')
      .setJti(randomUUID())
      .setIssuedAt(pastTime - 60)
      .setExpirationTime(pastTime)
      .sign(REAL_KEY);

    const claims = await verifyAccessToken(token);
    expect(claims).toBeNull();
  });

  it('rejects a token whose payload was edited after signing', async () => {
    const validToken = await signAccessToken('usr_legit');
    const parts = validToken.split('.');
    expect(parts).toHaveLength(3);
    const [headerB64, payloadB64, sigB64] = parts;
    if (!headerB64 || !payloadB64 || !sigB64) {
      throw new Error('invalid token parts');
    }

    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    payload.sub = 'usr_tampered';
    const tamperedPayloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const tamperedToken = `${headerB64}.${tamperedPayloadB64}.${sigB64}`;

    const claims = await verifyAccessToken(tamperedToken);
    expect(claims).toBeNull();
  });

  it('verifies a valid token and returns the right userId', async () => {
    const userId = 'usr_valid_42';
    const token = await signAccessToken(userId);
    const claims = await verifyAccessToken(token);

    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe(userId);
    expect(typeof claims?.jti).toBe('string');
    expect(claims?.jti.length).toBeGreaterThan(0);
  });

  it('confirms that no role or team id appears in the token payload', async () => {
    const token = await signAccessToken('usr_claims_check');
    const payload = decodeJwt(token);

    expect(payload).not.toHaveProperty('role');
    expect(payload).not.toHaveProperty('team_id');
    expect(payload).not.toHaveProperty('teamId');
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'jti', 'sub']);
  });
});
