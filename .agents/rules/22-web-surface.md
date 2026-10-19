---
trigger: glob
globs: "web/**"
---

# Rowta rules: Web surface

Part of the binding Rowta rule set in `.agents/rules/`. Every rule has an ID; audits and reports cite the ID.
MUST and NEVER are absolute. [DECISION] = a choice made here that the owner can change. [VERIFY] = check against current official
documentation and cite the page. [OPEN] = waiting for the owner. Full legend: `00-core-process.md`.

---------------------------------------------------------------------------------------------------

## W. Web surface (decided Q1: yes; applies to everything in `/web`)

W1. Every public page has: a unique `<title>` (about 60 characters or fewer), a meta description (about 160 or
    fewer), meta keywords (owner request; note that major search engines ignore this tag), a canonical URL,
    `lang`, charset, viewport, theme colour, a complete favicon set (ICO, SVG, Apple touch icon, 192 and 512 PNG
    in a web manifest), Open Graph tags (`og:title`, `og:description`, `og:type`, `og:url`, `og:image` at 1200 by
    630, `og:site_name`, `og:locale`), Twitter card tags, and structured data (JSON-LD) on the landing page.
W2. Token pages (invite, reset, magic) are `noindex` and never put tokens in analytics or referrers.
W3. **Dynamic title**: the document title updates on every view change ("Sign in - Rowta", "Create account - Rowta")
    and is announced with the view change (X3).
W4. `sitemap.xml` and `robots.txt` exist. Public pages are pre-rendered or static so crawlers see content.
W5. Semantic HTML: header, nav, main, footer landmarks; one `h1` per view; ordered headings; labels tied to
    inputs; a skip link; visible focus.
W6. Performance target: largest contentful paint under 2.5 seconds on a mid-range phone, measured with Lighthouse
    and saved in `docs/` [VERIFY tool version]. Images are sized and compressed.
