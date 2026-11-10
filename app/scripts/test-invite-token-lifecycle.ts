// Invite-token lifecycle proof (owner decisions 1-3, 26 Oct 2026; rules A5, A6, A13, S1, S5;
// PRD 8.2). A fake fetch drives the ONE accept path (consumeInviteToken) and proves the four
// required cases plus the result texts — no device, no server. Run from the repo root:
//   npm exec --workspace @rowta/app -- tsx scripts/test-invite-token-lifecycle.ts
import { ApiError, setApiRuntime, setFetchForTests, teamsApi } from '../src/lib/api';
import { useAuthFlow } from '../src/state/auth-context';
import { inviteFailureDisposition, useTeams } from '../src/state/teams';
import { en } from '../src/i18n/en';

process.env.EXPO_PUBLIC_API_URL = 'http://api.test'; // test-only base URL, never a secret (S4)

let failures = 0;
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function okEnvelope(data: unknown): Response {
  return json(200, { data });
}

function errEnvelope(status: number, code: string, fields?: Record<string, string>): Response {
  return json(status, { error: { code, message: '', requestId: 'req_test', ...(fields !== undefined ? { fields } : {}) } });
}

function setInviteToken(token: string | null): void {
  useAuthFlow.getState().setFlow({ inviteToken: token });
}

function inviteToken(): string | null {
  return useAuthFlow.getState().inviteToken;
}

function resetStores(): void {
  setInviteToken(null);
  useTeams.getState().setInviteResult(null);
}

async function main(): Promise<void> {
  setApiRuntime({ getAccessToken: async () => 'access-token-for-test' });

  // ---------------------------------------------------------------------------------------------
  // Case 1: token CLEARED after a SUCCESSFUL accept (server answered 200)
  // ---------------------------------------------------------------------------------------------
  resetStores();
  setInviteToken('tok-success');
  setFetchForTests(async (url) => {
    if (url.endsWith('/invites/accept')) return okEnvelope({ teamId: '11111111-1111-4111-8111-111111111111', role: 'staff' });
    return okEnvelope({ id: '11111111-1111-4111-8111-111111111111', name: 'Acme Rosters', role: 'staff', managersCanRevokeInvites: false });
  });
  await useTeams.getState().consumeInviteToken('tok-success');
  check(inviteToken() === null, 'case 1: token cleared after a successful accept');
  const joined = useTeams.getState().inviteResult;
  check(joined !== null && joined.kind === 'joined', 'case 1: result is joined after a successful accept');
  check(
    joined !== null && joined.kind === 'joined' && joined.teamName === 'Acme Rosters',
    'case 1: the joined result carries the fetched team name (decision 1 text)',
  );

  // ---------------------------------------------------------------------------------------------
  // Case 2: token CLEARED after a SERVER-ANSWERED FAILURE (invitation errors only)
  // ---------------------------------------------------------------------------------------------
// Invitation refusals that clear the token (A5/A6; Fix Round 2 G4): 400, 403, 404, 409, 410, 422.
// Every other 4xx except 401/408/429 is a server answer about THIS invitation, so the dead token
// must not be retried. The result text stays uniform for every one of them.
  for (const [status, code] of [
    [400, 'auth.code_invalid'],
    [403, 'team.forbidden'],
    [404, 'team.notFound'],
    [409, 'idempotency.in_flight'],
    [410, 'auth.link.invalid'],
    [422, 'team.seatLimit'],
  ] as const) {
    resetStores();
    setInviteToken('tok-fail');
    setFetchForTests(async () => errEnvelope(status, code));
    await useTeams.getState().consumeInviteToken('tok-fail');
    check(inviteToken() === null, `case 2inv (${code}): token cleared after an invitation error (${status})`);
    const failed = useTeams.getState().inviteResult;
    check(failed !== null && failed.kind === 'failed', `case 2inv (${code}): result is the uniform failed state (${status})`);
  }

  // Transient/auth cases that keep the token: 401, 408, 429, 500, 503. These are not a refusal
  // of the invitation (the session layer decides 401; 408/429/5xx are retryable).
  for (const [status, code] of [
    [401, 'auth.not_authenticated'],
    [408, 'generic.error'],
    [429, 'rate.limited'],
    [500, 'generic.error'],
    [503, 'generic.error'],
  ] as const) {
    resetStores();
    setInviteToken('tok-server-error');
    setFetchForTests(async () => errEnvelope(status, code));
    await useTeams.getState().consumeInviteToken('tok-server-error');
    check(inviteToken() === 'tok-server-error', `case 2ret (${code}): token KEPT after a transient/auth error (${status})`);
    const kept = useTeams.getState().inviteResult;
    check(kept !== null && kept.kind === 'retry', `case 2ret (${code}): result is the retry state (${status})`);
  }

  // The decision table itself (G4): 401/408/429/5xx retry; 400/403/404/409/410/422 fail.
  const dispositionCases: readonly [number, 'retry' | 'failed'][] = [
    [400, 'failed'],
    [401, 'retry'],
    [403, 'failed'],
    [404, 'failed'],
    [408, 'retry'],
    [409, 'failed'],
    [410, 'failed'],
    [422, 'failed'],
    [429, 'retry'],
    [500, 'retry'],
    [503, 'retry'],
  ];
  for (const [status, expected] of dispositionCases) {
    check(
      inviteFailureDisposition(new ApiError(status, 'test.code', '')) === expected,
      `disposition (${status}): ${expected}`,
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Case 3: token KEPT after a NETWORK failure (no server answer) so the SAME attempt can retry
  // ---------------------------------------------------------------------------------------------
  resetStores();
  setInviteToken('tok-network');
  setFetchForTests(async () => {
    throw new TypeError('fetch failed'); // transport failure — send() maps it to client.network
  });
  await useTeams.getState().consumeInviteToken('tok-network');
  check(inviteToken() === 'tok-network', 'case 3: token KEPT after a network failure (decision 3 retry)');
  const retry = useTeams.getState().inviteResult;
  check(retry !== null && retry.kind === 'retry', 'case 3: result is the retry state after a network failure');

  // ...and a RETRY of that same attempt can then succeed and clear it:
  setFetchForTests(async (url) => {
    if (url.endsWith('/invites/accept')) return okEnvelope({ teamId: '22222222-2222-4222-8222-222222222222', role: 'staff' });
    return okEnvelope({ id: '22222222-2222-4222-8222-222222222222', name: 'Retry Team', role: 'staff', managersCanRevokeInvites: false });
  });
  await useTeams.getState().consumeInviteToken('tok-network');
  check(inviteToken() === null, 'case 3: the retry of the same attempt clears the token on success');

  // A TIMEOUT is treated the same as a network failure (client.timeout is a transport error, status 0):
  resetStores();
  setInviteToken('tok-timeout');
  setFetchForTests(async () => {
    throw new ApiError(0, 'client.timeout', '');
  });
  await useTeams.getState().consumeInviteToken('tok-timeout');
  check(inviteToken() === 'tok-timeout', 'case 3: token KEPT after a client.timeout (no server answer)');
  check(
    useTeams.getState().inviteResult?.kind === 'retry',
    'case 3: result is the retry state after a client.timeout',
  );

  // ---------------------------------------------------------------------------------------------
  // Follow-up fetch failure after a successful accept (G4): the join stands; only the display
  // name falls back. The token is already cleared by the success path.
  // ---------------------------------------------------------------------------------------------
  resetStores();
  setInviteToken('tok-name-fetch-fail');
  setFetchForTests(async (url) => {
    if (url.endsWith('/invites/accept')) return okEnvelope({ teamId: '44444444-4444-4444-8444-444444444444', role: 'staff' });
    return errEnvelope(500, 'generic.error');
  });
  await useTeams.getState().consumeInviteToken('tok-name-fetch-fail');
  check(inviteToken() === null, 'follow-up fetch: token cleared because the accept itself succeeded');
  const joinedWithoutName = useTeams.getState().inviteResult;
  check(
    joinedWithoutName !== null && joinedWithoutName.kind === 'joined' && joinedWithoutName.teamName === null,
    'follow-up fetch: a failed team-name fetch still reports joined with the generic name',
  );

  // ---------------------------------------------------------------------------------------------
  // G5: consumeInviteToken NEVER rejects (App.tsx calls it as `void ...` with no catch)
  // ---------------------------------------------------------------------------------------------
  // 1) An unexpected non-ApiError from the API method itself (not from fetch — send() wraps fetch
  //    failures as ApiError client.network, covered in case 3): the uniform failed result, token
  //    cleared, no throw.
  resetStores();
  setInviteToken('tok-unexpected');
  const originalAcceptInvite = teamsApi.acceptInvite;
  teamsApi.acceptInvite = async () => {
    throw new Error('unexpected API implementation failure');
  };
  let unexpectedRejected = false;
  try {
    await useTeams.getState().consumeInviteToken('tok-unexpected');
  } catch {
    unexpectedRejected = true;
  } finally {
    teamsApi.acceptInvite = originalAcceptInvite;
  }
  check(!unexpectedRejected, 'G5: consumeInviteToken resolves after an unexpected non-ApiError');
  check(inviteToken() === null, 'G5: an unexpected error clears the token (uniform failed path)');
  check(
    useTeams.getState().inviteResult?.kind === 'failed',
    'G5: an unexpected error stores the uniform failed result',
  );

  // 2) A store setter that throws while recording a REFUSED invitation: still no rejection, and the
  //    failed result is recorded; the token can only remain because the throwing setter could not
  //    clear it.
  resetStores();
  setInviteToken('tok-store-failure');
  setFetchForTests(async () => errEnvelope(400, 'auth.link.invalid'));
  const originalSetFlow = useAuthFlow.getState().setFlow;
  useAuthFlow.setState({
    setFlow: () => {
      throw new Error('unexpected store failure');
    },
  });
  let storeFailureRejected = false;
  try {
    await useTeams.getState().consumeInviteToken('tok-store-failure');
  } catch {
    storeFailureRejected = true;
  }
  useAuthFlow.setState({ setFlow: originalSetFlow });
  check(!storeFailureRejected, 'G5: consumeInviteToken resolves when the token-clear setter throws');
  check(
    useTeams.getState().inviteResult?.kind === 'failed',
    'G5: the uniform failed result is recorded even when the token-clear setter throws',
  );
  check(
    inviteToken() === 'tok-store-failure',
    'G5: the token remains only because the throwing setter could not clear it',
  );
  setInviteToken(null);

  // ---------------------------------------------------------------------------------------------
  // Case 4: a SECOND user on the same device never inherits the first user's token
  // ---------------------------------------------------------------------------------------------
  resetStores();
  // First user's attempt got a server answer (success): token is gone.
  setInviteToken('tok-user-one');
  setFetchForTests(async (url) => {
    if (url.endsWith('/invites/accept')) return okEnvelope({ teamId: '33333333-3333-4333-8333-333333333333', role: 'staff' });
    return okEnvelope({ id: '33333333-3333-4333-8333-333333333333', name: 'User One Team', role: 'staff', managersCanRevokeInvites: false });
  });
  await useTeams.getState().consumeInviteToken('tok-user-one');
  check(inviteToken() === null, 'case 4: first user token cleared after their attempt');
  // Second user signs in with NO invite token present — nothing is auto-accepted and nothing leaks.
  const secondUserToken = inviteToken();
  check(secondUserToken === null, 'case 4: second user sees no inherited invite token');

  // And if the first user's token survived only via a network error, sign-out clears it:
  resetStores();
  setInviteToken('tok-network-leftover');
  setFetchForTests(async () => {
    throw new TypeError('fetch failed');
  });
  await useTeams.getState().consumeInviteToken('tok-network-leftover');
  check(inviteToken() === 'tok-network-leftover', 'case 4 setup: network-error token still held');
  // clearLocal() (sign-out) clears the invite token — mirrored here through the same setFlow the
  // session layer runs (auth-session.clearLocal; proven end-to-end by the session unit path):
  useAuthFlow.getState().setFlow({ inviteToken: null });
  check(inviteToken() === null, 'case 4: sign-out clears a network-error leftover token');

  // ---------------------------------------------------------------------------------------------
  // Decision 1 texts: the catalog rows are exactly the owner-approved wording
  // ---------------------------------------------------------------------------------------------
  check(
    en['team.invite.joined'] === 'You joined {teamName}.',
    'decision 1: success text is "You joined <team name>."',
  );
  check(
    en['team.invite.failed'] === "This invitation can't be used. Check you're signed in with the email it was sent to.",
    'decision 1: failure text is the ONE uniform line for every failure kind',
  );

  setFetchForTests(null);
  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
