// test-links — every internal link on every built page resolves to a file in web/dist, every in-page anchor
// target exists, and every referenced asset (styles, script, icons, fonts, og image) is present.
// Run:  node web/tests/test-links.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function distFileExists(urlPath) {
  // Candidates are kept RELATIVE to dist: path.join with an absolute second segment would break on Windows.
  const clean = urlPath.replace(/^\//, '');
  const candidates = [clean, path.join(clean, 'index.html'), `${clean}.html`];
  return candidates.some((candidate) => {
    const full = path.join(DIST, candidate);
    return fs.existsSync(full) && fs.statSync(full).isFile();
  });
}

function anchorsOf(html) {
  const ids = new Set();
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) ids.add(m[1]);
  return ids;
}

const htmlFiles = walk(DIST).filter((file) => file.endsWith('.html'));
let internalCount = 0;
const external = new Set();
// The canonical base (PUBLIC_WEB_URL) may appear as absolute URLs; everything else must be internal.
const sampleHtml = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const base = /<link rel="canonical" href="([^"]+)\/">/.exec(sampleHtml)?.[1] ?? '';

for (const file of htmlFiles) {
  const rel = path.relative(DIST, file);
  const html = fs.readFileSync(file, 'utf8');
  const ids = anchorsOf(html);

  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const url = m[1];
    if (url.startsWith('mailto:')) continue;
    if (url.startsWith('https://') || url.startsWith('http://')) {
      external.add(url);
      continue;
    }
    if (url.startsWith('#')) {
      check(ids.has(url.slice(1)) || url === '#main', `${rel} anchor ${url} exists`);
      continue;
    }
    if (url.startsWith('/')) {
      internalCount += 1;
      const [pathname, hash] = url.split('#');
      const exists = distFileExists(pathname === '/' ? '/' : pathname);
      if (!exists) check(false, `${rel} -> ${url} (target missing)`);
      if (hash) {
        const targetFile =
          pathname === '/' || pathname === ''
            ? path.join(DIST, 'index.html')
            : [path.join(DIST, pathname.replace(/^\//, ''), 'index.html'), path.join(DIST, `${pathname.replace(/^\//, '')}.html`)].find(
                (candidate) => fs.existsSync(candidate),
              );
        const targetHtml = targetFile ? fs.readFileSync(targetFile, 'utf8') : '';
        if (!anchorsOf(targetHtml).has(hash)) check(false, `${rel} -> ${url} (anchor #${hash} missing in target)`);
      }
    }
  }
}
check(internalCount > 30, `internal links checked (${internalCount})`);
check(
  [...external].every((url) => url.startsWith(`${base}/`) || url === base),
  `no external URLs besides the PUBLIC_WEB_URL origin (found: ${external.size ? [...external].join(', ') : 'none'})`,
);

// Sitemap: every entry resolves; robots points at it; manifest icons exist.
const robots = fs.readFileSync(path.join(DIST, 'robots.txt'), 'utf8');
const sitemapRef = /Sitemap: (\S+)/.exec(robots)?.[1];
check(Boolean(sitemapRef), 'robots.txt names the sitemap');
const sitemap = fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
check(locs.length >= 9, `sitemap lists ${locs.length} public pages`);
for (const loc of locs) {
  const base = sitemapRef ? sitemapRef.replace(/\/sitemap\.xml$/, '') : '';
  const urlPath = loc.startsWith(base) ? loc.slice(base.length) : null;
  if (urlPath === null || !distFileExists(urlPath)) check(false, `sitemap -> ${loc} (missing)`);
}
check(!locs.some((loc) => loc.includes('/404')), 'sitemap excludes the 404 page');

const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.webmanifest'), 'utf8'));
for (const icon of manifest.icons) {
  check(distFileExists(icon.src), `manifest icon ${icon.src} exists`);
}
check(/^#[0-9a-fA-F]{6}$/.test(manifest.theme_color), `manifest theme_color is a resolved token (${manifest.theme_color})`);

// security.txt exists and carries the approved contact.
const security = fs.readFileSync(path.join(DIST, '.well-known', 'security.txt'), 'utf8');
check(/Contact: mailto:rowtareply@gmail\.com/.test(security), 'security.txt contact = approved email');
check(/Expires: \d{4}-\d{2}-\d{2}/.test(security), 'security.txt has an Expires date (RFC 9116)');

// Key assets exist: stylesheet, script, both fonts, logo, og image.
for (const asset of [
  '/assets/styles.css',
  '/assets/design-variables.css',
  '/assets/rowta.js',
  '/assets/fonts/Poppins_400Regular.ttf',
  '/assets/fonts/Poppins_600SemiBold.ttf',
  '/brand/logo.svg',
  '/brand/og-image-1200x630.png',
]) {
  check(distFileExists(asset), `asset ${asset}`);
}

process.exit(failures === 0 ? 0 : 1);
