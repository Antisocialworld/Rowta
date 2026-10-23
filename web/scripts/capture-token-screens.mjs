// capture-token-screens — responsive WEB-RENDER screenshots (NOT Android) for the two token fallback
// pages at 320px (smallest supported), 360px (phone) and 1280px (desktop), with and without a token.
// Fake tokens only (P6). Output: docs/ui-matrix/web-<page>-<viewport>-web-render-not-android.png.
// Run from the repo root, with the static server up:
//   node web/serve.mjs                        (one shell)
//   node web/scripts/capture-token-screens.mjs (another)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = path.join(ROOT, 'docs', 'ui-matrix');
const BASE_URL = process.env.ROWTA_WEB_URL ?? 'http://localhost:8321';

const FAKE_MAGIC = 'FAKETOKEN00000000.fffffffffffffffffffffffffffffffffffffff';
const FAKE_INVITE = 'FAKEINVITE0000000.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const VIEWPORTS = [
  { name: '320x800', width: 320, height: 800, isMobile: true },
  { name: '360x800', width: 360, height: 800, isMobile: true },
  { name: '1280x800', width: 1280, height: 800, isMobile: false },
];

const PAGES = [
  { name: 'magic-with-token', url: `/magic#${FAKE_MAGIC}` },
  { name: 'magic-no-token', url: '/magic' },
  { name: 'invite-with-token', url: `/invite/${FAKE_INVITE}` },
  { name: 'invite-no-token', url: '/invite/' },
];

const BROWSER_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

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

async function main() {
  if (!(await serverUp())) {
    console.error(`MISSING static server: ${BASE_URL} did not answer. Start it first: node web/serve.mjs`);
    process.exit(2);
  }
  const executablePath = findBrowser();
  console.log(`browser: ${executablePath}`);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  let saved = 0;
  let overflowProblems = 0;
  try {
    for (const viewport of VIEWPORTS) {
      for (const target of PAGES) {
        const page = await browser.newPage();
        await page.setViewport({
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          isMobile: viewport.isMobile,
        });
        await page.goto(new URL(target.url, BASE_URL).href, { waitUntil: 'networkidle0', timeout: 60_000 });
        await page.evaluate(() => document.fonts?.ready);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (overflow > 1) {
          overflowProblems += 1;
          console.log(`OVERFLOW: ${target.name} at ${viewport.name} = ${overflow}px`);
        }
        const file = path.join(OUT_DIR, `web-${target.name}-${viewport.name}-web-render-not-android.png`);
        await page.screenshot({ path: file });
        saved += 1;
        console.log(`saved ${path.relative(ROOT, file)} (overflow ${overflow}px)`);
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`screenshots saved: ${saved} (expected ${VIEWPORTS.length * PAGES.length})`);
  console.log(overflowProblems === 0 ? 'NO HORIZONTAL OVERFLOW AT ANY SIZE' : `OVERFLOW PROBLEMS: ${overflowProblems}`);
  process.exit(overflowProblems === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`FAILED: ${error?.message ?? String(error)}`);
  process.exit(1);
});
