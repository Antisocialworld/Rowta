---
trigger: always_on
description: "Validation rules (V1 to V8): Zod on client and server, shared schemas"
---

# Rowta rules: Validation

Part of the binding Rowta rule set in `.agents/rules/`. Every rule has an ID; audits and reports cite the ID.
MUST and NEVER are absolute. [DECISION] = a choice made here that the owner can change. [VERIFY] = check against current official
documentation and cite the page. [OPEN] = waiting for the owner. Full legend: `00-core-process.md`.

---------------------------------------------------------------------------------------------------

## V. Validation

V1. **Zod on every form, request body, query string and route parameter.** Schemas are written ONCE in `/shared`
    and imported by both the app and the server. Duplicated schemas are a defect.
V2. **Two layers, both mandatory.** The client validates for speed and kindness. The server validates for
    authority and NEVER assumes the client did. A test sends invalid data directly to the server and expects
    rejection for every form.
V3. **Strict shapes.** Use strict objects; reject unknown keys. Return 422 for validation failures, 400 for
    malformed requests, with field-level codes (not raw Zod messages).
V4. **Normalise in the schema**: email is trimmed and lower-cased with a transform; IANA time zones are checked
    against the runtime's supported list; dates are ISO 8601 with an offset; shift `ends_at` is after `starts_at`.
V5. **The client maps error codes to catalog messages** (U8). NEVER show raw server or Zod text to a user.
V6. **Form behaviour**: validate on blur, then on change after the first error. The submit button of the sign-up,
    sign-in, reset-password and code forms is NOT READY until the form is valid (X14): it never gets the native
    `disabled` attribute (that hides the reason from assistive technology and removes it from the focus order); it
    uses the not-ready pattern in X14 and always shows why. Block double submits while a request is pending; keep the
    user's input after an error (except the password after a failed sign-in); on submit with errors, move focus to
    the first invalid field and announce the error summary (X3, U7).
V7. **Sign-in form** checks only that email looks like an email and the password is not empty (A8).
V8. **Display name** (`displayName`, shared schema): NFKC-normalised, trimmed, 1 to 60 characters, no control characters or
    line breaks; letters, marks, numbers, spaces, apostrophes and hyphens are allowed. It is never an identifier and
    never used for permission. It is HTML-escaped in HTML, stripped of line breaks in plain text, and NEVER placed in
    an email subject, a log line or a copied-into-activity text (store the user ID and join the name when showing).
