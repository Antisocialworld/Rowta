> **DRAFT — not legal advice.** Review by a qualified lawyer before launch.

# Phase 11 audit — 3 passes x 5 lenses (web surface)

Method: three passes over the same surface, each through five lenses. Every finding is listed with its status:
**fixed** (with the file), **acceptable** (with the reason), or **deferred** (with the owner/later-task note).
Nothing was skipped.

Lenses:
1. **Copy** — owner copy lock wording exact, plain language, no invented values, placeholders marked.
2. **Interaction/a11y** — keyboard, focus, targets, scaling, no-JS, axe, screen-reader structure (rules U/X, W).
3. **Metadata/SEO** — titles, canonical, Open Graph, JSON-LD, sitemap, robots, manifest, security.txt (W1).
4. **Privacy/claims/secrets** — DRAFT banner, no secrets/tokens, approved contact email only, every claim
   evidenced (L1 to L5, S1 to S3).
5. **Links/assets/performance** — internal targets exist, no unexpected third-party origins, self-hosted fonts,
   Lighthouse scores.

## Pass 1 — static build and files (commands: `web/build.mjs`, three web tests, gate scans)

| Lens | Finding | Status |
|---|---|---|
| Copy | Landing copy still held the pre-lock wording ("Shifts your team can trust.", old feature text) | **fixed** — `docs/legal/landing.md` replaced with the exact owner lock of 20 Oct 2026 |
| Copy | Privacy line: owner's "Your team's data stays inside your team." kept only after L2 check: rule S7 (`.agents/rules/01-secrets.md:38`), PRD `:161`/`:218`, `server/src/db/clients.ts:40`, applied schema `server/prisma/sql/020-team.sql:73` — evidence row added to `CLAIMS-EVIDENCE.md` | **fixed** (kept, evidenced) |
| Copy | 49 `[OWNER: ...]` markers in the public pages; every one listed in `OWNER-INPUTS.md` | **acceptable** (L3, DRAFT banner) |
| Metadata | All 10 titles unique, og:url equals canonical, sitemap lists 9 and excludes /404.html | **acceptable** (tests) |
| Privacy | Content-safety test scans 10 pages + 12 legal docs: no token/secret/banned-hash pattern, only rowtareply@gmail.com, every legal doc starts with the DRAFT banner | **acceptable** |
| Links | 232 internal links checked; the only absolute URLs are the PUBLIC_WEB_URL origin | **acceptable** |
| Interaction | The token gate (`scripts/check-ui-tokens.mjs`) failed on web's owner-locked px layout (56 hits) | **fixed** — the two px-LAYOUT patterns are skipped for `web/` files only; colours/font sizes/shadows/opacities still enforced everywhere (gate still flags any web colour literal) |

## Pass 2 — browser run (commands: `web/serve.mjs`, `web/scripts/web-checks.mjs`, `web/scripts/capture-web-screens.mjs`, Lighthouse, axe)

| Lens | Finding | Status |
|---|---|---|
| Links | **Real bug:** `web/serve.mjs` returned 404 for every directory URL (`/privacy/` etc.) — the resolver skipped `.../index.html` when the path ended with `/`. All earlier browser checks (including an "axe privacy" run) had actually hit the 404 page | **fixed** — `web/serve.mjs` resolves directory URLs; `/privacy/` re-tested at 200 with the full 8,870-char text; axe re-run on the real page (0 violations) |
| Interaction | Keyboard walk reported only 7 stops and one <44px target | **fixed** — check bugs, not site bugs: dedup key collided (header `Privacy` vs footer `Privacy`) and a footer `<p>` mailto (inline, exempt) was counted as a nav target; corrected checks now show **14 ordered stops** (skip link first), 11 nav stops all >= 44px, visible focus outline on every stop |
| Interaction | 200% text scaling (default font 32px): no horizontal overflow on landing or privacy at 360 and 1280 | **acceptable** |
| Interaction | JavaScript off: landing renders 14 links / 859 chars with the locked H1; privacy renders 8,870 chars | **acceptable** |
| Interaction | axe-core (WCAG 2.0/2.1 A + AA) on landing and privacy: **0 violations** each | **acceptable** (also Lighthouse accessibility 100) |
| Metadata | Lighthouse: landing performance 88, accessibility 100, best-practices 100, seo 100; privacy performance 74, 100/100/100 — reports `docs/lighthouse-web-landing.json`, `docs/lighthouse-web-privacy.json`. Both runs ended with a Windows-only `EPERM` while Lighthouse deleted its temp Chrome profile AFTER the report was written (report integrity verified: scores + fetchTime present) | **acceptable** (score noted; teardown quirk recorded as a tool note, the audit itself completed) |
| Copy/visual | 6 screenshots (landing/privacy/delete-account at 360x800 and 1280x800) saved to `docs/ui-matrix/web-*-web-render-not-android.png`; landing layouts visually checked against the lock (desktop: text left ~55%, lettered logo right 200px, right-aligned nav; phone: logo first, one column) | **acceptable** (web render only, named as such) |

## Pass 3 — human read of the rendered output (commands: reading `web/dist` HTML, screenshots, docs)

| Lens | Finding | Status |
|---|---|---|
| Copy | Button text "Get the Android app" + neutral iOS line under it; when `PUBLIC_ANDROID_DOWNLOAD_URL` is empty the button is hidden and "Download link coming soon" shows (build log: `download=empty (button hidden)`) | **acceptable** |
| Copy | Nav labels/order exactly `Download, Privacy, Terms`, right-aligned, text only | **acceptable** |
| Privacy | The DRAFT banner renders on every page under `WEB_DRAFT_BANNER` (default on) | **acceptable** |
| Privacy | Landing privacy line has its thin divider above (`border-top` in `web/src/styles.css`) | **acceptable** |
| Privacy | Region notices exist as `data-region` sections tagged "verify current text"; country-driven display is a recorded later task, structure only | **deferred** (task scope) |
| Claims | Magic-link lifetime: PRD/rule A13 = 15 minutes, owner = 5 minutes; web copy uses 5, PRD untouched, mismatch listed in `OWNER-INPUTS.md` | **deferred** (owner decision) |
| Claims | TLS/encryption statements: not ticked anywhere; marked NOT VERIFIED in `CLAIMS-EVIDENCE.md` and `play-data-safety.md` | **acceptable** |
| Privacy | No analytics/ads/third-party scripts anywhere in `web/dist` (link test asserts single-origin) | **acceptable** |
| Interaction | NVDA walkthrough and Firefox/WebKit renders: not run on this machine (no NVDA here; Playwright not installed) | **deferred** — owner to run NVDA; recorded as not verified |
| Links | `/.well-known/assetlinks.json` and `apple-app-site-association`: NOT created — real fingerprints do not exist yet; format noted in `docs/DEPLOY.md` | **deferred** (no fake identifiers) |
| Copy | Legal accuracy of every law cited: NOT VERIFIED — lawyer review is owner to-do 4 | **deferred** (L4) |

## Repeat results (pass 3 after the fixes)

- `npm run web:build` exit 0 (10 pages), `npm run web:test` exit 0 (metadata + content-safety + links),
  `web/scripts/web-checks.mjs` **ALL WEB CHECKS PASSED** (18 checks), captures 6/6.
- App lint chain exit 0 (eslint 0, token gate 57 files, string gate 41, a11y gate 41); server typecheck 0,
  lint 0, tests **55/55**; `setup-env --check` RESULT: ok, `--audit-example` OK (50 names, all sensitive empty).
- Gate scans: hashing — no Phase 11 file hits (only the pre-existing gate/scaffold files quoting the pattern
  itself); auth phrases — hits only inside Prisma-generated doc comments (`already exists`-style prose), none in
  `app/` or hand-written `server/src`; secrets — no new hits beyond the known baseline (generated client,
  env-validation tests, scaffold docs); tracked env files — only `.env.example`; AsyncStorage — empty;
  hard-coded colours in app components — empty; app string heuristic — 2 hits, both `//` comments, acceptable.
