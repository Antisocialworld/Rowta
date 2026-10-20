// build — pre-render the web surface (ADR 0006). Reads docs/legal/*.md + docs/legal/landing.md,
// renders every registered page through pageMeta + layout, and writes web/dist/ with sitemap, robots,
// manifest, security.txt and all assets. Static files only: no server code, no cookies, no third-party
// requests in the output.
//
// Env (read from the process environment ONLY — this script never opens .env, rule S2):
//   PUBLIC_WEB_URL             REQUIRED. The public address (canonical, og:url, sitemap, robots).
//                              Never hard-coded here; the owner sets it on the host (Vercel env).
//   PUBLIC_ANDROID_DOWNLOAD_URL optional. The build link behind "Get the Android app". When empty the
//                              button is hidden and the page shows "Download link coming soon".
//   WEB_DRAFT_BANNER           'on' shows the DRAFT banner. Default: off — the owner removed the banner
//                              from the public pages (decision of 20 Oct 2026); docs/legal files keep their
//                              banner line (L1) and this flag can turn the page banner back on.
//
// Run:  node web/build.mjs     (from the repo root)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageMeta } from './src/pageMeta.mjs';
import { layout } from './src/layout.mjs';
import { renderMarkdown, stripBanner } from './src/markdown.mjs';
import { PAGES, SITEMAP_PAGES } from './src/pages.mjs';
import { landingMain, loadLandingCopy } from './src/landing.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIST = path.join(HERE, 'dist');

const rawBase = (process.env.PUBLIC_WEB_URL ?? '').trim();
if (!rawBase) {
  console.error('MISSING env: PUBLIC_WEB_URL must be set (for example http://localhost:8321 for a local build).');
  console.error('It is never hard-coded: set it in the shell here and as an env var on the host.');
  process.exit(2);
}
const base = rawBase.replace(/\/+$/, '');
const downloadUrl = (process.env.PUBLIC_ANDROID_DOWNLOAD_URL ?? '').trim();
const bannerOn = (process.env.WEB_DRAFT_BANNER ?? 'off').toLowerCase() === 'on';

/** Existing design-system token, resolved at build time (no colour literal in our code; rule: tokens only). */
function tokenColor(name) {
  const css = fs.readFileSync(path.join(ROOT, 'design-system', 'design-variables.css'), 'utf8');
  const primitive = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6,8})`).exec(css);
  if (!primitive) throw new Error(`design token --${name} not found`);
  return primitive[1].slice(0, 7); // drop any 8-digit alpha
}
const themeColor = tokenColor('color-pry-40'); // the tile colour of the brand
const surfaceColor = tokenColor('color-neutral-98');

function write(relative, content) {
  const file = path.join(DIST, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

// --- render pages ---------------------------------------------------------------------------
fs.rmSync(DIST, { recursive: true, force: true });
const copy = loadLandingCopy();
const built = [];

for (const page of PAGES) {
  let main;
  let jsonLd = '';
  let outputPath = page.path === '/' ? 'index.html' : `${page.path.replace(/^\//, '')}index.html`;

  if (page.special === 'landing') {
    main = landingMain(copy, downloadUrl);
    jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', name: 'Rowta', url: `${base}/`, inLanguage: 'en' },
        {
          '@type': 'SoftwareApplication',
          name: 'Rowta',
          applicationCategory: 'BusinessApplication',
          operatingSystem: 'Android',
          description: copy.description,
          url: `${base}/`,
          image: `${base}/brand/og-image-1200x630.png`,
        },
      ],
    });
  } else if (page.special === 'notfound') {
    outputPath = '404.html';
    main = `<section class="prose">
    <h1>Page not found</h1>
    <p>That address does not exist on this site. Go back to the <a href="/">Rowta home page</a>, or use the links below.</p>
    <p>Looking for something specific?</p>
    <ul>
      <li><a href="/privacy/">Privacy policy</a></li>
      <li><a href="/terms/">Terms of service</a></li>
      <li><a href="/delete-account/">Delete your account</a></li>
      <li><a href="/contact/">Contact us</a></li>
    </ul>
  </section>`;
  } else {
    const sourcePath = path.join(ROOT, page.source);
    const raw = fs.readFileSync(sourcePath, 'utf8');
    if (!/^>\s*\*{0,2}DRAFT/.test(raw.replaceAll('\r\n', '\n'))) {
      console.error(`L1 VIOLATION: ${page.source} must start with the visible DRAFT banner line.`);
      process.exit(1);
    }
    main = `<article class="prose">\n${renderMarkdown(stripBanner(raw))}\n</article>`;
  }

  const meta = pageMeta({
    base,
    title: page.title,
    description: page.description,
    path: page.path === '/404.html' ? '/404.html' : page.path,
    keywords: page.keywords,
    noindex: Boolean(page.noindex),
    type: page.type ?? 'article',
    themeColor,
  });

  const html = layout({ meta, main, base, bannerOn, current: page.current ?? '', jsonLd });
  write(outputPath, html);
  built.push({ title: page.title, path: page.path, bytes: Buffer.byteLength(html) });
}

// --- sitemap, robots, manifest, security.txt ------------------------------------------------
write(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${SITEMAP_PAGES.map(
    (page) => `  <url><loc>${base}${page.path}</loc></url>`,
  ).join('\n')}\n</urlset>\n`,
);

write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`);

write(
  'manifest.webmanifest',
  `${JSON.stringify(
    {
      name: 'Rowta - shift scheduling for teams',
      short_name: 'Rowta',
      description: copy.description,
      start_url: '/',
      scope: '/',
      display: 'browser',
      background_color: surfaceColor,
      theme_color: themeColor,
      icons: [
        { src: '/brand/web-manifest-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/brand/web-manifest-512.png', sizes: '512x512', type: 'image/png' },
      ],
    },
    null,
    2,
  )}\n`,
);

write(
  '.well-known/security.txt',
  `Contact: mailto:rowtareply@gmail.com\nExpires: 2027-10-20\nPreferred-Languages: en\nPolicy: ${base}/privacy/\n`,
);

// --- assets ---------------------------------------------------------------------------------
copyDir(path.join(HERE, 'public', 'brand'), path.join(DIST, 'brand'));
fs.mkdirSync(path.join(DIST, 'assets', 'fonts'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'design-system', 'design-variables.css'), path.join(DIST, 'assets', 'design-variables.css'));
fs.copyFileSync(path.join(HERE, 'src', 'styles.css'), path.join(DIST, 'assets', 'styles.css'));
fs.copyFileSync(path.join(HERE, 'src', 'rowta.js'), path.join(DIST, 'assets', 'rowta.js'));
for (const weight of ['400Regular', '600SemiBold']) {
  // @expo-google-fonts/poppins keeps each weight in its own folder (400Regular/Poppins_400Regular.ttf, ...).
  fs.copyFileSync(
    path.join(ROOT, 'node_modules', '@expo-google-fonts', 'poppins', weight, `Poppins_${weight}.ttf`),
    path.join(DIST, 'assets', 'fonts', `Poppins_${weight}.ttf`),
  );
}

console.log(`web build OK: ${built.length} pages -> ${path.relative(ROOT, DIST)}`);
for (const page of built) console.log(`  ${page.path}  ${page.bytes}B  ${page.title}`);
console.log(`base=${base} banner=${bannerOn ? 'on' : 'off'} download=${downloadUrl ? 'set' : 'empty (button hidden)'}`);
