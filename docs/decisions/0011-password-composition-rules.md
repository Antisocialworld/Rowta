# 0011. Password composition rules (owner decision 24 Oct 2026)

Date: 2026-10-24. Status: accepted.
Phases affected: Phase 2 (auth), rules A8, V1, V2, V6, V7, X14.

## Context

Prior to 24 Oct 2026, Rowta followed NIST SP 800-63B guidance via Rule A8: minimum 8 characters, maximum 128 characters, with "no composition rules (no 'must contain a symbol')".

On 24 Oct 2026, the project owner decided that password creation and reset must enforce explicit composition rules to ensure complexity across user accounts, while retaining Unicode support and accessibility standards.

## Decision

The shared validation schemas (`signUpSchema` and `resetNewPasswordSchema` in `@rowta/shared`) and client auth views enforce four composition rules in fixed display order:

1. **Minimum of 8 characters** (max 128 characters)
2. **Password must contain an uppercase letter** (Unicode `\p{Lu}`)
3. **Password must contain a lowercase letter** (Unicode `\p{Ll}`)
4. **Password must contain a number or a special character** (`#@>^%*+=$&`): numbers via Unicode `\p{Nd}` or special characters via `PASSWORD_SPECIAL_REGEX = /[^\p{L}\p{Nd}\s]/u`.

### Unicode Awareness

All regex matches use the `u` flag and Unicode property escapes:
- `\p{Lu}` matches all uppercase letters across alphabets (e.g., Latin, Greek, Cyrillic).
- `\p{Ll}` matches all lowercase letters across alphabets.
- `\p{Nd}` matches all decimal digits across scripts.
- `[^\p{L}\p{Nd}\s]` matches any punctuation or symbol character that is not a letter, digit, or whitespace, supporting both ASCII symbols (`#@>^%*+=$&`) and Unicode symbols.
- Passwords continue to be NFKC-normalised before validation and Argon2id hashing.

### User Interface and Live Checklist

Both `createAccount` (`SignUpView`) and `resetNewPassword` (`ResetNewPasswordView`) display the live checklist component (`PasswordRulesChecklist`). Each of the four rules:
- Displays an icon (green checkmark for met, neutral circle for pending/not met) alongside clear text.
- Provides accessible role (`checkbox`), state (`aria-checked`), and polite live announcements (`auth.rule.met` / `auth.rule.notMet`).
- Adheres to X14: submit buttons (`Create account` and `Update password`) remain focusable, aria-disabled with catalog reason text until all composition rules pass.

### Sign-in Unchanged (V7 / A8)

`signInSchema` is deliberately left unchanged (`emailField` + non-empty password). The sign-in form does not check composition, and pre-existing accounts with passwords created prior to this rule change can sign in without interruption.

### Known Consequence

A long multi-word passphrase consisting entirely of lowercase letters (such as `correct-horse-battery-staple-passphrase`), despite possessing high entropy, will be rejected by rules 2 and 4. This is accepted as a direct and intended consequence of enforcing character-class composition.

## Rule and Specification Updates

The following four files were updated to reflect this decision:
1. `.agents/rules/02-auth-credentials.md` (Rule A8)
2. `.agents/PRD/PRD-001-rowta.md` (Section 8.1)
3. `AGENTS.md` (Rule 6)
4. `docs/AGENT-PROMPT.md` (Hard rule 6)
