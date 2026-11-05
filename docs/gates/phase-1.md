# Phase 1 gate — design system, app shell, component kit, auth shell

State: **passed with one honest gap (UI screenshots: web render only, not Android, not verified on device — no
emulator on this machine; `docs/ui-matrix/README.md`).**
Branch: `rowta-1`. Date: 2026-10-19. Full-build mode. Owner does all git work (P1).

Every claim below was produced by the command shown, on this machine, at gate time. Nothing is copied from a
plan. "not verified" means exactly that.

## 1. Toolchain and dependencies

| Claim | Command | Evidence |
|---|---|---|
| Branch is rowta-1 | `git branch --show-current` | `rowta-1` |
| Expo SDK 58 chose the safe-area version | `npx expo install react-native-safe-area-context` (from `app/`) | `Installing 1 SDK 58.0.0 compatible native module` → **5.10.1**, npm: MIT, https://www.npmjs.com/package/react-native-safe-area-context |
| Expo agrees the tree is consistent | `npx expo install --check` (from `app/`) | `Dependencies are up to date` (exit 0) |
| Poppins loaded before first paint (U11g) | `app/App.tsx` + export below | fonts resolve before `SplashScreen.hideAsync()`; failed fonts fall back to the system font, never a white screen |
| npm audit unchanged, never auto-fixed | `npm audit` | 27 (8 moderate, 19 high) — recorded in `docs/BUILD-PROGRESS.md` Known problems; `npm audit fix` never run (owner decision) |

## 2. Static gates (all run at gate time, all exit 0)

| Gate | Command | Evidence |
|---|---|---|
| App typecheck (strict) | `npm run typecheck --workspace @rowta/app` | `tsc --noEmit`, 0 errors |
| App lint chain | `npm run lint --workspace @rowta/app` | `eslint .` 0 problems, then token gate, string gate, a11y gate all PASS |
| Design-token gate | `node scripts/check-ui-tokens.mjs` | `UI TOKEN GATE PASSED` — 51 files, no hard-coded colours/font sizes/spacing/radii/shadows/opacities |
| String gate (U8) | `node scripts/check-app-strings.mjs` | `STRING GATE PASSED` — 40 files; probe file with inline prose, wrapped prose, literal prop text and a same-line `>text<` FAILED with 4 hits (then deleted); gate hardened this phase so comparisons inside `{expressions}` (e.g. `password.length > 0 && ... < N`) can never masquerade as JSX children |
| App a11y gate (X1/X7/X14a, rule 21) | `node scripts/check-app-a11y.mjs` | `A11Y GATE PASSED` — 40 files; probe file FAILED with 5 hits, one per rule (maxFontSizeMultiplier, deprecated setAccessibilityFocus, bare MaterialIcons, raw Pressable without role, native disabled=) then deleted; wired into `npm run lint --workspace @rowta/app` and `npm run check:a11y` |
| Token coverage | `node scripts/test-app-tokens.mjs` | `PASS: tokens.ts is an exact copy of design-variables.css (391 vars; covered 391/391)` |

## 3. Behaviour evidence (real runs, no device)

| Claim | Command | Evidence |
|---|---|---|
| Auth view machine: all ten PRD 6.1 views, transitions, root refusal, PRD-11 message travel (superseded by §6c: rewritten for the rework) | `npx tsx app/scripts/test-auth-machine.ts` | was 36/36 PASS under the old AuthGate machine; the reworked machine's run is §6c (**20/20**) |
| Phase 1 session stub refuses a release build (P7) | `npx tsx app/scripts/test-session-guard.ts` | `PASS: guard fired — Rowta: the Phase 1 session stub is dev-only and refuses to load in a release build (P7; docs/SECURITY.md section 3).` then `PASS: ... refuses a release build` |
| Guard is recorded as a control | `docs/SECURITY.md` section 3 | row added: guard = throw at import when `__DEV__ === false`; status "built in Phase 1 step 3; **Phase 2 replaces it**" |
| The app bundles: entry, babel/worklets, safe-area, fonts, all views | `npx expo export --platform android --output-dir <temp>` (from `app/`) | exit 0; `_expo/static/js/android/AppEntry-0c8aa010a21131a75c83487ad65e4f7f.hbc (3.1MB)`; fonts listed in the asset output |

## 4. Deterministic icon pipeline (U10)

| Claim | Command | Evidence |
|---|---|---|
| `npm run icons` passes | `npm run icons` | `ALL CHECKS PASSED 48`, ico entry count 3, sizes 48/32/16 |
| Running it twice changes nothing | `node scripts/hash-assets.mjs` after each run, compare | `ICONS-DETERMINISTIC=YES` — identical blake2b512 digests, e.g. `395bef96…` `app/assets/adaptive-icon-foreground.png`, `0da07ae8…` `app/assets/app-icon-1024.png`, `fdaf1ebc…` `app/assets/splash.png` (full set via the command; SHA-256 never used — rule A2/A4) |

## 5. Contrast (U11e — report, never adjust)

`node scripts/contrast-report.mjs` → `docs/a11y/contrast.md`: 18 pairs, **1 PROBLEM**
(`color-on-tertiary-container` on `color-tertiary-container` = **1.86:1**). Reported, not changed (owner decision:
do nothing for colours; Q9/Q11 open). Disabled and decorative pairs listed as exempt with reasons.

## 6. Server regression (no app change may break it)

`npm run test --workspace @rowta/server` → **Test Files 10 passed, Tests 55 passed** (exit 0).

## 6b. Web preview (browser render only — NOT Android, NOT a device pass)

Added after the Phase 1 gate so the screens can be looked at without a device. This proves the app **compiles and
serves for the web**, nothing more; visual correctness is the owner's eyes, and no Android/device claim follows from it.

| Claim | Command | Evidence |
|---|---|---|
| Web deps were absent, then Expo-SDK-58 versions installed | grep `app/package.json`, then `npx expo install react-native-web react-dom @expo/metro-runtime` (from `app/`) | were missing → installed: `react-native-web` **0.21.4** (npm MIT), `react-dom` **19.3.0** (MIT), `@expo/metro-runtime` **58.0.14** (MIT); all three then exact-pinned in `app/package.json` |
| Expo agrees the tree is consistent after pinning | `npx expo install --check` | `Dependencies are up to date` (exit 0) |
| Web platform enabled | `app/app.json` | `"platforms": ["android", "web"]` — config only, no colour touched |
| Dev server starts on localhost | `npx expo start --web --port 8082` (from `app/`) | `Waiting on http://localhost:8082`; PID recorded in the session log |
| The app entry compiles on web, with no failing module | `GET http://localhost:8082/` then the entry bundle URL | HTML **200**; bundle **200, 5,075,701 bytes**; server log `Web Bundled 32414ms node_modules\expo\AppEntry.js (766 modules)`; **stderr empty** — no failure from expo-secure-store, expo-notifications, reanimated, FlashList, SVG or fonts (so **no Platform.OS web guard was needed** — none added) |
| First screen and gallery are in the compiled graph | substring check against the served bundle | `'Sign in to Rowta'` → **True**; `'refuses to load in a release build'` (P7 guard, must ship in every build) → **True**; `'Component gallery'` → **True**; `'Every component in every state'` → **True** |
| Still green after the config/pin edits | `npx expo install --check`, `npm run typecheck`, `npm run lint` (workspace) | 0 / 0 / 0 (token, string and a11y gates all PASS inside the lint chain) |

**Not claimed:** that anything looks right (no browser/eyes here), that fonts render visually at runtime (compile
level only), or that this substitutes for any Android/device check below.

## 6c. Auth-page rework — one page, conditional rendering, logo, links, desktop, entry paths (2026-10-20)

The auth shell was reworked: `AuthGate.tsx` is deleted, `app/src/screens/AuthPage.tsx` is the ONE page (a single
centred card whose contents are conditional on the machine's view), the three forms
(`signIn | createAccount | forgotPassword`) plus the seven step states render inside it, the logo (lettered
blue-tile book = `app/assets/app-icon-1024.png`, the raster the icon pipeline builds from `brand-source/logo.svg`)
sits centred at the top with the visible heading under it, secondary actions are text links
(`app/src/components/LinkButton.tsx`), and the sign-in form's "Sign in by email link" button became the text link
**"Email me a sign-in link"** (`auth.view.magicRequest.heading`) while keeping the whole email-link flow reachable.

| Claim | Command | Evidence |
|---|---|---|
| One page, conditional views, three forms, focus targets, item-7 back rules, message travel | `npx tsx app/scripts/test-auth-machine.ts` (from `app/`) | **PASS, exit 0** — includes `back() on createAccount returns to signIn`, `back() on forgotPassword returns to signIn`, `back() on signIn at the root refuses (Android exits the app, U1)`, `switch(createAccount -> forgotPassword) is a form-to-form switch` with empty history, `reset completion lands on signIn with auth.reset.done`, inline confirmation on `magicRequest` (email-link flow intact, item 4) |
| Deep-link entries open the right state with the right history | `npx tsx app/scripts/test-auth-entry-paths.ts` (from `app/`) | **9/9 PASS, exit 0** — `AUTH_ENTRY.resetLink` → `resetPassword` (history starts at signIn), `AUTH_ENTRY.invite` → `createAccount` then back → signIn, `AUTH_ENTRY.magicToken` → `magicConfirm` one button, root-like history, back refuses |
| Typecheck still clean after the rework | `npm run typecheck --workspace @rowta/app` | `tsc --noEmit`, 0 errors (includes both test scripts and the new `.png` module declaration in `app/src/types/assets.d.ts`) |
| Lint chain still green (eslint + tokens + strings + a11y) | `npm run lint --workspace @rowta/app` | exit 0: `UI TOKEN GATE PASSED` (55 files), `STRING GATE PASSED` (41), `A11Y GATE PASSED` (41). `LinkButton` is a kit pressable (sets `accessibilityRole="link"` internally), so it joined `KIT_PRESSABLE_TAGS` in `scripts/check-app-a11y.mjs` exactly like Button/Chip/ShiftCard; screens still may not add raw pressables without a role |
| The reworked page compiles and serves on web | `GET http://localhost:8082/` + entry bundle URL | bundle **200, 5,085,670 bytes** after the rework; substring checks on the served bundle: `AuthPage` → **True**, `app-icon-1024` → **True**, `Email me a sign-in link` → **True**, `Back to sign in` → **True**, `link-email-signin` → **True**, `maxWidth` → **True** |
| Server untouched and still green | `npm run test --workspace @rowta/server` | Test Files 10 passed, **Tests 55 passed**, exit 0 |
| Six web screenshots exist for all three form states at both sizes | `node scripts/capture-web-matrix.mjs` (from `app/`, server on 8082) | exit 0, Edge headless via `puppeteer-core@25.14.0` (dev-only, exact-pinned in `@rowta/app`, Apache-2.0, no Chromium download): `auth-{sign-in,create-account,forgot-password}-{360x800,1280x800}-web-render-not-android.png` in `docs/ui-matrix/` (visually checked: logo + heading under it + one centred card + link rows at 360; centred card of maxWidth 400 at 1280) |

**Deep-link honesty (item 6):** the real `rowta://` and https URL routes are **Phase 2** (`BUILD-PROGRESS`
gap (e): linking/navigation packages deliberately deferred). What exists and is proven here is the entry mapping
Phase 2's routes will call — password-reset link → `AUTH_ENTRY.resetLink` (`rowta://reset-password`), invite →
`AUTH_ENTRY.invite` (`rowta://invite`), email-link token → `AUTH_ENTRY.magicToken` (`rowta://magic-link`) — tested
headlessly through the same `enter` action the app uses. Actual URL opening is **not verified**.

**Email-link feature report (item 4):** built = the app views `magicRequest` (with inline confirmation) / `magicConfirm`, their
catalog strings (`Email me a sign-in link`, `Sign in to Rowta`, …), the
reachable text link on the sign-in form, the machine transitions and the entry path above; stub = **no server
call anywhere** — no magic-link request endpoint, no email job (Phase 1 is client-only with the session stub;
Phase 2 wires the API). The `acceptInvite` view stays implemented but reachable only from its reducer entry, as
before.

## 7. Honest gaps (not verified)

| Gap | Why | Evidence |
|---|---|---|
| UI size-matrix screenshots (PRD 6.3) — **web render only, not Android, not verified on device** | no `adb` + device/emulator on this machine; PRD forbids faking; the web preview above is a compile/serve check only | `node app/scripts/capture-ui-matrix.mjs` exits 2 and prints every missing capture by name; `docs/ui-matrix/README.md` lists the 11 cases and the exact capture procedure; the script drives `adb shell wm size` + `adb exec-out screencap`, so it **cannot run against the web URL** (Android-only by design) |
| On-device TalkBack/NVDA passes | no device/emulator | deferred with the screenshots; the static a11y gate + machine tests are the standing evidence until then; the web preview does NOT verify TalkBack |
| Motion (reduce-motion behaviour) on device | no device/emulator | not verified; only the code path (`useReducedMotion`, static skeletons under reduce-motion) exists |
| Font loading at runtime on a device / in a browser | no device | visually rendered in the six web screenshots (Poppins in headless Edge, §6c); a real device render is still the owner's check |

## 8. Phase 1 checklist (PRD 12)

- [x] Design tokens generated from the owner's CSS, zero stray values (sections 2)
- [x] Fonts loaded before first paint, Poppins 400/500/600 only (sections 1, 3)
- [x] Icon pipeline deterministic (section 4)
- [x] One AuthPage screen — one centred card, conditional rendering, three forms + ten views, pure machine and entry tests (sections 3, 6c)
- [x] Every view has its own title, its heading rendered under the logo by the page, and a focus target (AUTH_VIEWS + `test-auth-machine.ts`, section 6c)
- [x] Secondary actions are text links, including the sign-in form's "Email me a sign-in link"; desktop/web card centred at maxWidth 400 (section 6c)
- [x] Uniform PRD-11 messages travel with the view and announce via a polite LiveRegion (section 3)
- [x] X14 waiting buttons (dimmed, focusable, reason announced) — kit + gate (section 2, R5)
- [x] Component gallery with every component in every state (`app/src/screens/GalleryScreen.tsx`, reachable from the Phase 1 signed-in branch)
- [x] Size-matrix harness exists and is honest (`app/scripts/capture-ui-matrix.mjs`, section 7)
- [x] a11y lint wired into a named script (section 2)
- [x] Server still 55/55 (section 6)
- [ ] Screenshots for every matrix case — **not verified: web render only (sections 6b, 6c)**; six form-state web PNGs exist in `docs/ui-matrix/`, the 11 Android cases (PRD 6.3) are still missing (`docs/ui-matrix/README.md`)
- [ ] On-device a11y passes — **not verified**, section 7; the web preview does not count

Next: Phase 2 (auth slice on the real server) is the owner's call.
