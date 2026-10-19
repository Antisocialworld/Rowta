// WEB-RENDER SCREENSHOT MATRIX (Phase 1 rework evidence) — captures the ONE AuthPage's three FORM states at the
// two sizes of the phone/desktop matrix, straight from the running Expo web server.
//
// IMPORTANT: these files prove WEB RENDER ONLY. They are NOT Android captures and carry no TalkBack, no
// hardware-Back and no font-scale evidence; every filename says so ("web-render-not-android"). The
// adb-based script scripts/capture-ui-matrix.mjs stays the Android path and still needs a connected device.
//
// What it drives: the same machine the app uses — state switches happen by pressing the real text LINKS inside
// the card (item 3/4 of the rework): "Create account" and "Forgot password" from the sign-in form.
//
// Browser: the system Edge (or Chrome) via puppeteer-core — NO bundled Chromium download. Dev-only dependency,
// pinned exactly in @rowta/app (puppeteer-core 25.14.0, Apache-2.0), never shipped in the app bundle.
//
// Run from the app directory, with the web server already up (see docs/gates/phase-1.md section 6b):
//   npx expo start --web --port 8082     (in one shell)
//   node scripts/capture-web-matrix.mjs  (in another)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, '..', 'docs', 'ui-matrix');
const BASE_URL = process.env.ROWTA_WEB_URL ?? 'http://localhost:8082';

const VIEWPORTS = [
  { name: '360x800', width: 360, height: 800, isMobile: true },
  { name: '1280x800', width: 1280, height: 800, isMobile: false },
];

/** The three FORM states and how to reach each from a fresh load of the page. */
const STATES = [
  { name: 'sign-in', clickText: null },
  { name: 'create-account', clickText: 'Create account' },
  { name: 'forgot-password', clickText: 'Forgot password' },
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
    console.error('Set ROWTA_WEB_BROWSER to an Edge/Chrome executable and re-run.');
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
  // fonts (Poppins) + layout: the card heading is the stable marker of the one page.
  await page.waitForSelector('h1, [role="heading"]', { timeout: 15_000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready);
  await new Promise((resolve) => setTimeout(resolve, 300));
}

async function main() {
  if (!(await serverUp())) {
    console.error(`MISSING web server: ${BASE_URL} did not answer. Start it first: npx expo start --web --port 8082`);
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
  try {
    for (const viewport of VIEWPORTS) {
      for (const state of STATES) {
        const page = await browser.newPage();
        await page.setViewport({
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          isMobile: viewport.isMobile,
        });
        await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 120_000 });
        if (state.clickText !== null) {
          // drive the machine through the real link inside the card (a fresh page per state keeps runs isolated);
          // the leaf text node's click bubbles to the RNW Pressable role="link" and fires the React handler.
          await page.waitForFunction(
            (label) => {
              const matches = [...document.querySelectorAll('*')].filter(
                (element) => element.children.length === 0 && element.textContent?.trim() === label,
              );
              if (matches.length === 0) return false;
              matches[0].click();
              return true;
            },
            { timeout: 15_000 },
            state.clickText,
          );
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        await settle(page);
        const file = path.join(OUT_DIR, `auth-${state.name}-${viewport.name}-web-render-not-android.png`);
        await page.screenshot({ path: file });
        console.log(`saved ${path.relative(path.join(ROOT, '..'), file)}`);
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`FAILED: ${error?.message ?? String(error)}`);
  process.exit(1);
});
