// test-web-app-behaviour — REAL BEHAVIOUR proof for the DEV-ONLY "Open in the web app" link
// (owner decision 28 Oct 2026). Runs the BUILT dist/assets/token-page.js inside node:vm with a
// fake window/document/location/history that mimics the state a DEFERRED script sees on the real
// page: readyState 'interactive', the DOM parsed, and history.replaceState actually rewriting the
// address the way a browser's address bar changes. Proves, for invite and magic:
//   * the web-app capture runs BEFORE the base script strips the address (the web-app link
//     reveals with the right href — this FAILED under the old appended order);
//   * the rowta:// deep link still reveals;
//   * history.replaceState still strips the address;
//   * with WEB_APP_URL unset the web-app link does not exist;
//   * a token-less page reveals nothing.
// A simulated runtime — NOT a real browser (the real-browser walkthrough stays
// web/scripts/verify-token-runtime.mjs). Run:  node web/tests/test-web-app-behaviour.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..');
const ROOT = path.resolve(WEB, '..');
const DIST = path.join(WEB, 'dist');

const WEB_APP_ORIGIN = 'http://localhost:8081';
const FAKE_TOKEN = 'abc123'; // obviously fake (also the task's example)

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

function build(webAppUrl) {
  const env = { ...process.env };
  delete env.WEB_APP_URL;
  delete env.PUBLIC_WEB_URL;
  env.PUBLIC_WEB_URL = 'http://localhost:8321';
  if (webAppUrl !== undefined) env.WEB_APP_URL = webAppUrl;
  const result = spawnSync(process.execPath, ['web/build.mjs'], { cwd: ROOT, env, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(result.stderr ?? result.stdout ?? 'build failed');
    process.exit(2);
  }
}

function makeElement() {
  const attrs = new Map();
  return {
    hidden: true,
    textContent: '',
    href: null,
    focused: false,
    getAttribute(name) {
      return attrs.get(name) ?? null;
    },
    setAttribute(name, value) {
      attrs.set(name, value);
    },
    focus() {
      this.focused = true;
    },
  };
}

/** A fake page in the state a deferred script sees: DOM parsed (readyState 'interactive') and
 *  replaceState rewriting the address (the browser behaviour that the old order broke on). */
function makePage({ kind, pathname, hash, webAppOrigin }) {
  const elements = new Map();
  const openApp = makeElement();
  elements.set('open-app', openApp);
  elements.set('token-heading', makeElement());
  elements.set('token-notice', makeElement());
  if (webAppOrigin !== undefined) {
    const webAppLink = makeElement();
    webAppLink.setAttribute('data-web-app-origin', webAppOrigin);
    elements.set('open-web-app', webAppLink);
  }
  const location = { pathname, search: '', hash };
  const replaceStateCalls = [];
  const window = { location };
  const document = {
    readyState: 'interactive', // deferred scripts run after parsing, before DOMContentLoaded
    head: { appendChild() {} },
    body: {
      getAttribute(name) {
        return name === 'data-token-kind' ? kind : null;
      },
    },
    createElement(tag) {
      return { tagName: tag };
    },
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    addEventListener() {},
  };
  const history = {
    replaceState(_state, _title, url) {
      replaceStateCalls.push(String(url));
      const [pathPart, hashPart] = String(url).split('#');
      location.pathname = pathPart;
      location.hash = hashPart === undefined ? '' : `#${hashPart}`;
    },
  };
  return { kind, window, document, history, location, elements, replaceStateCalls };
}

function runScript(script, page) {
  const context = {
    window: page.window,
    document: page.document,
    history: page.history,
    location: page.location,
  };
  vm.createContext(context);
  vm.runInContext(script, context, { filename: 'dist/assets/token-page.js' });
}

const setBuild = () => {
  build(WEB_APP_ORIGIN);
  return fs.readFileSync(path.join(DIST, 'assets', 'token-page.js'), 'utf8');
};
const unsetBuild = () => {
  build(undefined);
  return fs.readFileSync(path.join(DIST, 'assets', 'token-page.js'), 'utf8');
};

// --- structural order: the capture block must sit BEFORE the base deep-link code ----------------------
const setScript = setBuild();
const captureIndex = setScript.indexOf('data-web-app-origin');
const baseIndex = setScript.indexOf("rowta://'");
check(captureIndex !== -1 && captureIndex < baseIndex, 'built script: the web-app capture runs BEFORE the base deep-link code (prepended, not appended)');

// --- invite: /invite#abc123 with WEB_APP_URL set ------------------------------------------------------
{
  const page = makePage({ kind: 'invite', pathname: '/invite', hash: `#${FAKE_TOKEN}`, webAppOrigin: WEB_APP_ORIGIN });
  runScript(setScript, page);
  const openApp = page.elements.get('open-app');
  const webApp = page.elements.get('open-web-app');
  check(openApp.href === `rowta://invite/${FAKE_TOKEN}` && openApp.hidden === false, 'invite: the rowta:// deep link is revealed');
  check(
    webApp !== undefined && webApp.href === `${WEB_APP_ORIGIN}/invite#${FAKE_TOKEN}` && webApp.hidden === false,
    `invite: the web-app link reveals with href ${WEB_APP_ORIGIN}/invite#<token>`,
  );
  check(page.replaceStateCalls.includes('/invite') && page.location.hash === '', 'invite: history.replaceState still strips the fragment');
}

// --- magic: /magic#abc123 with WEB_APP_URL set ----------------------------------------------------------
{
  const page = makePage({ kind: 'magic', pathname: '/magic', hash: `#${FAKE_TOKEN}`, webAppOrigin: WEB_APP_ORIGIN });
  runScript(setScript, page);
  const openApp = page.elements.get('open-app');
  const webApp = page.elements.get('open-web-app');
  check(openApp.href === `rowta://magic/${FAKE_TOKEN}` && openApp.hidden === false, 'magic: the rowta:// deep link is revealed');
  check(
    webApp !== undefined && webApp.href === `${WEB_APP_ORIGIN}/magic/${FAKE_TOKEN}` && webApp.hidden === false,
    `magic: the web-app link reveals with href ${WEB_APP_ORIGIN}/magic/<token>`,
  );
  check(page.replaceStateCalls.includes('/magic') && page.location.hash === '', 'magic: history.replaceState still strips the fragment');
}

// --- set build, no token: nothing may reveal -------------------------------------------------------------
{
  const page = makePage({ kind: 'invite', pathname: '/invite', hash: '', webAppOrigin: WEB_APP_ORIGIN });
  runScript(setScript, page);
  check(page.elements.get('open-app').hidden === true, 'no token: the rowta:// button stays hidden');
  check(page.elements.get('open-web-app').hidden === true, 'no token: the web-app button stays hidden');
}

// --- unset build: the web-app link does not exist, the base page still works ------------------------------
const unsetScript = unsetBuild();
check(!unsetScript.includes('open-web-app'), 'unset: the built script contains no web-app code');
{
  const page = makePage({ kind: 'invite', pathname: '/invite', hash: `#${FAKE_TOKEN}`, webAppOrigin: undefined });
  runScript(unsetScript, page);
  const openApp = page.elements.get('open-app');
  check(openApp.href === `rowta://invite/${FAKE_TOKEN}` && openApp.hidden === false, 'unset: the base rowta:// deep link still reveals');
  check(page.elements.has('open-web-app') === false, 'unset: no web-app link element exists');
  check(page.replaceStateCalls.includes('/invite') && page.location.hash === '', 'unset: the address is still stripped');
}

// --- restore the default build state ----------------------------------------------------------------------
build(undefined);
check(fs.readFileSync(path.join(DIST, 'assets', 'token-page.js'), 'utf8') === unsetScript, 'final unset rebuild restores the default dist');

process.exit(failures === 0 ? 0 : 1);
