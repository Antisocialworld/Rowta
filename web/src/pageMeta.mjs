// pageMeta — the ONE function that emits every W1 tag (rule W1; recipe 3.15).
// Every page calls it, so no page can forget title, description, keywords, canonical, favicon set,
// Open Graph or Twitter tags. The canonical/og:url/og:image values come from PUBLIC_WEB_URL only —
// never a hard-coded host (rule: read the address from one env name; P1: the owner deploys).
//
// Inputs:
//   base        absolute origin from PUBLIC_WEB_URL, no trailing slash (build fails without it)
//   title       unique per page, ~60 chars
//   description ~160 chars
//   path        canonical path WITH trailing slash ('' for the landing page), e.g. '/privacy/'
//   keywords    short string; note: major search engines ignore meta keywords (W1 owner request)
//   noindex     true for token/no-value pages (none public today; W2)
//   type        Open Graph type ('website' for landing, 'article' for the rest)
//   themeColor  the resolved design-system token (build reads it from design-variables.css; never a literal here)
export function pageMeta({ base, title, description, path = '', keywords, noindex = false, type = 'article', themeColor }) {
  const canonical = `${base}${path}`;
  const image = `${base}/brand/og-image-1200x630.png`;
  const lines = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeAttr(title)}</title>`,
    `<meta name="description" content="${escapeAttr(description)}">`,
    keywords ? `<meta name="keywords" content="${escapeAttr(keywords)}">` : '',
    `<link rel="canonical" href="${escapeAttr(canonical)}">`,
    noindex ? '<meta name="robots" content="noindex, follow">' : '<meta name="robots" content="index, follow, max-image-preview:large">',
    `<meta name="theme-color" content="${escapeAttr(themeColor)}">`,
    // Favicon set (W1): ICO, SVG, Apple touch icon, web-manifest icons 192/512.
    '<link rel="icon" href="/brand/favicon.ico" sizes="any">',
    '<link rel="icon" href="/brand/favicon.svg" type="image/svg+xml">',
    '<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">',
    '<link rel="manifest" href="/manifest.webmanifest">',
    // Open Graph (W1)
    `<meta property="og:title" content="${escapeAttr(title)}">`,
    `<meta property="og:description" content="${escapeAttr(description)}">`,
    `<meta property="og:type" content="${escapeAttr(type)}">`,
    `<meta property="og:url" content="${escapeAttr(canonical)}">`,
    `<meta property="og:image" content="${escapeAttr(image)}">`,
    '<meta property="og:site_name" content="Rowta">',
    '<meta property="og:locale" content="en_US">',
    // Twitter card (W1)
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${escapeAttr(title)}">`,
    `<meta name="twitter:description" content="${escapeAttr(description)}">`,
    `<meta name="twitter:image" content="${escapeAttr(image)}">`,
  ];
  return lines.filter(Boolean).join('\n  ');
}

function escapeAttr(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
