// Unit tests for account deletion and restore flow logic (Task D2/E4; rules U1, V1, V3, V5, S5, S14).
// Pure logic modules only — zero react-native imports so it runs in plain Node via tsx.
import {
  deleteAccountResponseSchema,
  deleteAccountSchema,
  deletePreviewResponseSchema,
  restoreAccountResponseSchema,
  restoreAccountSchema,
} from '@rowta/shared';
import { en } from '../src/i18n/en';
import { canProceedToStep2, isDeleteConfirmationReady } from '../src/lib/delete-account-logic';
import {
  ApiError,
  accountApi,
  authApi,
  errorMessageKey,
  setApiRuntime,
  setFetchForTests,
} from '../src/lib/api';

process.env.EXPO_PUBLIC_API_URL = 'http://api.test';

let failures = 0;
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

type Call = { url: string; init: RequestInit };

function responder(handler: (call: Call, index: number) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  setFetchForTests(async (url, init) => {
    const call: Call = { url: String(url), init: init ?? {} };
    calls.push(call);
    return handler(call, calls.length - 1);
  });
  return calls;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

async function expectApiError(run: () => Promise<unknown>, label: string): Promise<ApiError> {
  try {
    await run();
    check(false, `${label} (expected an ApiError rejection)`);
    return new ApiError(0, 'test.unexpected', '');
  } catch (error) {
    const ok = error instanceof ApiError;
    check(ok, label);
    return ok ? error : new ApiError(0, 'test.non-api', '');
  }
}

async function main(): Promise<void> {
  // -------------------------------------------------------------------------------------------
  // 0. Pure Deletion Logic Helpers (Task E6; rules U1, U7, X14; ADR 0018)
  // -------------------------------------------------------------------------------------------

  // canProceedToStep2: true only when 0 admin teams with other active members
  check(canProceedToStep2(0) === true, 'canProceedToStep2(0) allows proceeding (no admin teams with others)');
  check(canProceedToStep2(1) === false, 'canProceedToStep2(1) blocks proceeding (1 admin team with others)');
  check(canProceedToStep2(3) === false, 'canProceedToStep2(3) blocks proceeding (multiple admin teams with others)');

  // isDeleteConfirmationReady: non-empty password and exact 'DELETE' required
  check(isDeleteConfirmationReady('validPassword1', 'DELETE') === true, 'isDeleteConfirmationReady accepts non-empty password and exact DELETE');
  check(isDeleteConfirmationReady('validPassword1', '') === false, 'isDeleteConfirmationReady rejects empty confirm text');
  check(isDeleteConfirmationReady('', 'DELETE') === false, 'isDeleteConfirmationReady rejects empty password');
  check(isDeleteConfirmationReady('validPassword1', 'CANCEL') === false, 'isDeleteConfirmationReady rejects wrong word');
  check(isDeleteConfirmationReady('validPassword1', 'delete') === false, 'isDeleteConfirmationReady rejects lowercase delete');
  check(isDeleteConfirmationReady('validPassword1', 'Delete') === false, 'isDeleteConfirmationReady rejects mixed-case Delete');
  check(isDeleteConfirmationReady('validPassword1', ' DELETE') === false, 'isDeleteConfirmationReady rejects leading whitespace');
  check(isDeleteConfirmationReady('validPassword1', 'DELETE ') === false, 'isDeleteConfirmationReady rejects trailing whitespace');
  check(isDeleteConfirmationReady('validPassword1', ' DELETE ') === false, 'isDeleteConfirmationReady rejects surrounding whitespace');

  // -------------------------------------------------------------------------------------------
  // 1. Shared Zod Schemas (rules V1, V3, V4)
  // -------------------------------------------------------------------------------------------

  // deleteAccountSchema: password required, strict object
  const validDelete = deleteAccountSchema.safeParse({ password: 'ValidPassword1' });
  check(validDelete.success === true, 'deleteAccountSchema accepts non-empty password');

  const emptyPasswordDelete = deleteAccountSchema.safeParse({ password: '' });
  check(emptyPasswordDelete.success === false, 'deleteAccountSchema rejects empty password');

  const extraKeyDelete = deleteAccountSchema.safeParse({ password: 'ValidPassword1', extra: 'bad' });
  check(extraKeyDelete.success === false, 'deleteAccountSchema rejects unknown keys (rule V3 strict)');

  // restoreAccountSchema: email + password required, email normalised
  const validRestore = restoreAccountSchema.safeParse({
    email: 'Test@EXAMPLE.com',
    password: 'ValidPassword1',
  });
  check(
    validRestore.success === true && validRestore.data.email === 'test@example.com',
    'restoreAccountSchema normalises email to lowercase (rule V4)',
  );

  const invalidEmailRestore = restoreAccountSchema.safeParse({
    email: 'not-an-email',
    password: 'ValidPassword1',
  });
  check(invalidEmailRestore.success === false, 'restoreAccountSchema rejects malformed email');

  const emptyPasswordRestore = restoreAccountSchema.safeParse({
    email: 'test@example.com',
    password: '',
  });
  check(emptyPasswordRestore.success === false, 'restoreAccountSchema rejects empty password');

  const extraKeyRestore = restoreAccountSchema.safeParse({
    email: 'test@example.com',
    password: 'ValidPassword1',
    rogue: true,
  });
  check(extraKeyRestore.success === false, 'restoreAccountSchema rejects unknown keys (rule V3 strict)');

  // deletePreviewResponseSchema: breakdown shape
  const validPreview = deletePreviewResponseSchema.safeParse({
    adminTeamsWithOthers: [{ id: 'team-1', name: 'Alpha', otherMembers: 3 }],
    soleMemberTeams: 1,
    paysForTeams: 2,
    hasActiveSubscription: true,
  });
  check(validPreview.success === true, 'deletePreviewResponseSchema accepts valid breakdown payload');

  const invalidPreview = deletePreviewResponseSchema.safeParse({
    adminTeamsWithOthers: [],
    soleMemberTeams: 'not-a-number',
    paysForTeams: 0,
    hasActiveSubscription: false,
  });
  check(invalidPreview.success === false, 'deletePreviewResponseSchema rejects invalid member count type');

  // deleteAccountResponseSchema & restoreAccountResponseSchema
  const validDeleteResponse = deleteAccountResponseSchema.safeParse({ deleted: true });
  check(validDeleteResponse.success === true, 'deleteAccountResponseSchema accepts { deleted: true }');

  const invalidDeleteResponse = deleteAccountResponseSchema.safeParse({ deleted: 'yes' });
  check(invalidDeleteResponse.success === false, 'deleteAccountResponseSchema rejects non-boolean');

  const validRestoreResponse = restoreAccountResponseSchema.safeParse({ message: 'Account restored.' });
  check(validRestoreResponse.success === true, 'restoreAccountResponseSchema accepts message string');

  // -------------------------------------------------------------------------------------------
  // 2. API Client: delete-preview, delete, restore (rules S5, V1, S14)
  // -------------------------------------------------------------------------------------------

  setApiRuntime({
    getAccessToken: async () => 'test-bearer-token',
  });

  // accountApi.deletePreview
  {
    const calls = responder(() =>
      json(200, {
        data: {
          adminTeamsWithOthers: [],
          soleMemberTeams: 1,
          paysForTeams: 0,
          hasActiveSubscription: false,
        },
      }),
    );

    const preview = await accountApi.deletePreview();
    const call = calls[0];
    if (call === undefined) throw new Error('no request captured');
    check(call.url === 'http://api.test/account/delete-preview', 'accountApi.deletePreview hits GET /account/delete-preview');
    check(call.init.method === 'GET', 'accountApi.deletePreview uses GET method');
    const headers = call.init.headers as Record<string, string>;
    check(headers['authorization'] === 'Bearer test-bearer-token', 'accountApi.deletePreview sends Authorization header');
    check(preview.soleMemberTeams === 1 && preview.hasActiveSubscription === false, 'accountApi.deletePreview returns parsed data');
  }

  // accountApi.deleteAccount: client-side validation prevents fetch when input is invalid
  {
    const calls = responder(() => json(200, { data: { deleted: true } }));
    let threwClientValidation = false;
    try {
      await accountApi.deleteAccount({ password: '' });
    } catch {
      threwClientValidation = true;
    }
    check(threwClientValidation === true && calls.length === 0, 'accountApi.deleteAccount rejects empty password on client before fetch');
  }

  // accountApi.deleteAccount: valid request
  {
    const calls = responder(() => json(200, { data: { deleted: true } }));
    const result = await accountApi.deleteAccount({ password: 'ValidPassword1' });
    const call = calls[0];
    if (call === undefined) throw new Error('no request captured');
    check(call.url === 'http://api.test/account/delete', 'accountApi.deleteAccount hits POST /account/delete');
    check(call.init.method === 'POST', 'accountApi.deleteAccount uses POST method');
    const headers = call.init.headers as Record<string, string>;
    check(headers['authorization'] === 'Bearer test-bearer-token', 'accountApi.deleteAccount sends Authorization header');
    check(call.init.body === JSON.stringify({ password: 'ValidPassword1' }), 'accountApi.deleteAccount serialises password body');
    check(result.deleted === true, 'accountApi.deleteAccount returns parsed result');
  }

  // accountApi.deleteAccount: 401 invalid password
  {
    responder(() =>
      json(401, {
        error: { code: 'auth.failed', message: 'Invalid email or password.', requestId: 'req-del-401' },
      }),
    );
    const err = await expectApiError(() => accountApi.deleteAccount({ password: 'WrongPassword' }), 'accountApi.deleteAccount handles 401');
    check(err.status === 401 && err.code === 'auth.failed', 'accountApi.deleteAccount 401 surfaces status 401 and code auth.failed');
  }

  // accountApi.deleteAccount: 409 blocked by admin status
  {
    responder(() =>
      json(409, {
        error: { code: 'auth.deleteOwner.blocked', message: 'Transfer or delete your team first.', requestId: 'req-del-409' },
      }),
    );
    const err = await expectApiError(() => accountApi.deleteAccount({ password: 'ValidPassword1' }), 'accountApi.deleteAccount handles 409');
    check(err.status === 409 && err.code === 'auth.deleteOwner.blocked', 'accountApi.deleteAccount 409 surfaces code auth.deleteOwner.blocked');
  }

  // authApi.restoreAccount: client-side validation
  {
    const calls = responder(() => json(200, { data: { message: 'Account restored.' } }));
    let threwClientValidation = false;
    try {
      await authApi.restoreAccount({ email: 'bad-email', password: 'ValidPassword1' });
    } catch {
      threwClientValidation = true;
    }
    check(threwClientValidation === true && calls.length === 0, 'authApi.restoreAccount rejects invalid email on client before fetch');
  }

  // authApi.restoreAccount: successful call
  {
    const calls = responder(() => json(200, { data: { message: 'Account restored.' } }));
    const result = await authApi.restoreAccount({ email: 'Test@EXAMPLE.com', password: 'ValidPassword1' });
    const call = calls[0];
    if (call === undefined) throw new Error('no request captured');
    check(call.url === 'http://api.test/auth/restore-account', 'authApi.restoreAccount hits POST /auth/restore-account');
    check(call.init.method === 'POST', 'authApi.restoreAccount uses POST method');
    check(call.init.body === JSON.stringify({ email: 'Test@EXAMPLE.com', password: 'ValidPassword1' }), 'authApi.restoreAccount sends typed payload in body');
    check(result.message === 'Account restored.', 'authApi.restoreAccount returns parsed message');
  }

  // -------------------------------------------------------------------------------------------
  // 3. Error code and catalog mapping (rules V5, U8, PRD 11)
  // -------------------------------------------------------------------------------------------

  // auth.account_pending_deletion code maps to catalog key and has required text
  const pendingDeletionKey = errorMessageKey('auth.account_pending_deletion');
  check(pendingDeletionKey === 'auth.account_pending_deletion', 'errorMessageKey maps auth.account_pending_deletion to itself');
  check(
    en[pendingDeletionKey] === 'This account is scheduled for deletion.',
    'en catalog text for auth.account_pending_deletion states "This account is scheduled for deletion."',
  );

  // auth.deleteOwner.blocked maps to catalog key
  const blockedKey = errorMessageKey('auth.deleteOwner.blocked');
  check(blockedKey === 'auth.deleteOwner.blocked', 'errorMessageKey maps auth.deleteOwner.blocked to itself');
  check(
    en[blockedKey] === 'Transfer or delete your team first.',
    'en catalog text for auth.deleteOwner.blocked states "Transfer or delete your team first."',
  );

  // Deletion modal catalog strings exist and follow rules (sentence case, no "please")
  check(en['account.delete.heading'] === 'Delete account', 'catalog has account.delete.heading');
  check(en['account.delete.confirmButton'] === 'Delete account', 'catalog has account.delete.confirmButton');
  check(en['account.delete.typeDelete'] === 'Type DELETE to confirm', 'catalog has account.delete.typeDelete');
  check(en['account.delete.mismatch'] === 'Type DELETE in capital letters to confirm.', 'catalog has account.delete.mismatch');
  check(
    en['account.delete.step2Text'] === 'Enter your password and type DELETE to confirm.',
    'catalog has account.delete.step2Text',
  );
  check(
    en['account.delete.warning'].includes('30 days'),
    'account.delete.warning mentions the 30-day restore window',
  );

  // -------------------------------------------------------------------------------------------
  // 4. Teardown & result
  // -------------------------------------------------------------------------------------------
  setFetchForTests(null);

  if (failures === 0) {
    console.log('ALL PASSED: test-account-deletion-flow');
  } else {
    console.error(`FAILED: ${failures} assertion(s) failed`);
  }
  process.exit(failures === 0 ? 0 : 1);
}

void main();
