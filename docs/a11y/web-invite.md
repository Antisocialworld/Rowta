# Accessibility checklist — web `/invite/:token` (invite fallback page)

Screen: `web/dist/invite/index.html`, served for any `/invite/<segment>` (PRD 8.2, 10; rules X1 to X14,
W1 to W6). One static page + a runtime script; the invite API does not exist yet (Phase 3).
How tested: headless Edge/Chrome (puppeteer-core) for the automated rows, keyboard-only tab walk and
axe-core 4.10.3 via `web/scripts/web-checks.mjs` + `web/scripts/verify-token-runtime.mjs`.
**NVDA on Windows (Firefox and Chrome): NOT VERIFIED in this environment — owner walkthrough required (X9).**
Date: 23 Oct 2026 · Evidence: `docs/ui-matrix/web-invite-*-web-render-not-android.png` (12-file set includes 4 for this page).

- [x] Every control has a name, role and state read aloud correctly.
      (Static check: links "Open in the app" and — when `PUBLIC_ANDROID_DOWNLOAD_URL` is set —
      "Get the Android app"; visible text is the accessible name. "Open in the app" is hidden without a
      token, proven at the computed-style level: `PASS: button actually not RENDERED without a token`.
      **NVDA spoken output: not verified.**)
- [x] Reading order matches visual order; h1 (`tabindex="-1"`) focused on load
      (`PASS: /invite/<token>: h1 focused on load`); skip link first in tab order. **NVDA: not verified.**
- [x] The missing-token message sits in a `role="status" aria-live="polite"` region and is visible plain
      text ("incomplete or has expired" + how to get a new invitation). **Announcement by NVDA: not verified.**
- [x] Contrast 4.5:1 / 3:1: axe-core 0 WCAG A/AA violations on both states (`PASS: axe invite no token`,
      `PASS: axe invite with token`); visible focus ring on every tab stop.
- [x] Touch targets 44x44+: `.button` min-height 48px; nav/footer links 44px+.
- [x] Text at 200%: no horizontal overflow at 360x800 and 1280x800
      (`PASS: 200% scaling: invite ... 0px`); screenshots at 320/360/1280 all 0px overflow.
- [x] Reduce-motion honoured (site-wide block; no motion on this page); nothing flashes.
- [x] No sound-only content; plain language; one primary action plus one informational download line.
- [x] No network request on load; token read from the path segment only, used solely to build the
      `rowta://invite/<token>` href; it appears in no second request and in no console line
      (`PASS: ALL RUNTIME CHECKS PASSED`, static scan in `test-token-pages.mjs`).

Owner follow-ups: NVDA + Firefox/Chrome walkthrough (X9), a real-device tap on the deep link, the
`assetlinks.json` App Links file (needs the signing fingerprint after the first EAS build), and the real
build link (`PUBLIC_ANDROID_DOWNLOAD_URL`) are **not verified / not in this task**.
