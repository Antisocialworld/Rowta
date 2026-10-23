// test-token-pages — proof for the two token fallback pages (PRD 8.1, 8.2, 10; rules W2, A13, S9):
//   * both pages are built, noindex, and absent from the sitemap (robots still Allow-crawls them);
//   * the runtime makes NO network request on load (static scan — a scanner visit consumes nothing);
//   * the token never appears in any built file, and the deep link exists only as runtime code;
//   * both pages work with no token (built-in incomplete/expired message, button hidden);
//   * no form/POST wiring on /magic (the web Sign-in button deviation is an owner decision, reported);
//   * no inline script content, no secrets (test-content-safety also sweeps every built HTML);
//   * serve.mjs and web/vercel.json carry X-Robots-Tag noindex, Referrer-Policy no-referrer,
//     Cache-Control no-store for exactly these two routes.
// Run:  node web/tests/test-token-pages.mjs   (after node web/build.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..');
const DIST = path.join(WEB, 'dist');

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

const magicHtml = fs.existsSync(path.join(DIST, 'magic', 'index.html'))
  ? fs.readFileSync(path.join(DIST, 'magic', 'index.html'), 'utf8')
  : '';
const inviteHtml = fs.existsSync(path.join(DIST, 'invite', 'index.html'))
  ? fs.readFileSync(path.join(DIST, 'invite', 'index.html'), 'utf8')
  : '';
const tokenScript = fs.existsSync(path.join(DIST, 'assets', 'token-page.js'))
  ? fs.readFileSync(path.join(DIST, 'assets', 'token-page.js'), 'utf8')
  : '';

check(magicHtml.length > 0, 'dist/magic/index.html built');
check(inviteHtml.length > 0, 'dist/invite/index.html built');
check(tokenScript.length > 0, 'dist/assets/token-page.js built');

// --- 1. noindex, not in sitemap, robots keeps Allow ------------------------------------------------
check(
  /<meta name="robots" content="noindex, nofollow">/.test(magicHtml),
  '/magic meta robots = noindex, nofollow (W2)',
);
check(
  /<meta name="robots" content="noindex, nofollow">/.test(inviteHtml),
  '/invite meta robots = noindex, nofollow (W2)',
);
const sitemap = fs.readFileSync(path.join(DIST, 'sitemap.xml'), 'utf8');
check(!sitemap.includes('/magic'), 'sitemap.xml excludes /magic');
check(!sitemap.includes('/invite'), 'sitemap.xml excludes /invite');
const robots = fs.readFileSync(path.join(DIST, 'robots.txt'), 'utf8');
check(robots.includes('Allow: /'), 'robots.txt keeps Allow: / (a blocked page cannot show its noindex)');
check(!/Disallow:/i.test(robots), 'robots.txt has no Disallow rule');

// --- 2. canonical = clean URL without the token ----------------------------------------------------
const landing = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const base = /<link rel="canonical" href="([^"]+)\/">/.exec(landing)?.[1] ?? '';
check(base.length > 0, `canonical base readable from the landing page (${base})`);
check(
  /<link rel="canonical" href="[^"]*\/magic">/.test(magicHtml),
  '/magic canonical is the clean URL without a token (.../magic)',
);
check(
  /<link rel="canonical" href="[^"]*\/invite\/">/.test(inviteHtml),
  '/invite canonical is the clean URL without a token (.../invite/)',
);

// --- 3. NO network request on load (static scan of the scripts the pages load) ---------------------
const NO_NETWORK = /\bfetch\s*\(|XMLHttpRequest|sendBeacon|\bWebSocket\b|EventSource|\bnavigator\.connection\b/;
for (const [name, text] of [
  ['dist/magic/index.html', magicHtml],
  ['dist/invite/index.html', inviteHtml],
  ['dist/assets/token-page.js', tokenScript],
  ['dist/assets/rowta.js', fs.readFileSync(path.join(DIST, 'assets', 'rowta.js'), 'utf8')],
]) {
  check(!NO_NETWORK.test(text), `${name} contains no network call (scanner visit consumes nothing)`);
}

// --- 4. no web sign-in POST and no form at all on /magic -------------------------------------------
check(!/<form[\s>]/i.test(magicHtml) && !/<form[\s>]/i.test(inviteHtml), 'token pages contain no <form>');
check(!/\saction=/i.test(magicHtml), '/magic has no form action (no web POST)');
check(!/\saction=/i.test(inviteHtml), '/invite has no form action (no web POST)');
check(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(magicHtml.replace(/<script type="application\/ld\+json">/g, '')), '/magic has no inline script content');
check(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(inviteHtml.replace(/<script type="application\/ld\+json">/g, '')), '/invite has no inline script content');

// --- 5. the token is never written into the HTML -----------------------------------------------------
const TOKEN_LIKE = /[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{20,}/;
check(!TOKEN_LIKE.test(magicHtml), '/magic HTML contains no selector.verifier shaped token');
check(!TOKEN_LIKE.test(inviteHtml), '/invite HTML contains no selector.verifier shaped token');
check(!/rowta:\/\//.test(magicHtml), '/magic HTML contains no rowta:// URL (built at runtime only)');
check(!/rowta:\/\//.test(inviteHtml), '/invite HTML contains no rowta:// URL (built at runtime only)');
check(tokenScript.includes("rowta://'"), 'token-page.js builds the rowta:// deep link at runtime');
check(tokenScript.includes('history.replaceState'), 'token-page.js strips the fragment with history.replaceState');
check(tokenScript.includes('location.hash'), 'token-page.js reads the fragment from location.hash only');
check(!/console\s*\./.test(tokenScript), 'token-page.js never writes to the console (no token logging)');
check(!/console\s*\./.test(magicHtml) && !/console\s*\./.test(inviteHtml), 'token pages never write to the console');

// --- 6. both pages work with no token (built-in message, button hidden) ------------------------------
const MAGIC_MISSING = 'This sign-in link is incomplete or has expired.';
const INVITE_MISSING = 'This invitation link is incomplete or has expired.';
check(magicHtml.includes(MAGIC_MISSING), '/magic shows the incomplete-or-expired message without a token');
check(inviteHtml.includes(INVITE_MISSING), '/invite shows the incomplete-or-expired message without a token');
check(magicHtml.includes('request a new sign-in link'), '/magic says in words how to request a new link');
check(inviteHtml.includes('send a new invitation'), '/invite says in words how to request a new link');
check(/<a id="open-app" class="button" hidden>Open in the app<\/a>/.test(magicHtml), '/magic button exists, is hidden until a token is read');
check(/<a id="open-app" class="button" hidden>Open in the app<\/a>/.test(inviteHtml), '/invite button exists, is hidden until a token is read');

// --- 7. no account-existence wording (A5, A6) --------------------------------------------------------
const FORBIDDEN = /incorrect (password|email)|wrong password|email not found|user not found|no account|account does not exist|already (registered|in use|exists|taken)/i;
check(!FORBIDDEN.test(magicHtml), '/magic never says whether an account exists');
check(!FORBIDDEN.test(inviteHtml), '/invite never says whether an account exists');

// --- 8. accessibility statics (X rules; NVDA itself is not verified here) ----------------------------
for (const [name, html] of [['/magic', magicHtml], ['/invite', inviteHtml]]) {
  const h1s = html.match(/<h1[\s>]/g) ?? [];
  check(h1s.length === 1, `${name} exactly one h1`);
  check(/<h1 id="token-heading" tabindex="-1">/.test(html), `${name} h1 is focusable with tabindex="-1"`);
  check(/id="token-notice" role="status" aria-live="polite"/.test(html), `${name} live region for the missing-token message`);
}

// --- 9. host configuration: headers for exactly these two routes --------------------------------------
const serveSrc = fs.readFileSync(path.join(WEB, 'serve.mjs'), 'utf8');
check(/x-robots-tag/.test(serveSrc) && /noindex, nofollow/.test(serveSrc), 'serve.mjs sends X-Robots-Tag noindex, nofollow');
check(/referrer-policy/.test(serveSrc) && /no-referrer/.test(serveSrc), 'serve.mjs sends Referrer-Policy no-referrer');
check(/cache-control/.test(serveSrc) && /no-store/.test(serveSrc), 'serve.mjs sends Cache-Control no-store');
check(/tokenRouteFile/.test(serveSrc), 'serve.mjs routes any /invite/<token> to the one static page');

const vercel = JSON.parse(fs.readFileSync(path.join(WEB, 'vercel.json'), 'utf8'));
const rewriteSources = (vercel.rewrites ?? []).map((r) => r.source);
check(rewriteSources.includes('/invite/:token'), 'vercel.json rewrites /invite/:token to the static page');
check(rewriteSources.includes('/magic'), 'vercel.json rewrites /magic to the static page');
const headerRules = vercel.headers ?? [];
const sources = headerRules.map((r) => r.source);
for (const route of ['/magic', '/magic/', '/invite', '/invite/', '/invite/:token']) {
  const rule = headerRules.find((r) => r.source === route);
  const values = new Map((rule?.headers ?? []).map((h) => [h.key, h.value]));
  check(
    rule !== undefined &&
      values.get('X-Robots-Tag') === 'noindex, nofollow' &&
      values.get('Referrer-Policy') === 'no-referrer' &&
      values.get('Cache-Control') === 'no-store',
    `vercel.json headers on ${route}: noindex/nofollow + no-referrer + no-store`,
  );
}
check(sources.includes('/magic/:token'), 'vercel.json also headers the /magic/:token path form');
check(!sources.some((s) => s === '/' || s === '/:path*'), 'vercel.json does not apply token headers site-wide');

// --- 10. both pages reference both scripts ------------------------------------------------------------
for (const [name, html] of [['/magic', magicHtml], ['/invite', inviteHtml]]) {
  check(/assets\/rowta\.js/.test(html), `${name} loads rowta.js (title announcer, W3)`);
  check(/assets\/token-page\.js/.test(html), `${name} loads token-page.js`);
}

process.exit(failures === 0 ? 0 : 1);
