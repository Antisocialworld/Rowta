// test-metadata — W1/W5 proof: load every pre-rendered page in web/dist and assert the full tag set exists,
// titles are unique and in range, landmarks and the one h1 hold, and the landing page carries JSON-LD.
// Run:  node web/tests/test-metadata.mjs   (after node web/build.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES } from '../src/pages.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

function distFileFor(page) {
  if (page.path === '/') return path.join(DIST, 'index.html');
  if (page.path === '/404.html') return path.join(DIST, '404.html');
  return path.join(DIST, page.path.replace(/^\//, ''), 'index.html');
}

const htmlByKey = new Map();
const titles = new Map();

for (const page of PAGES) {
  const absolute = distFileFor(page);
  if (!fs.existsSync(absolute)) {
    check(false, `${page.path} rendered (${absolute} missing)`);
    continue;
  }
  const html = fs.readFileSync(absolute, 'utf8');
  htmlByKey.set(page.key, html);

  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
  check(title.length > 0 && title.length <= 60, `${page.path} title present and <= 60 chars (${title.length}: "${title}")`);
  titles.set(page.key, title);

  const description = /<meta name="description" content="([^"]*)">/.exec(html)?.[1] ?? '';
  check(description.length > 0 && description.length <= 160, `${page.path} description present and <= 160 chars (${description.length})`);

  check(/<meta name="keywords" content="[^"]+">/.test(html), `${page.path} meta keywords present (W1 owner request)`);
  check(/<link rel="canonical" href="https?:\/\/[^"]+">/.test(html), `${page.path} absolute canonical present`);
  check(/<meta name="theme-color" content="#[0-9a-fA-F]{6}">/.test(html), `${page.path} theme-color present`);
  check(/<meta charset="utf-8">/.test(html) && /name="viewport"/.test(html), `${page.path} charset + viewport`);
  check(/<html lang="en">/.test(html), `${page.path} lang attribute`);

  for (const og of ['og:title', 'og:description', 'og:type', 'og:url', 'og:image', 'og:site_name', 'og:locale']) {
    if (!new RegExp(`<meta property="${og}"`).test(html)) check(false, `${page.path} ${og}`);
  }
  for (const tw of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) {
    if (!new RegExp(`<meta name="${tw}"`).test(html)) check(false, `${page.path} ${tw}`);
  }
  check(/rel="icon"[^>]*favicon\.ico/.test(html) && /rel="icon"[^>]*favicon\.svg/.test(html), `${page.path} ICO + SVG favicons`);
  check(/rel="apple-touch-icon"/.test(html) && /rel="manifest"/.test(html), `${page.path} apple-touch-icon + manifest link`);

  const h1Count = (html.match(/<h1[\s>]/g) ?? []).length;
  check(h1Count === 1, `${page.path} exactly one h1 (found ${h1Count})`);
  check(/<header/.test(html) && /<nav aria-label="Main"/.test(html) && /<main id="main">/.test(html) && /<footer/.test(html), `${page.path} header/nav/main/footer landmarks`);
  check(/class="skip-link" href="#main"/.test(html), `${page.path} skip link`);
  check(/id="view-announcer"[^>]*aria-live="polite"/.test(html), `${page.path} polite live region for the dynamic title`);
  check(!/DRAFT — not legal advice\./.test(html), `${page.path} no DRAFT banner on public pages (owner removed it 20 Oct 2026; docs/legal keep their banner line)`);
  check(/assets\/rowta\.js/.test(html), `${page.path} title-announcement script referenced`);

  const robots = /<meta name="robots" content="([^"]*)">/.exec(html)?.[1] ?? '';
  if (page.noindex) check(robots.includes('noindex'), `${page.path} noindex (W2)`);
  else check(robots.includes('index, follow'), `${page.path} indexable`);
}

// Unique titles
const seen = new Map();
for (const [key, title] of titles) {
  if (seen.has(title)) check(false, `unique title: "${title}" used by ${seen.get(title)} and ${key}`);
  seen.set(title, key);
}
check(new Set(titles.values()).size === titles.size, `all ${titles.size} titles unique`);

// Canonicals share the base from PUBLIC_WEB_URL (never hard-coded)
const bases = new Set();
for (const html of htmlByKey.values()) {
  const canonical = /<link rel="canonical" href="([^"]+)">/.exec(html)?.[1] ?? '';
    bases.add(canonical.replace(/(\/404\.html|\/privacy\/|\/terms\/|\/billing-terms\/|\/delete-account\/|\/subprocessors\/|\/data-retention\/|\/accessibility\/|\/contact\/|\/magic|\/invite\/|\/billing\/complete|\/)$/, ''));
}
check(bases.size === 1, `one canonical base across pages (found ${bases.size})`);
const base = [...bases][0];
if (process.env.PUBLIC_WEB_URL) {
  check(base === process.env.PUBLIC_WEB_URL.replace(/\/+$/, ''), `canonical base equals PUBLIC_WEB_URL (${base})`);
}

// Landing: JSON-LD parses and names Rowta
const landing = htmlByKey.get('index') ?? '';
const jsonLd = /<script type="application\/ld\+json">([^<]+)<\/script>/.exec(landing)?.[1];
let jsonLdOk = false;
try {
  const parsed = JSON.parse(jsonLd ?? '');
  const names = (parsed['@graph'] ?? []).map((node) => node.name);
  jsonLdOk = names.includes('Rowta') && (parsed['@graph'] ?? []).some((node) => node['@type'] === 'SoftwareApplication');
} catch {
  jsonLdOk = false;
}
check(jsonLdOk, 'landing JSON-LD parses and includes WebSite + SoftwareApplication (W1)');

// Landing: og:url equals canonical; type website
const landingCanonical = /<link rel="canonical" href="([^"]+)">/.exec(landing)?.[1];
const landingOgUrl = /<meta property="og:url" content="([^"]+)">/.exec(landing)?.[1];
check(landingCanonical === landingOgUrl, 'landing og:url equals canonical');

process.exit(failures === 0 ? 0 : 1);
