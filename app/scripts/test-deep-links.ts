// DEEP-LINK PARSER PROOF (PRD 8.1 line 121/286-291, A13; no device): every accepted shape returns
// its kind and token, and every unexpected shape — query strings, bare pages, empty or oversized
// tokens, foreign schemes — returns null instead of a half-parsed secret. Run from the repo root:
//   npm exec --workspace @rowta/app -- tsx scripts/test-deep-links.ts
import { parseDeepLink } from '../src/lib/deep-links';

let failures = 0;
const check = (ok: boolean, label: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

const accepts = (url: string, kind: 'magic' | 'invite', token: string, label: string) => {
  const parsed = parseDeepLink(url);
  check(parsed !== null && parsed.kind === kind && parsed.token === token, label);
};

const acceptsBilling = (url: string, label: string) => {
  const parsed = parseDeepLink(url);
  check(parsed !== null && parsed.kind === 'billing_complete', label);
};

const rejects = (url: string, label: string) => {
  check(parseDeepLink(url) === null, label);
};

// The server's canonical magic and invite links: https, token in the FRAGMENT (A13: never a query string).
accepts('https://rowta.example/magic#sel.ver', 'magic', 'sel.ver', 'canonical https /magic#<token> parses (fragment form)');
accepts('https://rowta.example/invite#tok_123-abc', 'invite', 'tok_123-abc', 'canonical https /invite#<token> parses (fragment form)');
accepts('https://rowta.example/invite/#tok_123-abc', 'invite', 'tok_123-abc', 'canonical https /invite/#<token> parses (fragment form with slash)');
accepts('http://localhost:8081/invite#tok_123-abc', 'invite', 'tok_123-abc', 'dev web-app http://localhost:8081/invite#<token> parses');
// Magic path form and scheme forms (PRD 121).
accepts('https://rowta.example/magic/sel.ver', 'magic', 'sel.ver', 'https /magic/<token> path form parses');
accepts('rowta://magic/sel.ver', 'magic', 'sel.ver', 'rowta://magic/<token> fallback parses');
accepts('rowta://magic#sel.ver', 'magic', 'sel.ver', 'rowta://magic#<token> dev mirror parses');
accepts('rowta://invite#tok_123-abc', 'invite', 'tok_123-abc', 'rowta://invite#<token> fragment form parses');
accepts('rowta://invite/#tok_123-abc', 'invite', 'tok_123-abc', 'rowta://invite/#<token> fragment form parses');
accepts('  ROWTA://MAGIC/Sel.Ver  ', 'magic', 'Sel.Ver', 'scheme and kind are case-insensitive, token preserved');
accepts('  ROWTA://INVITE/#Tok_123-abc  ', 'invite', 'Tok_123-abc', 'scheme and kind are case-insensitive for invite fragment');

// Billing return deep links (I3): web and scheme forms, ignoring query strings.
acceptsBilling('https://rowta.example/billing/complete', 'https /billing/complete parses');
acceptsBilling('https://rowta.example/billing/complete/', 'https /billing/complete/ parses');
acceptsBilling('https://rowta.example/billing/complete?status=successful&tx_ref=ref_123', 'https /billing/complete?status=... parses');
acceptsBilling('rowta://billing/complete', 'rowta://billing/complete parses');
acceptsBilling('rowta://billing/complete/', 'rowta://billing/complete/ parses');
acceptsBilling('rowta://billing/complete?status=successful', 'rowta://billing/complete?status=... parses');
acceptsBilling('  ROWTA://BILLING/COMPLETE  ', 'rowta://billing/complete case-insensitive');

// Strict rejections: a secret is never half-parsed (A13 hygiene).
rejects('https://rowta.example/invite/tok_123-abc', 'path-style invite https /invite/<token> is rejected');
rejects('rowta://invite/tok_123-abc', 'path-style invite rowta://invite/<token> is rejected');
rejects('https://rowta.example/magic', 'the bare /magic page (no token) is not a link target');
rejects('https://rowta.example/magic#', 'an empty fragment token is rejected');
rejects('https://rowta.example/magic/', 'an empty path token is rejected');
rejects('rowta://magic', 'a scheme URL with no token is rejected');
rejects('rowta://invite/', 'a scheme invite with an empty token is rejected');
rejects('https://rowta.example/magic#tok?x=1', 'a fragment containing a query is rejected');
rejects('https://rowta.example/magic/tok?utm=1', 'a path token with a query string is rejected');
rejects('https://rowta.example/other/tok', 'an unknown path is rejected');
rejects('https://rowta.example/billing', 'bare /billing without complete is rejected');
rejects('https://rowta.example/billing/other', 'unknown billing subpath is rejected');
rejects('rowta://billing', 'bare scheme rowta://billing is rejected');
rejects('rowta://billing/other', 'unknown scheme billing subpath is rejected');
rejects('https://evil.example/magic#tok#extra', 'a double-fragment URL is rejected');
rejects('httpx://rowta.example/magic#tok', 'an unknown scheme is rejected');
rejects('not a url at all', 'free text is rejected');
rejects('', 'the empty string is rejected');
rejects('   ', 'whitespace only is rejected');
rejects(`https://rowta.example/magic#${'a'.repeat(3000)}`, 'an oversized token (>2048) is rejected');

// The parser must never throw, whatever a browser or intent hands it.
let threw = false;
try {
  parseDeepLink('https://[::1]/magic#%E0%A4%A');
  parseDeepLink('rowta://magic/#/'.repeat(3));
} catch {
  threw = true;
}
check(!threw, 'malformed percent-encoding and separators never throw');

process.exit(failures === 0 ? 0 : 1);
