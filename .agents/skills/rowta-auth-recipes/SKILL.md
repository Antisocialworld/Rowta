---
name: rowta-auth-recipes
description: "Use when building or changing Rowta authentication on the server or app: the Argon2id hashing module, selector.verifier tokens, 6-digit codes, the sign-in handler, shared Zod auth schemas and forms, the AuthGate view state machine, access tokens, refresh rotation with reuse detection, sign-up with code, forgot and reset password, and magic link."
---

# rowta-auth-recipes

Part of the Rowta method (Recipes 3.1 to 3.6, and 3.16 to 3.20 added later). Numbering is kept from the original method so cross-references still resolve: see the table in `AGENTS.md`.
Code here is a PATTERN: check every library call against current documentation [VERIFY] before using it, and never paste real secrets (rule S1).

### 3.1 Argon2id hashing module (A1, A2, C6)
One module `server/src/security/argon2.ts` exposes `hashSecret`, `verifySecret`, `needsRehash`. Parameters come from one
config file (memory, iterations, parallelism at or above m=19456, t=2, p=1). Use the library's ASYNC API. Store the
full PHC string. At boot, create `DUMMY_PHC_HASH` by hashing random bytes (never stored, never logged); it is used by
the sign-in path when the user does not exist. Nothing else in the codebase imports a hashing library directly.

### 3.2 Selector.verifier tokens (A3)
```
create():  selector = randomUrlSafe(16 bytes); verifier = randomUrlSafe(32 bytes)
           store { selector, verifierHash: hashSecret(verifier), expiresAt, ... }
           return `${selector}.${verifier}`          // only place the raw token exists
verify(t): [selector, verifier] = split(t)            // reject malformed with the generic "invalid link" error
           row = findBySelector(selector)             // not found, expired, used, revoked -> same generic error
           ok  = await verifySecret(row?.verifierHash ?? DUMMY_PHC_HASH, verifier)
           if (!row || !ok || expired || used) throw invalidLink()
           mark used inside the same transaction as the effect it unlocks (C3)
```

### 3.3 Six-digit codes (A9)
Generate with the CSPRNG integer function, left-pad to 6 digits, hash with `hashSecret`, store `attempts = 0`. On verify:
increment attempts in the same statement that reads the row (atomic), reject at 5, compare with `verifySecret`, mark
consumed in the same transaction as the effect. Response for any failure: "Invalid or expired code."

### 3.4 Sign-in handler (A5, A6, A7, V7)
```
signIn(input):
  { email, password } = signInSchema.parse(input)         // format and non-empty only
  rateLimit(ip) and rateLimit(blake2b512(email))           // same 429 message whether or not the account exists
  user = findUserByEmail(email)                            // not-found is NOT an early return
  ok   = verifySecret(user?.passwordHash ?? DUMMY_PHC_HASH, normaliseNfkc(password))
  if (!user || !ok)                         -> throw authFailed()   // status, body shape and message identical
  if (user.status === 'pending_deletion')   -> offer "Restore account" only AFTER a correct password
  if (!user.emailVerifiedAt)                -> send a new code; respond with the "check your email" prompt
  issue access token (HS512, 15 min, no role) + refresh token (3.2, same family on rotation)
```

### 3.5 Shared Zod schema and form view (V1 to V6, U7, X1 to X3)
```
/shared/src/auth.ts       export const signUpSchema = z.strictObject({ email: emailField, password: z.string().min(8).max(128), ... })
app:    useForm({ resolver: zodResolver(signUpSchema), mode: 'onBlur', reValidateMode: 'onChange' })   [VERIFY form library]
server: const body = signUpSchema.safeParse(await req.json()); if (!body.success) return error(422, fieldCodes(body.error))
```
Checklist for every form view: labelled inputs; the 6-digit code is ONE input with the one-time-code autofill hint, not six separate boxes (screen readers handle one field far better); `autoComplete` and `textContentType` hints (A12); first input focused on
mount; the submit button follows the not-ready pattern (section 3.22, X14); double-submit blocked while pending; busy state exposed to assistive technology; on
errors focus the first invalid field and announce the summary; messages come from the catalog; no raw server text.

### 3.6 AuthGate view state machine (U1, U2)
One reducer: `state = { view, email?, token?, history[] }`; actions `goto(view)`, `back()`, `fromDeepLink(kind, token)`.
Views render conditionally from `state.view`. Changing view: update the screen title, move accessibility focus to the
heading or first input, announce the new view. Android back calls `back()`; at the first view it exits the app. The root
shows a neutral splash until the secure-store read finishes, then `AuthGate` or the signed-in app. No route file per view.

### 3.16 Access token (A4, A11, S8)
HS512, algorithm pinned: the verify call lists ONLY `HS512` as allowed, so `none` and every other algorithm are rejected [VERIFY the JWT library's option name]. Claims: subject (user ID), issued-at, expiry 15 minutes, a token ID. NO role and NO team role (S8). At boot, fail fast if the signing secret is missing or shorter than 64 bytes; never log it. Tests: a token signed with another algorithm, an expired token, a tampered token and a token with `none` are all rejected with the generic 401.

### 3.17 Refresh rotation with reuse detection (A11, 8.1)
```
refresh(token):
  [selector, verifier] = split(token)               // malformed -> generic 401
  row = findBySelector(selector)
  ok  = verifySecret(row?.verifierHash ?? DUMMY_PHC_HASH, verifier)
  if (!row || !ok || expired || revoked) -> generic 401
  if (row.usedAt)  -> revoke the whole family (family_id), delete nothing else, generic 401   // reuse detected
  in ONE transaction: mark row used (UPDATE ... WHERE used_at IS NULL, check rows = 1) and insert a child
    { family_id, parent_id: row.id, device_id } with a new selector.verifier; return the new pair
```
The `WHERE used_at IS NULL` update is the race guard (C3): two simultaneous refreshes of one token cannot both win. Client: single-flight (one refresh per device; other requests wait, A11). A refresh response lost in transit looks like reuse: record the ADR choice (forced re-login or a short same-device tolerance window). Log out = revoke this family; log out of all devices = revoke all the user's tokens AND delete their devices (push tokens). Test: replay an old token, then the newest token of that family must also fail.

### 3.18 Sign-up with code (8.1, A6, A9)
1. `signUp` validates (shared schema), rate-limits, then upserts `pending_signups` for the email with the validated `displayName`, the Argon2id password hash and a NEW hashed 6-digit code (a new code kills the old one), attempts = 0.
2. If the email already has an account, do NOT create a pending row: enqueue the "someone tried to sign up" email instead. The HTTP response and its timing are identical in both cases.
3. Enqueue the email job (C2). The response is always the catalog message "Check your email for a code to finish creating your account."
4. `verifyCode`: atomically increment attempts and read the row; at 5 the row is dead; verify with `verifySecret`; in one transaction create the `users` row (copying `displayName`) (email UNIQUE; if a unique violation happens, return the same generic "Invalid or expired code." and do not reveal why), delete the pending row, issue tokens.
Resend: 60-second cooldown (`RESEND_COOLDOWN_SECONDS`), same uniform answer. The code lives 5 minutes (`CODE_TTL_SECONDS`, rule A9); the response to the app carries `expiresInSeconds` and `resendInSeconds` (remaining seconds, never a clock time) so the code screen can show the lifetime and the resend countdown without trusting the phone clock. A resend restarts both timers. The welcome email is enqueued once, only after the account row is created (see `rowta-notifications-email-recipes` section 7).

### 3.19 Forgot and reset (A10)
1. `forgot`: rate-limit, then ALWAYS answer with the catalog message. Only if the user exists: create a `password_resets` row (hashed 6-digit code, 5 minutes, 5 attempts, resend cooldown 60 seconds) and enqueue the email job. If not, do the same amount of work (dummy hash) and nothing else.
2. `resetCode`: verify the code (atomic attempts) and return a GRANT (selector.verifier, 10 minutes, stored hashed on the same row).
3. `resetNewPassword`: requires a valid grant; validate the new password (8 to 128, NFKC); in one transaction hash with Argon2id, update the user, consume the reset row, revoke every refresh token of the user. Respond with success; the app returns to `signIn` with the email prefilled and shows "Password updated. Sign in with your new password."
Never show or return the old password. Tests: grant single use, grant expiry, code attempts, all sessions revoked.

### 3.20 Magic link (A13, PRD 8.1)
Decision (owner, 18 Oct 2026): the best link is a verified https link with the token in the URL FRAGMENT, not `rowta://`. Reasons: email apps often do not make custom schemes tappable; another app can claim a custom scheme; a fragment is not sent to servers, so the token stays out of host access logs and Referer headers; email security scanners open links and can use up a single-use token, so the token is consumed ONLY by a button the user presses.
1. Request: rate-limit (`rowta-rate-limiting-recipes`), uniform answer, token per A3 valid 15 minutes and single use, email via job. The email link is `PUBLIC_WEB_URL` + `/magic#` + `selector.verifier`.
2. Open: Android App Links open the app on `/magic` (the `assetlinks.json` and intent filter cover the path `/magic`, `rowta-web-metadata`); otherwise the web page opens. Either shows the view `magicConfirm`: heading "Sign in to Rowta" and ONE button "Sign in" (catalog `auth.magic.*`). Reading the link NEVER calls the server; the page and the app read the fragment locally and remove it from the address and history (`history.replaceState` on the web).
3. Consume: only the button sends a POST with the token. The server looks up by selector, verifies the verifier with `verifySecret`, marks consumed and issues tokens in ONE transaction; any failure gives "This link is invalid or has expired."
4. [VERIFY] with `adb shell am start -a android.intent.action.VIEW -d "<https link with #fragment>"` that the app receives the fragment. If it does not, switch to the path form `/magic/<selector.verifier>` (same button rule; a GET of the page still consumes nothing) and record the reason in an ADR.
5. `rowta://magic/<token>` remains only behind the web page's "Open in the app" button.
Tests: a plain GET of the page consumes nothing; two POSTs with one token, only one wins; scanner simulation (fetch the URL, no click) leaves the token usable; expiry at 15 minutes; the fragment is removed from the address after reading.

### 3.21 Display name (V8, PRD 8.1)
`displayNameSchema` in `/shared`: NFKC-normalise, trim, 1 to 60 characters, no control characters or line breaks. The sign-up form has a Name field (autofill hint `name`, first input focused on the view). `signUp` stores it on `pending_signups`; `verifyCode` copies it to `users` in the same transaction. The account screen edits it (rate-limited like other writes). Teammates see the name, never the email. The email job loads `display_name` by user ID at send time and builds the greeting: "Hi <name>," or "Hi," if empty. Tests: 61 characters rejected, line break rejected, name with markup is escaped in the HTML part and stripped of line breaks in the text part, the name never appears in a subject or a log line.

### 3.22 Not-ready buttons (X14, V6, V7, A6)
```
readiness (pure functions in /shared, used by the app and by tests; the server re-validates, S1):
  signUp:   displayName valid (V8) && email format ok && country chosen from the list && password rules ok && confirm === password
  signIn:   email format ok && password.length > 0            (V7: no strength check)
  forgot:   email format ok
  resetNew: password rules ok && confirm === password
  code:     /^\d{6}$/   (resend is a separate control with its own countdown, A9)
button:   ready=false -> aria-disabled / accessibilityState.disabled, dimmed, STILL focusable, reason text below it
press:    ready=false -> send nothing; focus first invalid field; announce the reason (polite)
          ready=true  -> busy state, ignore repeat taps, announce the result
reason:   catalog keys auth.ready.* (PRD 11), format wording only, never "already registered" or "no such account"
```
Mistakes: using `disabled`; a reason that depends on the server's answer about the account; an icon button with no name; an `aria-label` that differs from the visible text; announcing the reason on every keystroke (announce on blur and on press).
