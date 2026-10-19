---
name: rowta-app-ui-recipes
description: "Use when building Rowta app UI: design tokens generated from the owner's design system (light theme; dark waits for Q9), the component kit, the message catalog, state placement between TanStack Query, Zustand and secure storage, lists with FlashList and infinite scroll, focus and announcement helpers, reduce-motion, haptics, the size-matrix screenshots and the logo and icon pipeline."
---

# rowta-app-ui-recipes

Part of the Rowta method. Scope: PRD 6, 10; rules U1 to U11, X1 to X8, C7, C11. Library calls are [VERIFY].
Code here is a PATTERN: check every library call against current documentation [VERIFY] before using it, and never paste real secrets (rule S1).

## 1. Tokens (U5)
`app/src/theme/tokens.ts` defines colour, type scale, spacing, shadows and motion durations ONCE, GENERATED from the owner's `design-system/design-variables.css` (U11): run `node scripts/build-app-tokens.mjs`; never edit the output by hand and never change a colour. The system has a light colour set only; a dark set is OPEN (Q9). Components import tokens only. A script lists hard-coded colours and stray pixel numbers in `app/src/components` and `app/src/screens`; the gate requires zero (gate 7 in `rowta-gate-checks`). Write the ADR that records how the design system is applied and wait for the owner's review before building screens (U6, U11).

## 2. Component contract
Button (variants, loading), Text, Input (label, hint, error, show/hide for passwords), Card, ShiftCard, Avatar, Chip, Badge, Toast, Skeleton, EmptyState, BottomSheet, ConfirmDialog. Each documents variants, states and props, takes strings from the catalog, and sets accessibility name, role and state from the SAME state as the visuals (X1, X2). Touch targets 44 by 44 (X6). Never disable a submit button to express invalid input (V6).

## 3. Strings (U8)
Everything user-visible comes from `app/src/i18n/en.ts` keyed as in PRD 11; server error codes map to catalog keys (V5). No raw server or Zod text reaches a screen.

## 4. State placement (U4)
| Data | Home | Why |
|---|---|---|
| Server data (shifts, roster, feed, swaps) | TanStack Query | cache, dedupe, refetch, optimistic updates |
| Client-only (theme choice, AuthGate machine, UI flags) | Zustand | no server truth |
| Tokens | expo-secure-store | never plain storage (A11) |
| Upcoming shifts for offline | query-cache persister | cleared at log out (8.9) |
Explain each cache time in `docs/STATE.md`. Optimistic mutations follow recipe 3.7 in `rowta-data-recipes`.

## 5. Lists (U10, PRD 8.3)
FlashList with an infinite query using the opaque cursor; pull to refresh; skeleton on first load; designed empty, error and end-of-list states; guard against duplicate fetches while one is in flight and show the request log proving it. Cancel requests on unmount with the abort signal (C5, C11).

## 6. Focus, announcements, motion
Small helpers in `app/src/lib/a11y.ts`: `focusOn(ref)`, `announce(message, politeness)`, `useReducedMotion()`. Use them on every view change and error summary (U7, X3). Reanimated motion respects reduce-motion; nothing flashes more than 3 times a second (X8). Haptics only on key actions: publish shift, request swap, confirm payment [VERIFY library].

## 7. Size matrix evidence (U9, PRD 6.3)
A harness opens each screen at the matrix sizes and text scales (320x568 up to tablet, landscape, 100/130/200 percent) and saves `docs/ui-matrix/<screen>-<case>.png` [VERIFY emulator setup]. Layout rules: no fixed widths, safe-area insets, keyboard never hides the active field, content scrolls, no horizontal scroll.

## 8. Logo and icon pipeline (PRD 10)
Placeholder mark at `web/public/brand/logo.svg`; ONE script builds favicon (ICO and SVG), Apple touch icon, 192 and 512 PNG, 1200x630 share image, and the Expo app icon and Android adaptive icon. `docs/BRANDING.md` explains how the owner swaps `logo.svg` and re-runs it. Do not imitate any existing brand.

## 9. Mistakes to avoid
A magic number or hex colour in a component; a second copy of a Zod schema; a spinner where a skeleton belongs; an icon button with no accessible name; storing tokens in plain storage; copying the web approach to separate "pages" for auth views.

## 10. Code screen (rule A9, PRD 8.1)
Texts come from the catalog keys `auth.code.*` (PRD section 11). Layout: heading, hint with the email, "The code expires in 5 minutes.", the six-digit input (autofill hint `one-time-code`), submit, then the resend control. Resend control: disabled with the text "Send a new code in 0:42" until the server's `resendInSeconds` reaches 0, then enabled as "Send a new code". Compute the countdown from the seconds the server returned, not from the phone clock; a resend restarts it. On expiry show `auth.code.expired` and focus the resend control. Accessibility: do NOT announce every second; announce `auth.code.resendWait` once when the screen opens and `auth.code.resendReady` once when it becomes available, through a polite live region; the disabled state is conveyed by text and accessibility state, not colour alone.

## 11. Buttons (X14)
One `Button` component owns all states: ready, not ready (dimmed, focusable, reason linked), pressed, focused, busy. Props: `ready`, `reason` (catalog key), `busy`, `onPress`. A not-ready press calls `onNotReady` (focus the first invalid field, announce the reason) and never `onPress`. Icon-only buttons require a `label` prop (TypeScript makes it mandatory); a button with text must not take a different label. Size at least 44 by 44 points (X6). Test: render each auth form with bad input and assert the button is not ready, the reason text is present, a press sends no request, focus moved, and the announcement fired.

## 12. Design system integration (U11)
Source files: `design-system/convertTokens.js`, `design-tokens.token.json`, `design-tokens.tokens.json`, `design-tokens.tokenss.json`, `design-variables.css`. They are the owner's and are copied byte for byte (record a `blake2b512` digest of each in `docs/decisions/` before and after the move (banned algorithms: A4); they must match). Facts checked on 18 Oct 2026 (not in the app yet): roles follow Material 3 naming (`--color-primary`, `--color-on-primary`, containers, surface set, outline); font is Poppins; type styles are `--font-<style>-<property>` (display, headline, title, body, label sizes); spacing is `--spacing-*` from 0.25rem to 2rem (multiples of 4px); shadows `--shadow-hard-shadow`, `--shadow-medium`, `--shadow-soft` are CSS strings and need a mapping to React Native shadow props; colours are 8-digit hex (`#rrggbbaa`) [VERIFY React Native reads the alpha-last form]. `scripts/build-app-tokens.mjs` parses the CSS read-only, resolves `var(--x)` references, writes `tokens.ts`, and fails if a value is unresolved. Test: every `--color-*` in the CSS appears in `tokens.ts` with the same value.
Contrast report (computed from the CSS on 18 Oct 2026, WCAG contrast ratio, not alterable here): most role pairs pass; `on-tertiary-container` on `tertiary-container` is 1.86 to 1 and FAILS (needs 4.5 for text); `outline-variant` on `surface` is 1.54 to 1, acceptable for decoration only, never for a control border (use `outline`, 3.78). Do not use the failing pair for text until the owner decides.
Gap closed (18 Oct 2026, Q10 decided by the owner): `design-variables.css` now contains the four tokens it used to lack, plus warning and success roles and ramps, the remaining Material 3 roles, `--shape-corner-*` and `--state-*` (hover 0.08, focus 0.10, pressed 0.10, dragged 0.16, disabled container 0.12, disabled content 0.38). A Toast uses `--color-inverse-surface` with `--color-inverse-on-surface`. Errors use `--color-error*`, warnings `--color-warning*`, success `--color-success*`; there is no info colour (use primary or secondary roles). Never hand-write a colour and never edit the converter, the JSON or the CSS; run `node design-system/verifyTokens.js` (must print 0 errors). Dimmed not-ready buttons (X14) use `--state-disabled-content` and `--state-disabled-container` as opacities. Tokens marked `Material 3 addition` in the CSS await the owner's final approval of the warning and success source colours (Q11). Other data oddities to report, not fix: `neutral-20` is #000000 (same as `neutral-0`) and `secondary-60` is a pink (#c062d0) inside a blue ramp.
