// test-web-app-button — build-level proof for the DEV-ONLY WEB_APP_URL setting (owner decision
// 28 Oct 2026). Runs real web/build.mjs processes with controlled environments:
//   * unset: exit 0, no second-button markup anywhere, and the built token-page.js is byte-identical
//     to web/src/token-page.js (the default build matches today's output);
//   * set to http://localhost:8081: exit 0, the hidden "Open in the web app" link exists on both
//     token pages with the origin attribute and rel="noreferrer noopener", and the runtime builds
//     the href as WEB_APP_URL + "/" + kind + "/" + token;
//   * invalid values (path, query, non-http scheme, credentials) fail the build without echoing the
//     value (it could hold credentials, S1);
//   * https PUBLIC_WEB_URL + WEB_APP_URL fails the build (the button must never ship);
//   * no token appears in any generated file.
// Leaves web/dist as the DEFAULT unset build when it finishes. Run:  node web/tests/test-web-app-button.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..');
const ROOT = path.resolve(WEB, '..');
const DIST = path.join(WEB, 'dist');

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

function runBuild(webAppUrl, publicWebUrl) {
  const env = { ...process.env };
  delete env.WEB_APP_URL;
  delete env.PUBLIC_WEB_URL;
  if (webAppUrl !== undefined) env.WEB_APP_URL = webAppUrl;
  if (publicWebUrl !== undefined) env.PUBLIC_WEB_URL = publicWebUrl;
  const result = spawnSync(process.execPath, ['web/build.mjs'], { cwd: ROOT, env, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function textFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return textFiles(full);
    return /\.(html|js|xml|txt|css|webmanifest)$/.test(entry.name) ? [full] : [];
  });
}

const LOCAL_PUBLIC = 'http://localhost:8321';
const LOCAL_WEB_APP = 'http://localhost:8081';
const WEB_APP_LINK_RE = /<a id="open-web-app" class="button" data-web-app-origin="http:\/\/localhost:8081" rel="noreferrer noopener" hidden>Open in the web app<\/a>/;
const TOKEN_LIKE = /[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{20,}/;

// --- 1. invalid values: the build fails with a clear message and never echoes the raw value -----------
for (const [label, value] of [
  ['a path', 'http://localhost:8081/app'],
  ['a query', 'http://localhost:8081?x=1'],
  ['a fragment', 'http://localhost:8081#frag'],
  ['a non-http scheme', 'ftp://example.com'],
  ['credentials', 'http://user:pass@example.com'],
]) {
  const result = runBuild(value, LOCAL_PUBLIC);
  check(result.status !== 0, `WEB_APP_URL with ${label} fails the build (exit ${result.status})`);
  check(result.stderr.includes('WEB_APP_URL'), `WEB_APP_URL with ${label}: the error names the setting`);
  check(
    !result.stderr.includes('pass@') && !result.stderr.includes('user:pass'),
    `WEB_APP_URL with ${label}: the raw value is never echoed in the error (S1)`,
  );
}

// --- 2. production guard: https PUBLIC_WEB_URL + WEB_APP_URL refuses to build -------------------------
const production = runBuild(LOCAL_WEB_APP, 'https://rowta.example');
check(production.status !== 0, 'https PUBLIC_WEB_URL + WEB_APP_URL fails the build (exit ' + production.status + ')');
check(
  production.stderr.includes('WEB_APP_URL') && production.stderr.toLowerCase().includes('development'),
  'https guard error states this is a development convenience that must never ship',
);

// --- 3. unset: exit 0, default output (no web-app markup, base script byte-identical) ------------------
const unset = runBuild(undefined, LOCAL_PUBLIC);
check(unset.status === 0, 'WEB_APP_URL unset builds (exit 0)');
const unsetMagic = fs.readFileSync(path.join(DIST, 'magic', 'index.html'), 'utf8');
const unsetInvite = fs.readFileSync(path.join(DIST, 'invite', 'index.html'), 'utf8');
const unsetScript = fs.readFileSync(path.join(DIST, 'assets', 'token-page.js'), 'utf8');
check(!unsetMagic.includes('open-web-app') && !unsetInvite.includes('open-web-app'), 'unset: no second button on either token page');
check(!unsetScript.includes('open-web-app'), 'unset: the built token-page.js contains no web-app code');
const sourceScript = fs.readFileSync(path.join(WEB, 'src', 'token-page.js'), 'utf8');
check(Buffer.compare(Buffer.from(unsetScript), Buffer.from(sourceScript)) === 0, 'unset: built token-page.js is byte-identical to web/src/token-page.js (default output matches today)');

// --- 4. set: exit 0, button present, runtime href builder present --------------------------------------
const set = runBuild(LOCAL_WEB_APP, LOCAL_PUBLIC);
check(set.status === 0, 'WEB_APP_URL set to http://localhost:8081 builds (exit 0)');
const setMagic = fs.readFileSync(path.join(DIST, 'magic', 'index.html'), 'utf8');
const setInvite = fs.readFileSync(path.join(DIST, 'invite', 'index.html'), 'utf8');
const setScript = fs.readFileSync(path.join(DIST, 'assets', 'token-page.js'), 'utf8');
check(WEB_APP_LINK_RE.test(setMagic), '/magic carries the hidden web-app link with origin + rel=noreferrer noopener');
check(WEB_APP_LINK_RE.test(setInvite), '/invite carries the hidden web-app link with origin + rel=noreferrer noopener');
check(!/open-web-app[^>]*\shref=/.test(setMagic + setInvite), 'set: no href written into the HTML (runtime-built only)');
check(
  setScript.includes('open-web-app') && setScript.includes("base + '/' + kind + '/' + token"),
  'set: the runtime builds the href as WEB_APP_URL + "/" + kind + "/" + token',
);
check(
  setScript.includes('link.hidden = false') && setScript.includes('SAFE'),
  'set: the link is revealed only after the same SAFE token validation',
);
check(setScript.includes('console') === false, 'set: the appended runtime never writes to the console');
console.log(`INFO: generated href pattern = ${LOCAL_WEB_APP}/magic/xxxx and ${LOCAL_WEB_APP}/invite/xxxx (token replaced by xxxx)`);

// --- 5. no token in any generated file (set build) -----------------------------------------------------
let tokenHits = [];
for (const file of textFiles(DIST)) {
  const text = fs.readFileSync(file, 'utf8');
  if (TOKEN_LIKE.test(text) || text.includes('tok_123-abc')) tokenHits.push(path.relative(ROOT, file));
}
check(tokenHits.length === 0, `no token-shaped string in any generated file (${tokenHits.length} hit(s))`);

// --- 6. restore the default build state ----------------------------------------------------------------
const restore = runBuild(undefined, LOCAL_PUBLIC);
check(restore.status === 0, 'final unset rebuild restores the default dist (exit 0)');

process.exit(failures === 0 ? 0 : 1);
