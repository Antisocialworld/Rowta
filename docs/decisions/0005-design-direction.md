# 0005. Design direction — how the owner's design system is applied in the app

Date: 2026-10-19 · Status: **ACCEPTED — the owner approved Direction A (card-first comfortable), with the two
type-scale borrowings from B named in "Choice", on 19 Oct 2026** (U6, PRD 6.2: "The agent proposes; it does not
impose") · Phase 1, part A step 4 / part B

## Problem

The design system (`design-system/`, generated into `app/src/theme/tokens.ts`) fixes every **value**: colours, the
17 type styles, spacing, radii, state opacities and three shadows. It does not fix **decisions** — how dense the
layout is, what shape language the cards and controls use, how the signed-in app is navigated, how motion behaves,
and how a component is composed. PRD 6.2 asks for one design-direction ADR with those decisions, presented to the
owner before screens exist. This is that ADR.

## What is fixed and cannot be chosen here (evidence: `node scripts/test-app-tokens.mjs`, 2026-10-19)

| Group | Count | Values |
|---|---|---|
| colours | 178 | `color-primary #292da3ff` (= the brand tile), `on-primary #ffffffff`, `primary-container #d6d7f5ff`, `surface #fafafaff`, `surface-container* #f0f0f0ff/#f5f5f5ff/#ebebebff/#e6e6e6ff`, `on-surface #191919ff`, `outline #808080ff`, `outline-variant #ccccccff`, `error*`, `warning*`, `success*`, `inverse-surface #333333ff` (Toast) |
| type styles | 17 | Poppins; size/line-height in px: display 62/93, 48/72, 40/60 · headline 32/48, 28/42, 24/36 · title 22/33, 16/24, 14/21 · subtitle 20/30, 18/27 · body 16/24, 14/21, 12/18 · label 14/21, 12/18, 11/16. Weight 600 on `display-large` and `title-small`, 500 elsewhere (there is no `subtitle-medium`) |
| spacing | 8 | 0, 4, 8, 12, 16, 20, 24, 32 |
| shape (radii) | 7 | 0, 4, 8, 12, 16, 28, 9999 |
| state (opacity) | 6 | hover .08, focus .10, pressed .10, dragged .16, disabled container .12, disabled content .38 |
| shadows | 3 | hard `6px 5px 7px 0 #00000045`, medium `2px 4px 4px 0 #00000047`, soft `2px 2px 20px 0 #0000001f` (CSS strings; mapped to React Native shadow props in the component step) |

Light theme only ([OPEN] Q9). Warning/success await [OPEN] Q11. Two contrast pairs are forbidden for text:
`on-tertiary-container` on `tertiary-container` 1.86:1 and `outline-variant` on `surface` 1.54:1 (decorative only;
borders use `outline`, 3.78:1). Navigation is already constrained by U2: **native stack + tabs**.

## Options (with costs)

All three use only the values above. Nothing here changes a colour, a type size or a radius value.

### Direction A — "Card-first comfortable" (Material-like, generous, predictable)

- **Layout density:** page gutter `spacing.base` 16; section rhythm 20/24; card padding 16; gap between siblings 8
  or 12; screen titles use `headline-small` (24/36), body `body-medium` (14/21); min touch target 44 (X6).
- **Shape language:** cards and inputs on a surface `shape.medium` 12; chips and secondary controls `shape.small` 8;
  buttons and badges `shape.full` 9999 (pill, the Material 3 silhouette); avatars `shape.full`.
  Elevation: `shadows.soft` on cards, `shadows.medium` only on modal sheets/BottomSheet, none on list rows.
- **Navigation:** native stack + a 5-item bottom tab bar — Dashboard, Calendar, Swaps, Feed, More. Auth is one
  `AuthGate` screen rendered **outside** the stack when signed out (U1, U2); Android back walks the auth view machine.
- **Motion:** pressed state layer at `state.pressed` .10 over 100 ms; screen push/fade 180 ms; BottomSheet 240 ms
  spring; skeleton pulse 1200 ms replaced by a static block under reduce-motion. All Reanimated, all gated by
  `useReducedMotion()` (U6, X8). Haptics only on publish shift / request swap / confirm payment (skill §6).
- **Component anatomy:** `Card` = surface (`surface-container-lowest`) + `shape.medium` + `shadows.soft` + padding 16.
  `Input` = label **above** the field (never placeholder-as-label), border `outline`, error text + `error` colour with
  an icon (never colour alone, X1), show/hide for passwords. `Button` = one component owning ready / not-ready
  (dimmed with `state.disabledContainer` + `state.disabledContent`, focusable, reason linked) / pressed / focused /
  busy, `label-large` text (skill §11).
- **Sign-in mock (view 1 of the machine):**

  ```
  ┌──────────────────────────────────────┐
  │  [header-mark]                       │  logo-small.svg, 24dp tall
  │  Sign in                             │  headline-small
  │  Use your work email.                │  body-medium, on-surface-variant
  │  ┌────────────────────────────────┐  │
  │  │ Email                          │  │  label-medium above, outline border
  │  └────────────────────────────────┘  │
  │  ┌────────────────────────────────┐  │
  │  │ Password                  [eye] │  │  show/hide, autofill password
  │  └────────────────────────────────┘  │
  │  Forgot password?                    │  label-large, primary
  │  ┌────────────────────────────────┐  │
  │  │           Sign in              │  │  shape.full, primary, on-primary
  │  └────────────────────────────────┘  │
  │  Create account · Email me a link    │  label-large
  └──────────────────────────────────────┘   16dp gutters, content scrolls
  ```
- **Shift card mock:**

  ```
  ┌──────────────────────────────────────┐  Card: surface, radius 12, soft shadow
  │  Tue 14 Oct            [Published]   │  label-medium · Badge shape.full
  │  09:00 – 17:00                      │  title-medium, tabular feel
  │  Front desk · Main site             │  body-medium
  │  [Avatar] Amara O.   Swap  ·  Details│  44pt targets, chips shape.small
  └──────────────────────────────────────┘
  ```
- **Cost:** the least distinctive direction — personality comes from the brand tile `#292da3`, Poppins and the logo,
  not from layout. Most components and every a11y rule map directly to a well-known Material pattern.

### Direction B — "Editorial full-bleed" (big type, dividers, one hero card)

- **Layout density:** gutter 20/24 (`spacing.large`/`extraLarge`), one idea per screen block, generous vertical air;
  list rows separated by `outline-variant` hairlines instead of cards, so the screen reads like a printed schedule.
- **Shape language:** near-flat — cards and inputs `shape.extraSmall` 4, dividers carry the separation, buttons stay
  `shape.full`; exactly one elevated object per screen (the next shift) wearing `shadows.hardShadow`.
- **Navigation:** native stack + 4 tabs (Dashboard, Calendar, Feed, More) with a collapsing hero header
  (scroll-linked `display-small` → `label-large`), swap requests surfaced as a badge on Calendar instead of a tab.
- **Motion:** the header collapse is the signature; pressed layers `state.pressed` .10 at 100 ms; no page-transition
  animation beyond a 160 ms fade; skeleton pulse 1200 ms, static under reduce-motion.
- **Component anatomy:** `Card` used sparingly; `ShiftCard` is a full-bleed row with a left `primary` time column and
  a hairline divider; `Input` floats the label inside the box (Material outlined text field) — costs an extra
  announcement rule so the label is never lost to TalkBack.
- **Sign-in mock:**

  ```
  ┌──────────────────────────────────────┐
  │  [header-mark]                       │
  │  Welcome back                        │  display-small, tight leading
  │                                      │
  │  Email                               │  floating label inside the box
  │  ──────────────────────────────────  │  hairline: outline
  │  Password                      [eye] │
  │  ──────────────────────────────────  │
  │  Forgot password?                    │
  │  ┌────────────────────────────────┐  │
  │  │           Sign in              │  │  shape.full, primary
  │  └────────────────────────────────┘  │
  └──────────────────────────────────────┘   24dp gutters
  ```
- **Shift card mock:**

  ```
  ┌──────────────────────────────────────┐  only elevated card: hardShadow, radius 4
  │  09:00      Tue 14 Oct     PUBLISHED │  time in primary, badge shape.full
  │  Front desk · Main site             │  body-medium
  │  Amara O.                            │  Avatar
  └──────────────────────────────────────┘
  ────────────────────────────────────    hairline divider (outline-variant, never a border)
  ```
- **Cost:** highest a11y and layout risk — floating labels need extra announcement work, the collapsing header adds
  Reanimated surface that must honour reduce-motion, and large display type must survive 200 % text scale on
  320 × 568 (PRD 6.3). Dividers give weaker affordance than cards (mis-tap risk).

### Direction C — "Dense shift board" (compact, scannable, information-first)

- **Layout density:** gutter 12 (`spacing.medium`), row height 44–48 (never below the 44pt target), internal gaps 4/8,
  two-up stat chips on Dashboard, lists prioritised over whitespace.
- **Shape language:** everything `shape.small` 8 (cards, inputs, buttons), `shape.full` only for avatars and badges;
  `shadows.medium` reserved for the pressed/selected surface; no resting elevation on rows.
- **Navigation:** native stack + 4 tabs (Dashboard, Calendar, Swaps, Feed) with a fixed compact header and a
  segmented tab strip; More/settings live behind the avatar.
- **Motion:** short and functional — 100–140 ms opacity/height changes, no parallax; skeleton pulse 1200 ms static
  under reduce-motion; haptics on the three key actions.
- **Component anatomy:** `ShiftCard` is a tight two-line row (time + role, then site + state) with a status chip;
  `Card` padding 12; `Badge` carries state with shape + icon + text, never colour alone.
- **Sign-in mock:**

  ```
  ┌──────────────────────────────────────┐
  │  [mark]  Sign in                     │  headline-small, one line
  │  Email                               │  label-medium, 8dp box
  │  ┌────────────────────────────────┐  │
  │  │ you@example.com               │  │
  │  └────────────────────────────────┘  │
  │  Password                     [eye] │
  │  ┌────────────────────────────────┐  │
  │  │ ••••••••                       │  │
  │  └────────────────────────────────┘  │
  │  [          Sign in          ]       │  radius 8, full-width
  │  Forgot? · Create account            │  inline row
  └──────────────────────────────────────┘   12dp gutters
  ```
- **Shift card mock:**

  ```
  ┌──────────────────────────────────────┐  radius 8, no resting shadow
  │  09:00–17:00   Front desk   ● PUBL.  │  line 1: time · role · chip
  │  Tue 14 Oct · Main site   Amara O.   │  line 2: date · site · avatar
  └──────────────────────────────────────┘   44pt row, gap 4
  ```
- **Cost:** the hardest to keep correct at 200 % text scale and on 320 × 568 (PRD 6.3) — density is exactly what
  breaks first; also the plainest visually and the most likely to violate the "content that does not fit scrolls,
  never horizontally" rule if a row is over-packed.

## Choice

**Direction A — "Card-first comfortable"** as the system for every screen, with two things borrowed from B: the
`display-small`/`headline` styles are used for screen titles and the AuthGate heading (the type scale already
contains them, so this costs nothing new), and only one elevated card per screen where a hero moment is genuinely
useful (the next shift on Dashboard). Everything else — density, shape, navigation, motion, component anatomy — is A.

## Why

1. **It is the only direction that needs no new rules.** Every choice above already exists in `tokens.ts`; U2 already
   mandates native stack + tabs; X1–X14 already assume Material-like state, focus and target behaviour.
2. **It is the safest for the accessibility floor the PRD sets** (blind, deaf, speech-impaired users; 200 % text;
   320 × 568 to tablet). Cards give rows a clear boundary and a 44pt target, labels sit above fields so no
   placeholder/label ambiguity can reach TalkBack, and nothing depends on a scroll-linked animation.
3. **It keeps risk in the component kit, not in every screen.** A's anatomy is the same shape on every screen, so the
   size matrix (PRD 6.3) is checked once per component rather than re-learned per screen.
4. **Distinctiveness is already paid for** by the owner's tile colour `#292da3`, Poppins and the logo mark; B and C
   buy visual novelty with a11y and layout risk that v1 does not need.

Costs accepted: the app will look conventional; B's editorial moments are limited to type sizes the system already
has; C's density wins (more shifts per screen) are given up — mitigated by making the Calendar list scroll with an
infinite cursor query rather than shrinking rows.

## What would change it

- The owner picks Direction B or C (or a mix) — the ADR is rewritten and re-approved before any screen.
- **[OPEN] Q9** (dark colours): a second palette would add a theme layer; the shape and elevation rules above do not
  change, only which token group is read.
- **[OPEN] Q11** (warning/success source colours): affects Badge/Toast/confirm colours only.
- A decision that the tab bar must be 4 items rather than 5 (store/role limits) → A's navigation line changes.
- U9 evidence from the size matrix failing at 320 × 568 → density moves toward C's row rhythm for that screen only.
- A store review or Play policy requirement (e.g. themed/monochrome icon) → `android.adaptiveIcon.monochromeImage`
  is added (it exists in the owner's source set: `logo-mono.svg`).

## Open items and gaps for the owner (reported, not fixed here)

1. **Motion durations are not in the design system.** PRD 6.2 asks for "motion durations taken from the design
   system", but `design-variables.css` has no motion/duration variables — its 391 declarations are font 189, colour
   178, spacing 8, shape 7, state 6, shadow 3. The durations quoted in every direction above (100/160/180/240 ms,
   1200 ms skeleton) are therefore **proposals, not design-system values**; they need the owner's approval or real
   tokens before use. Nothing was invented into `tokens.ts`.
   *Owner decision 19 Oct 2026: these durations are **accepted** and live in `app/src/theme/motion.ts` — a
   non-colour file that this ADR references; `design-system/` and the colours in `tokens.ts` are untouched.*
2. **Poppins is not in the repository.** No `.ttf`/`.otf`/`.woff` file exists anywhere in the repo (glob, 2026-10-19).
   `expo-font` 58.0.9 is in the dependency tree but only as a transitive dependency — it is not declared in
   `@rowta/app`. U11(g) requires the font before first paint with a fallback to the system font, so the font files
   (plus their SIL Open Font License note) must come from the owner, and `expo-font` must then be pinned as a direct
   dependency, before the component kit step. [VERIFY licence text]
3. **Splash background is a default, not a choice.** `app/app.json` wires only `image` per `docs/BRANDING.md` §5;
   `expo-splash-screen` then applies its documented default `backgroundColor` `#ffffff`
   (`node_modules/expo-splash-screen/plugin/build/getAndroidSplashConfig.js`, default at line 26) and `imageWidth`
   100 (line 24). If the owner wants the card to sit on the tile colour, one key is added — not done, because it is
   a colour decision.
4. **`android.package`** (reverse-DNS application id) is deliberately not invented; it is required before any
   Android build and is listed here for the owner to name.
5. **Linking is not wired yet:** PRD 6.1's `rowta://` fallback scheme and the App Links intent filter
   (`/invite/<token>`, `/magic#<token>`) belong to the linking step, not to icon wiring.
6. Navigation libraries (`@react-navigation/native`, `native-stack`, `bottom-tabs`) are **not installed** — they were
   not in Phase 1 step 1's list; they will be version-verified against SDK 58 and pinned when navigation is built.

## Evidence

- Token gates run 2026-10-19 (real output): `JSON tokens: 391   CSS variables: 391   errors: 0`;
  `PASS: tokens.ts is an exact copy of design-variables.css (391 vars -> colors=178, typeStyles=17, spacing=8,
  shape=7, state=6, shadows=3; covered 391/391)`; `UI TOKEN GATE PASSED` (13 files). Colour block digest unchanged
  across regeneration: `f461abe0…3e1398fa13`.
- Expo config resolves: `npx expo config --type public` (from `app/`) → `sdkVersion: '58.0.0'`,
  `platforms: ['android']`, `icon`, both plugins, `android.adaptiveIcon.backgroundColor: '#292da3'`.
- `npx expo install --check` → `Dependencies are up to date`; app typecheck exit 0; app lint exit 0 (0 warnings).
- This ADR covers Phase 1 step 4 only. **No screens or components have been built**, as instructed.
