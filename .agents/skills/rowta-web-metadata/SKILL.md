---
name: rowta-web-metadata
description: "Use when building or changing anything in Rowta's /web surface: page metadata (title, description, keywords, canonical, Open Graph, Twitter card, favicon set, JSON-LD, dynamic title), sitemap and robots, pre-rendering, the invite fallback page, the Android App Links file, hosting on Vercel, Lighthouse, axe and NVDA checks."
---

# rowta-web-metadata

Part of the Rowta method (Recipe 3.15). Numbering is kept from the original method so cross-references still resolve: see the table in `AGENTS.md`.
Code here is a PATTERN: check every library call against current documentation [VERIFY] before using it, and never paste real secrets (rule S1).

### 3.15 Web metadata (W1 to W6; applies to `/web`)
One function `pageMeta({ title, description, path, noindex })` outputs every required tag so no page can forget one. A test
loads each public page and asserts the tags exist and the title is unique. A view change updates `document.title` and the
live-region announcement together.

### Web surface build notes (PRD 10, W1 to W6)
1. **Pages**: landing, privacy (draft text from `rowta-privacy-recipes`), and `/invite/:token`. Public pages are static or pre-rendered so crawlers see real content [VERIFY: static HTML with a small script versus Expo web export; record the choice in an ADR]. A single-page feel with real URLs; dynamic title and live-region announcement on every view change (W3).
2. **Public address**: read from `PUBLIC_WEB_URL` only (canonical, `og:url`, sitemap, App Links). Never hard-code the Vercel address; you do not deploy (P1), the owner does.
3. **Files**: `sitemap.xml` (public pages only; token pages excluded), `robots.txt`, web manifest, the icon set built by the one icon script from `web/public/brand/logo.svg`.
4. **Token pages** (`/invite/:token`, any reset or magic page): `noindex` meta plus an `X-Robots-Tag` header [VERIFY header support on the host]; do NOT block them in `robots.txt` (a blocked page cannot be crawled to read its noindex); send `Referrer-Policy: no-referrer`; never put the token in analytics or a query string that could be logged; none of these pages loads third-party scripts.
5. **Invite fallback page**: tries the custom-scheme link `rowta://invite/<token>`, and shows the build link and plain instructions when the app is not installed. It never shows or logs the token beyond the URL itself.
6. **Android App Links file** at `/.well-known/assetlinks.json` (https): needs the app's package name and the signing certificate fingerprint in the format Android requires. The owner supplies the fingerprint after the first EAS build; leave a clearly marked placeholder and document it in `docs/DEPLOY.md` [VERIFY the file format in Android's current docs]. This file is the only place a certificate fingerprint appears (rule A4 exception E2; the gate-1 check exempts `assetlinks.json`).
7. **Security headers** via the host configuration [VERIFY Vercel config format]; no inline script unless a policy allows it.
8. **Magic-link page `/magic`** (`noindex`, `Referrer-Policy: no-referrer`, no third-party scripts): static page that reads the token from the URL fragment, removes it from the address bar and history, shows ONE "Sign in" button, and consumes the token only when the button sends the POST. A plain visit by an email scanner consumes nothing. It also offers an "Open in the app" button using `rowta://magic/<token>` as a fallback only. The App Links file and intent filter cover the paths `/invite` and `/magic` (Android's docs advise declaring the broadest scope, scheme and host, and refining paths in `assetlinks.json` [VERIFY for the Android version in use]).
9. **Evidence (Phase 11)**: Lighthouse result saved (LCP target under 2.5 s, W6); the W1 metadata checklist passes on every page (a test loads each page); axe run clean or findings listed; an NVDA walkthrough checklist per page in `docs/a11y/` (with Firefox and Chrome and keyboard only).
