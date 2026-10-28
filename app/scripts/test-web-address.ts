// WEB ADDRESS STRIP PROOF (owner request 28 Oct 2026; PRD 8.1, A13; no browser): the pure module
// replaces an invite/magic token address with the bare page in the accepted shapes, ignores every
// other page, swallows a failing replaceState, and never logs or returns the token. Run from the
// repo root:
//   npm exec --workspace @rowta/app -- tsx scripts/test-web-address.ts
import { stripTokenFromAddress } from '../src/lib/web-address';

let failures = 0;
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

const TOKEN_INVITE = 'tok_123-abc';
const TOKEN_MAGIC = 'sel.ver';

const strip = (pathname: string, options: { search?: string; hash?: string } = {}) => {
  const calls: string[] = [];
  stripTokenFromAddress(
    {
      replaceState: (_state, _title, url) => {
        calls.push(url);
      },
    },
    { pathname, search: options.search ?? '', hash: options.hash ?? '' },
  );
  return calls;
};

const invite = strip(`/invite/${TOKEN_INVITE}`);
check(invite.length === 1 && invite[0] === '/invite', 'invite path is replaced with /invite');
check(invite.every((url) => !url.includes(TOKEN_INVITE)), 'invite: the new address never contains the token');

const magicPath = strip(`/magic/${TOKEN_MAGIC}`);
check(magicPath.length === 1 && magicPath[0] === '/magic', 'magic path is replaced with /magic');
check(magicPath.every((url) => !url.includes(TOKEN_MAGIC)), 'magic path: the new address never contains the token');

const magicFragment = strip('/magic', { hash: `#${TOKEN_MAGIC}` });
check(
  magicFragment.length === 1 && magicFragment[0] === '/magic' && !magicFragment[0].includes('#'),
  'magic fragment is replaced with /magic, no fragment remains',
);
check(magicFragment.every((url) => !url.includes(TOKEN_MAGIC)), 'magic fragment: the new address never contains the token');

check(strip('/auth/sign-in').length === 0, 'a non-token path is left untouched');
check(strip('/invite').length === 0, 'the bare /invite page is left untouched (reload sanity)');
check(strip('/magic').length === 0, 'the bare /magic page is left untouched (reload sanity)');
check(strip('/magic', { hash: '#' }).length === 0, 'an empty fragment is left untouched');
check(strip(`/invite/${TOKEN_INVITE}`, { search: '?utm=1' }).length === 0, 'a token path with a query string is left untouched (the parser never accepts it)');
const upper = strip(`/INVITE/${TOKEN_INVITE}`);
check(upper.length === 1 && upper[0] === '/invite', 'kind matching is case-insensitive, like the parser');

let threw = false;
let tokenSurfaced = false;
try {
  stripTokenFromAddress(
    {
      replaceState: () => {
        throw new Error(`refused: ${TOKEN_INVITE}`);
      },
    },
    { pathname: `/invite/${TOKEN_INVITE}`, search: '', hash: '' },
  );
} catch (error) {
  threw = true;
  if (error instanceof Error && error.message.includes(TOKEN_INVITE)) tokenSurfaced = true;
}
check(!threw, 'a throwing history.replaceState never throws out of the module');
check(!tokenSurfaced, 'a token inside a thrown history message never surfaces');

process.exit(failures === 0 ? 0 : 1);
