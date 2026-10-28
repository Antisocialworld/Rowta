# 0013. Web build keeps tokens in memory only

Date: 2026-10-27. Status: accepted (agent decision; owner has seen the reload sign-out and accepted it for this surface). Phase 2 app preview / Phase 11 web surface.

## Problem

Rule A11 requires both tokens to live in `expo-secure-store` on native and never in AsyncStorage. The
web build has no equivalent secure store: `app/src/lib/token-platform.ts` chooses the in-memory backend
when `Platform.OS === "web"` (`createTokenStore(Platform.OS === 'web' ? memoryBackend() : secureBackend())`,
line 20). The consequence is that a browser reload returns the user to the signed-out state. The owner
observed this on 27 Oct 2026 on `localhost:8081` and confirmed it is intentional.

The PRD does not specify web token storage. A search of the PRD for `localStorage`, `sessionStorage`,
`cookie` and token-storage wording returns no web answer; the only storage statement is native
`expo-secure-store` (PRD 8.1, line 273). This ADR is therefore an agent decision, not a PRD requirement.

## Options (with costs)

1. **Memory only (chosen).** Tokens live in the module's `Map` for the lifetime of the page. Cost: a
   reload or a new tab signs the user out; E2E and screenshot runs must not reload mid-session. Benefit:
   tokens never touch script-readable storage, no server work, no new dependency, nothing to clear on
   logout beyond the in-memory store.
2. **`sessionStorage`.** Cost: any script on the origin can read the tokens (XSS steals them); the
   session is still lost when the tab closes and is absent in a new tab; it is an unencrypted browser
   store and conflicts with the spirit of A11. Benefit: survives a reload in the same tab.
3. **`localStorage`.** Cost: the same script-readable XSS exposure, but the stolen tokens persist across
   reloads and browser restarts; logout must explicitly clear them; there is no secure-store protection.
   Benefit: survives reloads and new tabs.
4. **HttpOnly cookie set by the server.** Cost: real server work — `Set-Cookie`, `SameSite`, CSRF
   protection, CORS with credentials, a refresh flow that no longer sends the refresh token in a JSON
   body, and a cookie/CSRF test suite. Benefit: JavaScript cannot read the token. It is the right
   direction if an authenticated deployed web app is ever required, but it changes the current
   bearer-token architecture and is not justified for a static public preview.

## Choice

Option 1: memory only on web. Native keeps `expo-secure-store`; the web build uses
`memoryBackend()` from `app/src/lib/token-store.ts`, which is explicitly "a backend that never
persists" (line 25). Nothing uses AsyncStorage. The web surface stays a preview that is signed out after
a reload, as observed by the owner.

## Why

- A11 forbids AsyncStorage because it is unencrypted; `sessionStorage` and `localStorage` have the same
  class of exposure, so choosing them would evade the rule rather than satisfy it.
- Memory-only tokens leave no persistent browser store for a later script or a reload to read; browser
  storage does. An XSS that runs inside the live page can still act as the user while the page is open,
  so this is not an XSS cure; it removes the persisted copy and the reload/new-tab exposure.
- The deployed web surface defined so far is static public HTML with no authenticated app and no
  cookies or storage (ADR 0006). A memory-only preview fits that design and needs no server change.
- The cost is a reload signing the user out, which the owner has seen and accepted for this surface.

## What would change it

Phase 11 defines an authenticated deployed web surface, or the owner asks for web sessions to survive a
reload. Then revisit with a security review: an HttpOnly cookie set by the server (with `SameSite`,
CSRF and CORS work) is the preferred direction; a future secure browser storage API would also need to
meet A11. A PRD or A11 change that covers web token storage would supersede this ADR.

## More information

- `app/src/lib/token-store.ts` — header lines 1–9 and `memoryBackend()` at line 26.
- `app/src/lib/token-platform.ts` line 20 — the `Platform.OS === 'web'` switch.
- `docs/decisions/0006-web-static-pre-render.md` — the public web surface is static and stores nothing.
- `.agents/rules/02-auth-credentials.md` A11 lines 80–83 — native secure store, never AsyncStorage.
- Owner observation: browser reload on `localhost:8081`, 27 Oct 2026.
