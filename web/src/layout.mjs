// layout — the one HTML document every page renders through (rules W1, W5).
// Landmarks: skip link, header/nav, main, footer. One h1 per page comes from the page itself.
// The draft banner (L1) is rendered here under ONE flag the owner flips at build time (WEB_DRAFT_BANNER=off).
// Nothing here stores data, sets cookies or loads third-party requests: fonts, icons and scripts are same-origin.

const BANNER_TEXT = 'DRAFT — not legal advice. Review by a qualified lawyer before launch.';
const CONTACT_EMAIL = 'rowtareply@gmail.com'; // OWNER input, 20 Oct 2026 (web/src/constants.mjs)

export function layout({ meta, main, base, bannerOn, current = '', jsonLd = '' }) {
  const banner = bannerOn
    ? `\n  <div class="draft-banner" role="note">${BANNER_TEXT}</div>`
    : '';
  const navLink = (href, label, key) =>
    `      <li><a href="${href}"${current === key ? ' aria-current="page"' : ''}>${label}</a></li>`;
  return `<!doctype html>
<html lang="en">
<head>
  ${meta}
  <link rel="stylesheet" href="/assets/design-variables.css">
  <link rel="stylesheet" href="/assets/styles.css">
  <link rel="preload" href="/assets/fonts/Poppins_400Regular.ttf" as="font" type="font/ttf" crossorigin>
  <link rel="preload" href="/assets/fonts/Poppins_600SemiBold.ttf" as="font" type="font/ttf" crossorigin>
${jsonLd ? `  <script type="application/ld+json">${jsonLd}</script>\n` : ''}</head>
<body>${banner}
  <a class="skip-link" href="#main">Skip to main content</a>
  <div id="view-announcer" class="visually-hidden" role="status" aria-live="polite"></div>
  <header class="site-header">
    <nav aria-label="Main">
      <ul>
${navLink('/#get-rowta', 'Download', 'download')}
${navLink('/privacy/', 'Privacy', 'privacy')}
${navLink('/terms/', 'Terms', 'terms')}
      </ul>
    </nav>
  </header>
  <main id="main">
${main}
  </main>
  <footer class="site-footer">
    <p>Rowta — shift scheduling for teams. Questions? <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
    <nav aria-label="Footer">
      <ul>
        <li><a href="/contact/">Contact</a></li>
        <li><a href="/privacy/">Privacy</a></li>
        <li><a href="/terms/">Terms</a></li>
        <li><a href="/billing-terms/">Billing terms</a></li>
        <li><a href="/delete-account/">Delete account</a></li>
        <li><a href="/data-retention/">Data retention</a></li>
        <li><a href="/subprocessors/">Subprocessors</a></li>
        <li><a href="/accessibility/">Accessibility</a></li>
      </ul>
    </nav>
    <p class="fineprint">An iOS version is planned. It is not available yet.</p>
  </footer>
  <script src="/assets/rowta.js" defer></script>
</body>
</html>
`;
}
