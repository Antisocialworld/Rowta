---
trigger: always_on
description: "Authentication, hashing and credential rules (A1 to A13) that apply to every task"
---

# Rowta rules: Authentication and credentials

Part of the binding Rowta rule set in `.agents/rules/`. Every rule has an ID; audits and reports cite the ID.
MUST and NEVER are absolute. [DECISION] = a choice made here that the owner can change. [VERIFY] = check against current official
documentation and cite the page. [OPEN] = waiting for the owner. Full legend: `00-core-process.md`.

---------------------------------------------------------------------------------------------------

## A. Authentication and credentials

A1. **Argon2id for all password hashing.** NEVER bcrypt, scrypt, PBKDF2 or any plain hash for passwords.
    Parameters: at or above OWASP's minimum of 19 MiB memory, 2 iterations, 1 degree of parallelism
    (m=19456, t=2, p=1). Measure on the deploy target, record the choice in an ADR, and keep the parameters in one
    config file. Store the full PHC-format string. Re-hash on successful login when parameters have changed.
    Library choice [VERIFY]: a maintained Node Argon2 binding that runs hashing off the event loop. Each hash uses about 19 MiB, so cap concurrent hash operations (a small semaphore sized to available memory) so a burst of sign-ins cannot exhaust memory; the rate limits in A7 sit in front of it.
A2. **Verification codes, magic codes, reset codes and any other short secret are also hashed with Argon2id.**
    They have little randomness, so a fast hash would be brute-forced in seconds if the table leaked.
A3. **Long random tokens** (refresh token, invite token, magic link token, reset link token) use the
    selector-and-verifier pattern. The token is `<selector>.<verifier>`. The selector (random, unique, indexed)
    finds the row. The verifier (at least 256 bits from the system CSPRNG) is hashed with Argon2id and compared
    with the library's verify function. Only the selector and the hash are stored. The raw token appears only in the
    email or response that delivers it.
A4. **Banned algorithms.** SHA-256 in ANY form is banned in code, config, scripts and documentation: plain
    SHA-256, HMAC-SHA-256, JWT `HS256`, `RS256`, `ES256`, `PS256`, the strings `sha256` and `sha-256`. Also banned:
    MD5, SHA-1, bcrypt for new code. Allowed choices:
    - passwords and low-entropy secrets: Argon2id (A1, A2);
    - token verifiers: Argon2id (A3);
    - access token signing: JWT with `HS512`, algorithm pinned, `none` and every other algorithm rejected [DECISION];
    - non-secret fingerprints, shard routing and rate-limit keys (request-body fingerprint for idempotency, shard hash, hashed
      identifiers in Redis keys): `blake2b512` (confirmed available in the Node version used for planning).
    **The only exceptions** (record an ADR, confine to one file each, comment the reason):
    E1. Verifying a payment provider's webhook signature, because the provider dictates the algorithm.
        All such code lives in `server/src/billing/webhook-signature.ts` and nowhere else.
    E2. Things this codebase does not choose: TLS, package-registry integrity checks, git itself, build tooling.
    A grep gate (skill `rowta-gate-checks` (section 5)) fails the gate if the banned strings appear outside the exception file. Documentation may name an algorithm only to state this policy or an exception.
A5. **Never say which half of a login was wrong.** A failed sign-in, for ANY cause (unknown email, wrong
    password, including a wrong password on an account pending deletion; rate limiting is separate, see A7), returns the same HTTP status, the same
    body shape and the same message: **"Invalid email or password."** NEVER write "incorrect password",
    "wrong password", "incorrect email", "email not found", "no account", "user not found", "account does not
    exist", "email already registered", "email already in use", "already exists" or any phrase with the same
    effect, in the app, the server, logs shown to users, emails or docs.
    Only after a CORRECT password on an account pending deletion may the app offer "Restore account" (PRD 8.10); a wrong
    password there gets the same generic failure.
A6. **Uniform responses on every account-revealing route.** Sign-up, forgot password, magic link request, resend
    code, and invite acceptance MUST give the same visible result whether or not the email has an account:
    - sign-up: "Check your email for a code to finish creating your account." If the email already has an
      account, send that person an email saying a sign-up was attempted; change nothing.
    - forgot password: "If that email is registered, we have sent instructions to it."
    - magic link request: same pattern.
    - code or token problems: "Invalid or expired code." / "This link is invalid or has expired."
    - inviting someone: the inviter always sees "Invitation sent." whether or not that email already has an account.
    The full catalog of strings is PRD section 11. Strings live in one catalog file (U8).
A7. **Timing.** When the email is unknown, still run a dummy Argon2id verify against a real PHC hash so the two
    paths cost about the same. Record a measurement (50 runs each, median) in `docs/SECURITY.md`; this is a
    documented measurement, not a flaky assertion. Rate-limit responses ("Too many attempts. Try again in a few
    minutes.") are keyed by IP and by hashed normalized email whether or not the account exists, so the limit
    cannot be used to discover accounts.
A8. **Password policy**: minimum **8** characters (owner rule). Maximum 128 so a giant input cannot be used
    to burn CPU [DECISION]. No composition rules (no "must contain a symbol"). Allow every Unicode character and
    spaces. NEVER trim, truncate or silently alter the password. Unicode-normalise (NFKC) before hashing
    [DECISION]. Policy messages appear only on sign-up, reset and change-password, NEVER on the sign-in form.
A9. **Verification code rules**: 6 digits from the CSPRNG (`crypto.randomInt`), valid **5 minutes** (owner
    rule, for EVERY 6-digit code: sign-up and reset), at most 5 wrong attempts then the code is dead, single use, a new
    code invalidates the old one, resend cooldown **60 seconds** on every code request. Hashed per A2. Compared with
    the Argon2 verify function. The two numbers are constants in `/shared` (`CODE_TTL_SECONDS` = 300,
    `RESEND_COOLDOWN_SECONDS` = 60) used by the server, the email text and the app, so they cannot drift. The code
    screen states the lifetime and shows a resend countdown; the server sends remaining SECONDS (not a clock time)
    and decides expiry. Every code email states the 5-minute lifetime. Subjects never contain the code.
A10. **Forgot password guides the user back in; it never reveals the old password.** Passwords are stored as
     one-way hashes and cannot be shown. The flow is: enter email, receive a code or link, set a new password with a
     live checklist of the rules, then return to sign-in with the email prefilled. Reset tokens and codes are single
     use; reset codes expire in 5 minutes like every code (A9). A verified code yields a grant valid for 10 minutes [DECISION] that the new password must present. A successful reset revokes every refresh token for that user.
A11. **Sessions**: access token 15 minutes, refresh token 30 days [DECISION]. Refresh rotates on every use. A
     refresh token that was already used revokes its whole family and forces re-login. Tokens live in
     `expo-secure-store`, NEVER AsyncStorage. "Log out of all devices" revokes all refresh tokens and deletes the
     user's push tokens. State plainly that an access token already issued works until it expires. The app refreshes single-flight (one refresh at a time per device; other requests wait for it). A refresh response lost in transit would look like token reuse; decide in an ADR between accepting a forced re-login and a short same-device tolerance window.
A12. **Autofill and password managers.** Password inputs set the platform autofill hints
     (`autoComplete` and `textContentType`: `username`, `password`, `new-password`, `one-time-code` as
     appropriate) and `importantForAutofill` [VERIFY current React Native props]. NEVER block paste. Provide a
     show/hide toggle with an accessible name and state.
A13. **Magic link** is the second sign-in method [DECISION]. Link token follows A3, expires in 15 minutes,
     single use. The email carries an https link with the token in the URL FRAGMENT; the token is consumed only by a
     button the user presses (a POST), never by a GET, because email scanners open links (PRD 8.1). `rowta://` is a
     fallback only. Every email (codes, links, invites) is sent with nodemailer over SMTP from a background job (C2);
     SMTP settings come only from env names. In development the target is the local mail catcher.
