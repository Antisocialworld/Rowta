// WEB ADDRESS STRIP (PRD 8.1, A13; owner request 28 Oct 2026): after parseDeepLink has read a
// link token into memory, the Expo web build removes it from the address bar so it can no longer
// be seen or shared. Mirrors web/src/token-page.js (owner decision 4): invite strips to /invite,
// magic strips to /magic in both the path and the fragment form. PURE module — history and
// location are arguments, so the plain-Node proof (app/scripts/test-web-address.ts) needs no
// browser. Nothing here logs or returns the token, and a failing history call is swallowed
// (best-effort: the token is already in memory and is never re-read from the address).
export type AddressHistory = {
  replaceState(state: unknown, title: string, url: string): void;
};

export type AddressLocation = {
  pathname: string;
  search?: string;
  hash?: string;
};

export function stripTokenFromAddress(history: AddressHistory, location: AddressLocation): void {
  const pathname = location.pathname ?? '';
  const search = location.search ?? '';
  const hash = location.hash ?? '';
  // The parser accepts none of the token shapes with a query string, so a query means leave alone.
  if (search !== '') return;
  const segments = pathname.split('/').filter((part) => part !== '');
  let next: string | null = null;
  if (segments.length === 2) {
    const kind = segments[0]?.toLowerCase();
    if (kind === 'magic') next = `/${kind}`;
  } else if (
    segments.length === 1 &&
    (segments[0]?.toLowerCase() === 'magic' || segments[0]?.toLowerCase() === 'invite') &&
    hash.length > 1
  ) {
    next = `/${segments[0].toLowerCase()}`;
  }
  if (next === null) return;
  try {
    history.replaceState(null, '', next);
  } catch {
    // Best-effort: a failed replace cannot bring the token back, so the failure is ignored.
  }
}
