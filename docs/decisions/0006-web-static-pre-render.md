# 0006. Web surface: static pre-rendered HTML with a small progressive-enhancement script

Date: 2026-10-20. Status: accepted. Phase 11 (PRD 10, rules W1–W6).

## Context

The `/web` surface must give crawlers real content (W4), work with JavaScript disabled (Phase 11 task 8),
keep largest contentful paint under 2.5 s (W6), and be deployable by the owner on Vercel with no server code.
Two candidate approaches were on the table: [VERIFY against current docs at implementation time]:

1. **Expo web export** (React Native Web, as proven for the app preview): the served HTML is an empty shell;
   all content renders client-side, so a no-JS visitor and a plain HTTP crawler both see nothing until the
   JavaScript runs. The JS payload is multi-megabyte (the app preview bundle was ~5 MB).
2. **Static HTML generated at build time** by a small Node script from markdown sources in `docs/legal/`,
   plus one tiny script (≤2 KB) for the dynamic-title announcement (W3).

## Decision

Option 2. `web/build.mjs` renders every page to `web/dist/` as complete HTML. No framework, no client-side
router, no third-party scripts, no cookies, no storage. The small script only announces the document title
into a polite live region on load (W3/X3); with JavaScript off, every page still shows all its content, links
and metadata.

## Why

- Content works with JavaScript disabled (task 8) — impossible with a client-rendered bundle.
- Crawlers and social scrapers see the final HTML without executing JS (W4).
- W6 performance: no framework hydration, fonts self-hosted, one stylesheet.
- The owner deploys `web/dist` as plain static files (P1: the agent never deploys).

## Consequences

- Real URLs are directory-style (`/privacy/` → `web/dist/privacy/index.html`), which every static host serves
  without extra rewrites.
- Markdown in `docs/legal/` is the single source of truth; the renderer supports a small, fixed subset
  (headings, paragraphs, lists, tables, links, emphasis, code, horizontal rules, raw HTML lines the authors
  wrote). Tests assert the output.
- Dynamic in-app view switching (W3's SPA sense) does not apply; each navigation is a full page load whose
  title is already correct in the HTML. The live-region announcement still fires on load.
- A single-page feel is deliberately not chosen: separate pages are simpler, faster and more robust.
