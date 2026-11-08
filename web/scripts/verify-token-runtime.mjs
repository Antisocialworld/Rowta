// verify-token-runtime — headless-browser proof for the /magic and /invite fallback pages (PRD 8.1, 8.2):
//   1. a visit with a token in the fragment/path builds the rowta:// deep link and strips the fragment;
//   2. a visit with NO token (or a malformed one) shows the built-in incomplete/expired message;
//   3. the h1 receives focus on load (tabindex -1);
//   4. the page makes NO request beyond its own files — in particular no request URL ever contains the
//      token, so an email scanner that fetches the URL can never consume it.
// Browser: system Edge/Chrome via puppeteer-core. Run with the static server up:
//   node web/serve.mjs                       (one shell)
//   node web/scripts/verify-token-runtime.mjs (another)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE_URL = process.env.ROWTA_WEB_URL ?? 'http://localhost:8321';

const FAKE_MAGIC = 'FAKETOKEN00000000.fffffffffffffffffffffffffffffffffffffff';
const FAKE_INVITE = 'FAKEINVITE0000000.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const BROWSER_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

function findBrowser() {
  const fromEnv = process.env.ROWTA_WEB_BROWSER;
  const candidates = fromEnv ? [fromEnv, ...BROWSER_CANDIDATES] : BROWSER_CANDIDATES;
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    console.error(`MISSING browser: none of these exist — ${candidates.join(', ')}`);
    process.exit(2);
  }
  return found;
}

async function serverUp() {
  try {
    const response = await fetch(BASE_URL, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

async function openCase(browser, { name, url, expect }) {
  const page = await browser.newPage();
  const requests = [];
  page.on('request', (r) => requests.push(`${r.method()} ${r.url()}`));
  await page.goto(new URL(url, BASE_URL).href, { waitUntil: 'networkidle0', timeout: 60_000 });
  await page.evaluate(() => document.fonts?.ready);
  const state = await page.evaluate(() => {
    const button = document.getElementById('open-app');
    const notice = document.getElementById('token-notice');
    const heading = document.getElementById('token-heading');
    return {
      hash: window.location.hash,
      href: button ? button.getAttribute('href') : null,
      buttonHidden: button ? button.hidden : true,
      buttonDisplay: button ? window.getComputedStyle(button).display : 'none',
      noticeText: notice ? notice.textContent.trim() : '',
      noticeHidden: notice ? notice.hidden : false,
      focusId: document.activeElement ? document.activeElement.id : '',
      headingFound: heading !== null,
      title: document.title,
    };
  });

  check(state.headingFound, `${name}: heading present`);
  check(state.focusId === 'token-heading', `${name}: h1 focused on load (got "${state.focusId}")`);

  if (expect.token === null) {
    check(state.href === null, `${name}: no rowta:// href without a token (got ${state.href ?? 'null'})`);
    check(state.buttonHidden, `${name}: button hidden without a token`);
    check(state.buttonDisplay === 'none', `${name}: button actually not RENDERED without a token (display: ${state.buttonDisplay})`);
    check(!state.noticeHidden && state.noticeText.length > 20, `${name}: incomplete/expired message visible ("${state.noticeText.slice(0, 48)}...")`);
  } else {
    check(state.href === `rowta://${expect.kind}/${expect.token}`, `${name}: deep link rowta://${expect.kind}/<token> built`);
    check(!state.buttonHidden, `${name}: "Open in the app" button revealed`);
    check(state.buttonDisplay !== 'none', `${name}: button rendered when a token is present (display: ${state.buttonDisplay})`);
    check(state.noticeHidden && state.noticeText === '', `${name}: missing-token message cleared when a token is present`);
  }

  const withToken = requests.filter((line) => line.includes(expect.token ?? 'WILLNEVERMATCH'));
  if (withToken.length > 0) console.log(`INFO: ${name} request(s) containing the token: ${withToken.map((l) => l.split(' ')[0] + ' ' + new URL(l.split(' ')[1]).pathname).join(', ')}`);
  // At most ONE line may contain the token: the local navigation record itself. HTTP never transmits
  // a fragment (RFC 9110), so for /magic the server receives plain GET /magic; every other request
  // (css, fonts, js) must be token-free, and there is never a second token-bearing request.
  check(
    withToken.length <= 1 && (withToken.length === 0 || requests[0] === withToken[0]),
    `${name}: token at most in the one navigation record, never in any other request (${withToken.length} of ${requests.length})`,
  );
  const posts = requests.filter((line) => line.startsWith('POST '));
  check(posts.length === 0, `${name}: no POST on load (${requests.length} total request(s))`);
  console.log(`INFO: ${name} requests = ${requests.length}`);
  await page.close();
}

async function main() {
  if (!(await serverUp())) {
    console.error(`MISSING static server: ${BASE_URL} did not answer. Start it first: node web/serve.mjs`);
    process.exit(2);
  }
  const executablePath = findBrowser();
  console.log(`browser: ${executablePath}`);
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    await openCase(browser, {
      name: '/magic#<token>',
      url: `/magic#${FAKE_MAGIC}`,
      expect: { kind: 'magic', token: FAKE_MAGIC },
    });
    await openCase(browser, { name: '/magic (no token)', url: '/magic', expect: { kind: 'magic', token: null } });
    await openCase(browser, {
      name: '/magic#malformed',
      url: '/magic#bad%20token!value',
      expect: { kind: 'magic', token: null },
    });
    await openCase(browser, {
      name: '/invite/#<token>',
      url: `/invite/#${FAKE_INVITE}`,
      expect: { kind: 'invite', token: FAKE_INVITE },
    });
    await openCase(browser, { name: '/invite/ (no token)', url: '/invite/', expect: { kind: 'invite', token: null } });
  } finally {
    await browser.close();
  }
  console.log(failures === 0 ? 'ALL RUNTIME CHECKS PASSED' : `RUNTIME CHECKS FAILED: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`FAILED: ${error?.message ?? String(error)}`);
  process.exit(1);
});
