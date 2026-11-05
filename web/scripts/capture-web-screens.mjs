// WEB-RENDER SCREENSHOTS (Phase 11 evidence) — the public static pages from web/serve.mjs at the two sizes of
// the phone/desktop matrix.
//
// These files prove WEB RENDER ONLY for the marketing/legal surface (they are NOT Android captures, carry no
// TalkBack evidence, and are separate from the app's Expo web render in docs/ui-matrix/ from Phase 1).
//
// Browser: system Edge/Chrome via puppeteer-core (pinned in @rowta/app, dev-only, never shipped).
// Run from the repo root, with the static server already up:
//   node web/serve.mjs                    (one shell)
//   node web/scripts/capture-web-screens.mjs  (another)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = path.join(ROOT, 'docs', 'ui-matrix');
const BASE_URL = process.env.ROWTA_WEB_URL ?? 'http://localhost:8321';

const VIEWPORTS = [
  { name: '360x800', width: 360, height: 800, isMobile: true },
  { name: '1280x800', width: 1280, height: 800, isMobile: false },
];

const PAGES = [
  { name: 'landing', url: '/' },
  { name: 'privacy', url: '/privacy/' },
  { name: 'delete-account', url: '/delete-account/' },
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

async function settle(page) {
  await page.waitForSelector('h1', { timeout: 15_000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready);
  await new Promise((resolve) => setTimeout(resolve, 300));
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
        await settle(page);
        const file = path.join(OUT_DIR, `web-${target.name}-${viewport.name}-web-render-not-android.png`);
        await page.screenshot({ path: file });
        saved += 1;
        console.log(`saved ${path.relative(ROOT, file)}`);
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`screenshots saved: ${saved} (expected ${VIEWPORTS.length * PAGES.length})`);
}

main().catch((error) => {
  console.error(`FAILED: ${error?.message ?? String(error)}`);
  process.exit(1);
});
