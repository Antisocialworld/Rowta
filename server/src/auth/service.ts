// Auth flows — the server's authoritative implementations (rules A5 to A13, C1 to C6, D2, V2).
//
// Ground rules woven through every function:
//   - Sign-in failures are ONE answer: "Invalid email or password." with an identical body, and an
//     unknown email still runs one real Argon2id verify against the dummy hash (A5, A7).
//   - Account-revealing routes answer uniformly whether or not the email exists (A6); the request
//     path never sends email itself — it only enqueues, and the job decides (C2).
//   - Codes, verifiers and grants: atomic single statements or transactions, never check-then-write
//     (C3); the database constraints are the backstop (D2).
//   - Nothing here logs or returns a raw code, verifier or password (S1, A3).
import { randomBytes, randomUUID } from 'node:crypto';
import {
  AUTH_MESSAGES,
  CODE_MAX_ATTEMPTS,
  CODE_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  RESET_GRANT_TTL_SECONDS,
  type SignUpInput,
  type VerifyCodeInput,
  type ResendCodeInput,
  type SignInInput,
  type RefreshInput,
  type LogoutInput,
  type ForgotInput,
  type ResetCodeInput,
  type ResetNewPasswordInput,
  type MagicRequestInput,
  type MagicConsumeInput,
} from '@rowta/shared';
import { globalDb } from '../db/clients.ts';
import { isUniqueViolation } from '../db/errors.ts';
import { HttpError } from '../middleware/error.ts';
import { getDummyHash, hashSecret, needsRehash, verifySecret } from '../security/argon2.ts';
import { signAccessToken } from '../security/access-token.ts';
import { cooldownSeconds, startCooldown } from '../security/rate-limit.ts';
import { createTokenParts, formatToken, splitToken } from '../security/tokens.ts';
import { enqueueEmail } from '../jobs/email/enqueue.ts';
import { timingDecoys } from './timing-decoy.ts';

// ---------------------------------------------------------------------------------------------
// Generic failures: status + catalog code + catalog text, no reason attached (A5, A6).
// ---------------------------------------------------------------------------------------------

function authFailed(): HttpError {
  return new HttpError(401, 'auth.failed', AUTH_MESSAGES['auth.signIn.failed']);
}

function codeInvalid(): HttpError {
  return new HttpError(401, 'auth.code_invalid', AUTH_MESSAGES['auth.code.invalid']);
}

function linkInvalid(): HttpError {
  return new HttpError(401, 'auth.link_invalid', AUTH_MESSAGES['auth.link.invalid']);
}

function refreshInvalid(): HttpError {
  return new HttpError(401, 'auth.refresh_invalid', 'Not authenticated.');
}

/** Marker errors for "the single-winner UPDATE found a loser" (C3). Never leave the service. */
class RotationLost extends Error {}
class MagicAlreadyUsed extends Error {}
class GrantAlreadyUsed extends Error {}

export interface TokensData {
  accessToken: string;
  refreshToken: string;
  userId: string;
  accountStatus?: 'pending_deletion';
}

export interface MessageData {
  message: string;
}

// ---------------------------------------------------------------------------------------------
// Session row helpers
// ---------------------------------------------------------------------------------------------

interface RefreshCreateArgs {
  selector: string;
  verifier_hash: string;
  family_id: string;
  parent_id: string | null;
  user_id: string;
  device_id: string | null;
  expires_at: Date;
}

/** Prepare a refresh token (selector/verifier + Argon2id hash) BEFORE any transaction (C6). */
async function prepareRefresh(userId: string, familyId: string, parentId: string | null) {
  const parts = createTokenParts();
  const verifierHash = await hashSecret(parts.verifier);
  const data: RefreshCreateArgs = {
    selector: parts.selector,
    verifier_hash: verifierHash,
    family_id: familyId,
    parent_id: parentId,
    user_id: userId,
    device_id: null,
    expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1_000),
  };
  return { token: formatToken(parts), data };
}

async function revokeFamily(familyId: string): Promise<void> {
  const db = globalDb();
  await db.refresh_tokens.updateMany({
    where: { family_id: familyId, revoked_at: null },
    data: { revoked_at: new Date() },
  });
}

// ---------------------------------------------------------------------------------------------
// Sign up + code verification (PRD 8.1, recipes 3.18)
// ---------------------------------------------------------------------------------------------

export async function signUp(input: SignUpInput): Promise<MessageData> {
  const db = globalDb();

  // The country decides the payment currency; the server checks membership (PRD 8.1).
  const country = await db.countries.findUnique({ where: { code: input.country } });
  if (country === null) {
    throw new HttpError(422, 'validation.failed', 'Validation failed.', undefined, {
      country: 'validation.country',
    });
  }

  // Both hashes are computed on BOTH paths (known and unknown email) so the work — and therefore
  // the timing — matches: the password hash always, the inert placeholder hash always (A6).
  const passwordHash = await hashSecret(input.password);
  const placeholderHash = await hashSecret(randomBytes(32));

  const existing = await db.users.findUnique({ where: { email: input.email } });
  if (existing !== null) {
    await enqueueEmail({ kind: 'signupNotice', email: input.email });
  } else {
    // The pending row is created HERE because it holds the Argon2id password hash, which can
    // never sit in a job payload (J3). The 6-digit code itself is generated by the email job,
    // which stores its hash in code_hash (column is NOT NULL, so an inert placeholder fills it
    // until the job runs; no user can know a placeholder, so verify fails uniformly).
    await db.pending_signups.upsert({
      where: { email: input.email },
      create: {
        email: input.email,
        display_name: input.displayName,
        country: input.country,
        password_hash: passwordHash,
        code_hash: placeholderHash,
        expires_at: new Date(Date.now() + CODE_TTL_SECONDS * 1_000),
      },
      update: {
        display_name: input.displayName,
        country: input.country,
        password_hash: passwordHash,
      },
    });
    await enqueueEmail({ kind: 'signupCode', email: input.email });
  }

  // Cooldown starts with the first request, identically for known and unknown emails (A9).
  await startCooldown('signup', input.email);
  return { message: AUTH_MESSAGES['auth.signUp.submitted'] };
}

export async function resendSignupCode(input: ResendCodeInput): Promise<MessageData> {
  // Inside the 60-second window: the SAME answer and nothing restarts (A9, testing recipe).
  const remaining = await cooldownSeconds('signup', input.email);
  if (remaining === 0) {
    await startCooldown('signup', input.email);
    await enqueueEmail({ kind: 'signupCode', email: input.email });
  }
  return { message: AUTH_MESSAGES['auth.signUp.submitted'] };
}

export async function verifyCode(input: VerifyCodeInput): Promise<TokensData> {
  const db = globalDb();
  const dummy = await getDummyHash();

  const pending = await db.pending_signups.findUnique({ where: { email: input.email } });
  if (pending === null) {
    // Unknown email: one real Argon2id verify (A7), preceded by the SAME attempts-guard statement
    // the known path runs — against the seeded decoy row so the write costs the same (ADR 0010
    // escalation; a zero-row mirror matched the round-trip but not the ~8 ms write), falling back
    // to a random id (zero rows, no write) when the seed cannot run. Without a mirror at all the
    // missing row was ~14 ms faster than the known path, a measurable existence oracle (timing
    // evidence: docs/SECURITY.md section 5).
    const decoys = await timingDecoys();
    await db.$queryRaw<Array<{ id: string }>>`
      UPDATE pending_signups
      SET attempts = CASE WHEN attempts + 1 >= ${CODE_MAX_ATTEMPTS} THEN 0 ELSE attempts + 1 END
      WHERE id = ${decoys?.pendingId ?? randomUUID()} AND attempts < ${CODE_MAX_ATTEMPTS} AND expires_at > now()
      RETURNING id`;
    await verifySecret(dummy, input.code);
    throw codeInvalid();
  }

  // Atomic attempt guard: the increment, the expiry and the cap live in ONE statement (A9, C3).
  const attempted = await db.$queryRaw<Array<{ id: string }>>`
    UPDATE pending_signups
    SET attempts = attempts + 1
    WHERE id = ${pending.id} AND attempts < ${CODE_MAX_ATTEMPTS} AND expires_at > now()
    RETURNING id`;
  if (attempted.length === 0) {
    await verifySecret(dummy, input.code);
    throw codeInvalid();
  }

  const codeOk = await verifySecret(pending.code_hash, input.code);
  if (!codeOk) throw codeInvalid();

  // Prepare session material outside the transaction (C6).
  const refresh = await prepareRefresh('placeholder', randomUUID(), null);

  let userId = '';
  let refreshToken = '';
  try {
    await db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; email_verified_at: Date | null }>>`
        SELECT id, email_verified_at FROM users WHERE email = ${input.email} FOR UPDATE`;
      const existing = locked[0];
      if (existing !== undefined) {
        // The account row exists (for example an unverified account re-verifying). A VERIFIED
        // row means someone else owns this email: the same generic failure, no explanation (A6).
        if (existing.email_verified_at !== null) throw codeInvalid();
        await tx.users.update({
          where: { id: existing.id },
          data: {
            email_verified_at: new Date(),
            display_name: pending.display_name,
            country: pending.country,
          },
        });
        userId = existing.id;
      } else {
        const created = await tx.users.create({
          data: {
            email: input.email,
            display_name: pending.display_name,
            country: pending.country,
            password_hash: pending.password_hash,
            email_verified_at: new Date(),
          },
        });
        userId = created.id;
      }
      await tx.pending_signups.delete({ where: { id: pending.id } });
      // "the users row is created and the user is signed in" — the session lands in the same
      // transaction as the account (PRD 8.1, C3).
      refresh.data.user_id = userId;
      await tx.refresh_tokens.create({ data: refresh.data });
      refreshToken = refresh.token;
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (isUniqueViolation(err)) throw codeInvalid();
    throw err;
  }

  const accessToken = await signAccessToken(userId);
  // Welcome is enqueued once per account; the sent_emails guard makes the job idempotent (C4).
  await enqueueEmail({ kind: 'welcome', userId });
  return { accessToken, refreshToken, userId };
}

// ---------------------------------------------------------------------------------------------
// Sign in (recipe 3.4)
// ---------------------------------------------------------------------------------------------

export type SignInResult = { tokens: TokensData } | { message: string };

export async function signIn(input: SignInInput): Promise<SignInResult> {
  const db = globalDb();
  const user = await db.users.findUnique({ where: { email: input.email } });

  // Exactly one verify on every attempt — a dummy hash when the email is unknown (A7).
  const passwordOk = await verifySecret(user?.password_hash ?? (await getDummyHash()), input.password);
  if (user === null || !passwordOk) throw authFailed();

  if (user.email_verified_at === null) {
    // Correct password, unverified email: re-send the code and answer with the uniform prompt
    // (PRD 8.1). The pending row reuses the user's own password hash — never a payload (J3).
    const placeholderHash = await hashSecret(randomBytes(32));
    await db.pending_signups.upsert({
      where: { email: input.email },
      create: {
        email: input.email,
        display_name: user.display_name,
        country: user.country,
        password_hash: user.password_hash,
        code_hash: placeholderHash,
        expires_at: new Date(Date.now() + CODE_TTL_SECONDS * 1_000),
      },
      update: { password_hash: user.password_hash },
    });
    await enqueueEmail({ kind: 'signupCode', email: input.email });
    await startCooldown('signup', input.email);
    return { message: AUTH_MESSAGES['auth.signUp.submitted'] };
  }

  // A1: re-hash on a successful login when the stored parameters are behind today's policy.
  if (needsRehash(user.password_hash)) {
    await db.users.update({
      where: { id: user.id },
      data: { password_hash: await hashSecret(input.password) },
    });
  }

  const familyId = randomUUID();
  const refresh = await prepareRefresh(user.id, familyId, null);
  await db.refresh_tokens.create({ data: refresh.data });

  const accessToken = await signAccessToken(user.id);
  const tokens: TokensData = { accessToken, refreshToken: refresh.token, userId: user.id };
  if (user.status === 'pending_deletion') tokens.accountStatus = 'pending_deletion';
  return { tokens };
}

// ---------------------------------------------------------------------------------------------
// Refresh rotation with reuse detection (A11, recipe 3.17)
// ---------------------------------------------------------------------------------------------

export async function refresh(input: RefreshInput): Promise<TokensData> {
  const db = globalDb();
  const parts = splitToken(input.refreshToken);
  if (parts === null) throw refreshInvalid();

  const row = await db.refresh_tokens.findUnique({ where: { selector: parts.selector } });
  const verifierOk = await verifySecret(row?.verifier_hash ?? (await getDummyHash()), parts.verifier);
  if (row === null || !verifierOk) throw refreshInvalid();
  if (row.revoked_at !== null || row.expires_at.getTime() <= Date.now()) throw refreshInvalid();
  if (row.used_at !== null) {
    // Reuse detected: revoke the whole family; the newest token of the family dies too (A11).
    await revokeFamily(row.family_id);
    throw refreshInvalid();
  }

  // Child material is prepared before the transaction (C6); the race guard is the UPDATE itself.
  const child = await prepareRefresh(row.user_id, row.family_id, row.id);

  try {
    await db.$transaction(async (tx) => {
      const rotated = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE refresh_tokens
        SET used_at = now()
        WHERE id = ${row.id} AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
        RETURNING id`;
      if (rotated.length === 0) throw new RotationLost();
      await tx.refresh_tokens.create({ data: child.data });
    });
  } catch (err) {
    if (err instanceof RotationLost) {
      // A concurrent presentation of the same token won. From here it looks like reuse (A11):
      // revoke the family so neither side keeps a session from one token.
      const fresh = await db.refresh_tokens.findUnique({ where: { selector: parts.selector } });
      if (fresh !== null && fresh.used_at !== null && fresh.revoked_at === null) {
        await revokeFamily(fresh.family_id);
      }
      throw refreshInvalid();
    }
    throw err;
  }

  const accessToken = await signAccessToken(row.user_id);
  return { accessToken, refreshToken: child.token, userId: row.user_id };
}

// ---------------------------------------------------------------------------------------------
// Profile (GET /auth/me; Phase 2 app views — the server owns the display name, S5)
// ---------------------------------------------------------------------------------------------

/** Load the signed-in user's id and display name. A valid token whose user row is gone is the
 *  same generic 401 as any other authentication problem (A5). */
export async function me(userId: string): Promise<{ userId: string; displayName: string }> {
  const db = globalDb();
  const user = await db.users.findUnique({ where: { id: userId }, select: { id: true, display_name: true } });
  if (user === null) throw new HttpError(401, 'auth.not_authenticated', 'Not authenticated.');
  return { userId: user.id, displayName: user.display_name };
}

// ---------------------------------------------------------------------------------------------
// Reference data (GET /auth/countries; PRD 8.1 sign-up country list)
// ---------------------------------------------------------------------------------------------

/** The offered countries for the sign-up form, ordered by name. `countries` only holds rows
 *  whose currency is sold (docs/DATABASE.md), so this list IS the offer — the app must not
 *  keep its own copy (S5). Public read, no user data (P6: rows are reference data). */
export async function listCountries(): Promise<{ code: string; name: string }[]> {
  const db = globalDb();
  return db.countries.findMany({ select: { code: true, name: true }, orderBy: { name: 'asc' } });
}

// ---------------------------------------------------------------------------------------------
// Log out / log out of all devices (PRD 8.1, A11)
// ---------------------------------------------------------------------------------------------

export async function logout(input: LogoutInput, userId: string): Promise<Record<string, never>> {
  const db = globalDb();
  const parts = splitToken(input.refreshToken);
  if (parts !== null) {
    const row = await db.refresh_tokens.findUnique({ where: { selector: parts.selector } });
    const verifierOk = row !== null && (await verifySecret(row.verifier_hash, parts.verifier));
    // Only this user's family is revoked; a token belonging to someone else changes nothing.
    if (row !== null && verifierOk && row.user_id === userId) {
      await revokeFamily(row.family_id);
    }
  }
  return {};
}

export async function logoutAll(userId: string): Promise<Record<string, never>> {
  const db = globalDb();
  await db.$transaction([
    // Revoke every refresh token of the user...
    db.refresh_tokens.updateMany({
      where: { user_id: userId, revoked_at: null },
      data: { revoked_at: new Date() },
    }),
    // ...and delete their devices (push tokens), as PRD 8.1 and A11 say. Devices re-register on
    // the next sign-in; access tokens already issued keep working until they expire (A11).
    db.devices.deleteMany({ where: { user_id: userId } }),
  ]);
  return {};
}

// ---------------------------------------------------------------------------------------------
// Forgot password + reset (A10, recipe 3.19)
// ---------------------------------------------------------------------------------------------

export async function requestResetCode(input: ForgotInput): Promise<MessageData> {
  const remaining = await cooldownSeconds('reset', input.email);
  if (remaining === 0) {
    await startCooldown('reset', input.email);
    await enqueueEmail({ kind: 'resetCode', email: input.email });
  }
  // The job decides whether the account exists (A6): the request did identical work either way.
  return { message: AUTH_MESSAGES['auth.forgot.submitted'] };
}

export async function verifyResetCode(input: ResetCodeInput): Promise<{ grant: string }> {
  const db = globalDb();
  const dummy = await getDummyHash();

  const user = await db.users.findUnique({ where: { email: input.email } });
  if (user === null) {
    // A7 parity: the known path below pays one guard round-trip AND one matched write, so the
    // unknown email pays the SAME statement against the seeded decoy row (ADR 0010 escalation),
    // falling back to a random id (zero rows, no write) when the seed cannot run.
    const decoys = await timingDecoys();
    await db.$queryRaw<Array<{ id: string }>>`
      UPDATE password_resets
      SET attempts = CASE WHEN attempts + 1 >= ${CODE_MAX_ATTEMPTS} THEN 0 ELSE attempts + 1 END
      WHERE id = ${decoys?.resetId ?? randomUUID()} AND consumed_at IS NULL AND expires_at > now() AND attempts < ${CODE_MAX_ATTEMPTS}
      RETURNING id`;
    await verifySecret(dummy, input.code);
    throw codeInvalid();
  }

  const row = await db.password_resets.findFirst({ where: { user_id: user.id, consumed_at: null } });
  if (row === null) {
    // Same parity for "account exists but no active code": this path already paid the findFirst
    // the known-with-row path pays, and now runs the same guard statement against the seeded
    // decoy row (ADR 0010 escalation), falling back to a random id when the seed cannot run.
    const decoys = await timingDecoys();
    await db.$queryRaw<Array<{ id: string }>>`
      UPDATE password_resets
      SET attempts = CASE WHEN attempts + 1 >= ${CODE_MAX_ATTEMPTS} THEN 0 ELSE attempts + 1 END
      WHERE id = ${decoys?.resetId ?? randomUUID()} AND consumed_at IS NULL AND expires_at > now() AND attempts < ${CODE_MAX_ATTEMPTS}
      RETURNING id`;
    await verifySecret(dummy, input.code);
    throw codeInvalid();
  }

  const attempted = await db.$queryRaw<Array<{ id: string }>>`
    UPDATE password_resets
    SET attempts = attempts + 1
    WHERE id = ${row.id} AND consumed_at IS NULL AND expires_at > now() AND attempts < ${CODE_MAX_ATTEMPTS}
    RETURNING id`;
  if (attempted.length === 0) {
    await verifySecret(dummy, input.code);
    throw codeInvalid();
  }

  const codeOk = await verifySecret(row.code_hash, input.code);
  if (!codeOk) throw codeInvalid();

  // Consume the code and issue the grant in ONE statement (single use, C3, A10).
  const grantParts = createTokenParts();
  const grantHash = await hashSecret(grantParts.verifier);
  const grantExpiresAt = new Date(Date.now() + RESET_GRANT_TTL_SECONDS * 1_000);
  const granted = await db.$queryRaw<Array<{ id: string }>>`
    UPDATE password_resets
    SET consumed_at = now(),
        grant_selector = ${grantParts.selector},
        grant_verifier_hash = ${grantHash},
        grant_expires_at = ${grantExpiresAt}
    WHERE id = ${row.id} AND consumed_at IS NULL
    RETURNING id`;
  if (granted.length === 0) throw codeInvalid();

  return { grant: formatToken(grantParts) };
}

export async function resetNewPassword(input: ResetNewPasswordInput): Promise<MessageData> {
  const db = globalDb();
  const dummy = await getDummyHash();

  const parts = splitToken(input.grant);
  if (parts === null) {
    await verifySecret(dummy, input.grant);
    throw linkInvalid();
  }

  const row = await db.password_resets.findFirst({ where: { grant_selector: parts.selector } });
  const verifierOk =
    row !== null && row.grant_verifier_hash !== null && (await verifySecret(row.grant_verifier_hash, parts.verifier));
  const notExpired = row !== null && row.grant_expires_at !== null && row.grant_expires_at.getTime() > Date.now();
  if (row === null || !verifierOk || !notExpired) {
    if (row === null) await verifySecret(dummy, parts.verifier);
    throw linkInvalid();
  }

  // Argon2 runs before the transaction so no long CPU work happens while rows are locked (C6).
  const newPasswordHash = await hashSecret(input.newPassword);

  try {
    await db.$transaction(async (tx) => {
      // Single use: NULLing all three grant columns together (reset_grant_complete allows it)
      // is both the consumption and the guard — only one caller can flip the non-NULL selector.
      const consumed = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE password_resets
        SET grant_selector = NULL, grant_verifier_hash = NULL, grant_expires_at = NULL
        WHERE id = ${row.id} AND grant_selector IS NOT NULL
        RETURNING id`;
      if (consumed.length === 0) throw new GrantAlreadyUsed();
      await tx.users.update({ where: { id: row.user_id }, data: { password_hash: newPasswordHash } });
      // A successful reset revokes every refresh token for the user (A10).
      await tx.refresh_tokens.updateMany({
        where: { user_id: row.user_id, revoked_at: null },
        data: { revoked_at: new Date() },
      });
    });
  } catch (err) {
    if (err instanceof GrantAlreadyUsed) throw linkInvalid();
    throw err;
  }

  return { message: AUTH_MESSAGES['auth.reset.done'] };
}

// ---------------------------------------------------------------------------------------------
// Magic link (A13, recipe 3.20; owner override: 5-minute TTL via the shared constant)
// ---------------------------------------------------------------------------------------------

export async function magicRequest(input: MagicRequestInput): Promise<MessageData> {
  // No database read at all: the job decides whether the account exists (A6), so this path is
  // identical for every email.
  await enqueueEmail({ kind: 'magicLink', email: input.email });
  return { message: AUTH_MESSAGES['auth.magic.submitted'] };
}

export async function magicConsume(input: MagicConsumeInput): Promise<TokensData> {
  const db = globalDb();
  const dummy = await getDummyHash();

  const parts = splitToken(input.token);
  if (parts === null) {
    await verifySecret(dummy, input.token);
    throw linkInvalid();
  }

  const row = await db.magic_tokens.findUnique({ where: { selector: parts.selector } });
  const verifierOk = row !== null && (await verifySecret(row.verifier_hash, parts.verifier));
  if (row === null || !verifierOk) {
    if (row === null) await verifySecret(dummy, parts.verifier);
    throw linkInvalid();
  }

  // Session material prepared before the transaction (C6).
  const child = await prepareRefresh(row.user_id, randomUUID(), null);

  try {
    await db.$transaction(async (tx) => {
      // Single winner: the first POST flips consumed_at; the second finds 0 rows (C3).
      const consumed = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE magic_tokens
        SET consumed_at = now()
        WHERE id = ${row.id} AND consumed_at IS NULL AND expires_at > now()
        RETURNING id`;
      if (consumed.length === 0) throw new MagicAlreadyUsed();
      await tx.refresh_tokens.create({ data: child.data });
    });
  } catch (err) {
    if (err instanceof MagicAlreadyUsed) throw linkInvalid();
    throw err;
  }

  const user = await db.users.findUnique({ where: { id: row.user_id } });
  const accessToken = await signAccessToken(row.user_id);
  const tokens: TokensData = { accessToken, refreshToken: child.token, userId: row.user_id };
  if (user !== null && user.status === 'pending_deletion') tokens.accountStatus = 'pending_deletion';
  return tokens;
}
