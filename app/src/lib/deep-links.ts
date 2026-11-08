// DEEP-LINK PARSING (PRD 8.1 line 121/286-291, A13): PURE, no React Native — proven by
// app/scripts/test-deep-links.ts in plain Node. Four accepted shapes, nothing else:
//
//   https://<host>/magic#<token>        the server's canonical magic link — token in the FRAGMENT
//                                        (never a query string; the fragment never reaches a server, A13)
//   https://<host>/magic/<token>        the documented path form (same one-button rule)
//   https://<host>/invite/<token>       verified invite link (web page / invite acceptance, Phase 3)
//   rowta://magic/<token> and rowta://invite/<token>   the custom-scheme FALLBACKS (PRD 121),
//                                        plus rowta://magic#<token> as a dev mirror of the fragment form
//
// Strictness: query strings (except billing/complete where external redirects attach them), empty/oversized
// tokens (> tokenField's 2048), bare pages (/magic with no token) and every other URL return null — an
// unexpected shape is never half-parsed (A13 hygiene; nothing here logs the URL, so a token can never reach a log line, S1).
export type DeepLink =
  | { kind: 'magic'; token: string }
  | { kind: 'invite'; token: string }
  | { kind: 'billing_complete' };

const WEB_FRAGMENT = /^https?:\/\/[^/?#]+\/(magic)#([^/?#]{1,2048})$/i;
const WEB_PATH = /^https?:\/\/[^/?#]+\/(magic|invite)\/([^/?#]{1,2048})$/i;
const SCHEME_FRAGMENT = /^rowta:\/\/(magic|invite)#([^/?#]{1,2048})$/i;
const SCHEME_PATH = /^rowta:\/\/(magic|invite)\/([^/?#]{1,2048})$/i;

const WEB_BILLING_COMPLETE = /^https?:\/\/[^/?#]+\/billing\/complete(?:\/)?(?:[?#].*)?$/i;
const SCHEME_BILLING_COMPLETE = /^rowta:\/\/billing\/complete(?:\/)?(?:[?#].*)?$/i;

const SHAPES = [WEB_FRAGMENT, WEB_PATH, SCHEME_FRAGMENT, SCHEME_PATH];

export function parseDeepLink(url: string): DeepLink | null {
  const value = url.trim();
  if (value === '') return null;
  if (WEB_BILLING_COMPLETE.test(value) || SCHEME_BILLING_COMPLETE.test(value)) {
    return { kind: 'billing_complete' };
  }
  for (const shape of SHAPES) {
    const match = shape.exec(value);
    if (match === null) continue;
    const kind = match[1]?.toLowerCase();
    const token = match[2];
    if (token === undefined || token.length === 0) return null;
    if (kind === 'magic') return { kind: 'magic', token };
    if (kind === 'invite') return { kind: 'invite', token };
    return null;
  }
  return null;
}
