# 0025. Web session persistence via per-tab sessionStorage

Date: 2026-11-10. Status: accepted (supersedes ADR 0013 for the web build; Task W1). Phase 2 app web preview / web surface.

## Problem

Rule A11 requires tokens to live in `expo-secure-store` on native and bans `AsyncStorage`. On web, `expo-secure-store` does not exist.
ADR 0013 chose an in-memory-only token store for the web preview. The consequence was that any page reload (F5 / navigation) instantly returned the user to the signed-out state, impeding browser usage and testing.

The requirement is: on web, a page reload must keep the user signed in, while native behaviour (`expo-secure-store`, zero boot network calls) remains completely unchanged.

## Decision & Choice

1. **Access token stays in memory only.** It is never written to browser storage.
2. **Refresh token is stored in `sessionStorage` on web.**
   - `app/src/lib/token-platform.ts` provides `webSessionBackend`, which saves the access token in an in-memory `Map` and mirrors only the refresh token to browser `sessionStorage`.
   - Every `sessionStorage` call is wrapped in a `try/catch` block. If storage throws (e.g. storage disabled, private browsing sandbox, quota exceeded), it gracefully falls back to memory.
   - Native builds continue to use `expo-secure-store` exclusively.
3. **Single-flight boot rotation on web start-up.**
   - On web boot (`restore()`), if a refresh token is found in `sessionStorage`, the app calls the existing `/auth/refresh` endpoint once through a module-level `singleFlight` promise guard.
   - React StrictMode double-mount, multiple effects, or simultaneous 401 retries all share the exact same in-flight promise, preventing concurrent duplicate presentations of the same token.
   - The new rotated refresh token is written to storage **before** the refresh promise resolves, after which the session is hydrated (`signedIn`).
4. **Reuse-detection safety (server revokes family on duplicate presentation).**
   - The client never retries refresh with the same token.
   - If the refresh is rejected (401/403): clear storage and show sign-in.
   - If the failure is ambiguous (network error, timeout, 5xx, 429 after request sent): also clear storage and show sign-in. The client never retries with the old token, avoiding accidental reuse detection if the server actually rotated the token before the connection dropped.
5. **Clear on logout and replacement.**
   - The stored refresh token is cleared on: user sign-out, log out of all devices, any rejected refresh, and overwritten on successful sign-in.

## Why sessionStorage over localStorage

- **Per-tab isolation:** `localStorage` is shared across all tabs of the origin. In a token rotation architecture, opening or refreshing two tabs simultaneously would lead to race conditions where one tab rotates the token and the other tab presents the now-stale token, triggering server-side family revocation across all devices.
- With `sessionStorage`, each tab maintains its own independent session lifecycle:
  - Refreshing the tab keeps the user signed in (survives reload).
  - Closing the tab automatically discards the session.
  - Tabs cannot race each other's rotation.

## Security & XSS Trade-off

- `sessionStorage` is accessible to JavaScript executing on the origin. An XSS vulnerability could read the refresh token for that tab.
- This trade-off is accepted for the web preview because:
  - The access token is never written to storage (stays strictly in memory).
  - Refresh tokens are single-use, rotated immediately on start-up, and family-revoked on reuse.
  - The token is isolated to the lifetime of that single tab (unlike `localStorage` which persists across browser restarts).

## Future Upgrade

If Rowta deploys a full production web application beyond the current preview and static legal pages, the planned architectural upgrade is server-set `HttpOnly`, `SameSite=Strict`, `Secure` cookies with CSRF tokens for authentication, removing script access to tokens entirely.

## References

- ADR 0007: Refresh rotation and family revocation on reuse.
- ADR 0013: Web tokens memory-only (superseded by this record).
- Rules: A11 (tokens in secure store on native), S1 (never log/leak tokens), S5 (server authority).

