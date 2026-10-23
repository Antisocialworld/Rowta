# Accessibility checklist — web `/magic` (magic-link fallback page)

Screen: `web/dist/magic/index.html`, served at `/magic` (PRD 8.1, 10; rules X1 to X14, W1 to W6).
How tested: headless Edge/Chrome (puppeteer-core) for the automated rows, keyboard-only tab walk and
axe-core 4.10.3 via `web/scripts/web-checks.mjs` + `web/scripts/verify-token-runtime.mjs`.
**NVDA on Windows (Firefox and Chrome): NOT VERIFIED in this environment — owner walkthrough required (X9).**
Date: 23 Oct 2026 · Evidence: `docs/ui-matrix/web-magic-*-web-render-not-android.png` (12-file set includes 4 for this page).

- [x] Every control has a name, role and state read aloud correctly.
      (Static check: one link "Open in the app" with visible text as its accessible name; no icon-only
      controls. Rendered hidden until a token is read — `hidden` + `display:none !important` proven by
      `verify-token-runtime.mjs`. **NVDA spoken output: not verified.**)
- [x] Reading order matches visual order; focus moves sensibly; the h1 (`tabindex="-1"`) receives focus on
      load (proven: `PASS: /magic#<token>: h1 focused on load`). Skip link is the first tab stop
      (`PASS: keyboard: first tab stop is the skip link`). **NVDA: not verified.**
- [x] The missing-token message sits in a `role="status" aria-live="polite"` region; it is visible text as
      well (never colour- or sound-only). **Announcement by NVDA: not verified.**
- [x] Contrast 4.5:1 text / 3:1 controls: axe-core 0 WCAG A/AA violations on both states
      (`PASS: axe magic no token`, `PASS: axe magic with token`). Focus ring visible on every tab stop
      (`PASS: keyboard: every tab stop shows a visible focus outline`).
- [x] Touch targets 44x44+: the primary button uses `.button` (`min-height: 48px`); nav/footer links are
      44px+ (`PASS: keyboard: nav tab targets are >= 44px tall`).
- [x] Text at 200%: no horizontal overflow at 360x800 and 1280x800
      (`PASS: 200% scaling: magic ... 0px`); screenshots at 320/360/1280 all 0px overflow.
- [x] Reduce-motion honoured: site-wide `prefers-reduced-motion` block disables animation/transition; this
      page has no motion of its own.
- [x] No sound-only or voice-only content; nothing flashes.
- [x] Plain language; one primary action ("Open in the app"); no destructive action on this page.
- [x] No network request on load; token read from the fragment only and stripped with
      `history.replaceState`; token never in the title, DOM text, console or any generated URL except the
      `rowta://magic/<token>` href (`PASS: ALL RUNTIME CHECKS PASSED`, static scan in
      `test-token-pages.mjs`).

Owner follow-ups: NVDA + Firefox/Chrome walkthrough (X9) and a real-device tap on "Open in the app"
(`rowta://magic/<token>`) are **not verified** here; the Android App Links path (`assetlinks.json`) is an
owner item (fingerprint needed after the first EAS build).
