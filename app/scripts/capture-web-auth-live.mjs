// PHASE 2 APP-VIEWS SCREENSHOT MATRIX — the ONE AuthPage's FIVE states at both sizes of the phone/
// desktop matrix, driven through the REAL machine against the LIVE API:
//   - "verify-code" is reached by an actual sign-up (server-validated form, ZZ country chosen from
//     the SERVER's list in the BottomSheet, uniform message + countdown on arrival);
//   - "reset-code" is reached by an actual forgot request (email hint + code entry + resend line).
//
// WEB RENDER ONLY. These files prove web render and state-machine travel only. They are NOT Android
// captures and carry no TalkBack, no hardware-Back and no font-scale evidence; every filename says
// so ("web-render-not-android"). Saved with the "-p2" suffix so the Phase 1 matrix files stay intact.
//
// Prerequisites (each checked, failures name the command):
//   1. npm run -w @rowta/server start                      -> API on 127.0.0.1:3000
//   2. from app/: EXPO_PUBLIC_API_URL=http://127.0.0.1:3000 npx expo start --web --port 8082
//   3. from app/: node scripts/capture-web-auth-live.mjs
// Browser: system Edge/Chrome via puppeteer-core (dev-only, exact-pinned, no Chromium download).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, '..', 'docs', 'ui-matrix');
const BASE_URL = process.env.ROWTA_WEB_URL ?? 'http://localhost:8082';
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:3000';

const VIEWPORTS = [
  { name: '360x800', width: 360, height: 800, isMobile: true },
  { name: '1280x800', width: 1280, height: 800, isMobile: false },
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

async function bothUp() {
  let api;
  try {
    const response = await fetch(`${API_URL}/health`, { method: 'GET' });
    api = response.ok;
  } catch {
    api = false;
  }
  let web;
  try {
    const response = await fetch(BASE_URL, { method: 'GET' });
    web = response.ok;
  } catch {
    web = false;
  }
  return { api, web };
}

async function settle(page) {
  await page.waitForSelector('h1, [role="heading"]', { timeout: 20_000 }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready);
  await new Promise((resolve) => setTimeout(resolve, 300));
}

/** Click the in-page link whose leaf text node equals `label` (the RNW Pressable renders its text). */
async function clickLink(page, label) {
  await page.waitForFunction(
    (wanted) => {
      const matches = [...document.querySelectorAll('*')].filter(
        (element) => element.children.length === 0 && element.textContent?.trim() === wanted,
      );
      if (matches.length === 0) return false;
      matches[0].click();
      return true;
    },
    { timeout: 20_000 },
    label,
  );
  await new Promise((resolve) => setTimeout(resolve, 400));
}

/** Type into the TextInput whose accessible name (aria-label from accessibilityLabel) is `label`. */
async function fill(page, label, value) {
  const selector = `input[aria-label="${label}"]`;
  await page.waitForSelector(selector, { timeout: 20_000 });
  await page.type(selector, value, { delay: 15 });
}

/** Press the button whose accessible name is `label` (role=button + aria-label). */
async function pressButton(page, label) {
  const selector = `[role="button"][aria-label="${label}"]`;
  await page.waitForSelector(selector, { timeout: 20_000 });
  await page.click(selector);
}

async function chooseCountry(page) {
  console.log('  step: click country field');
  await page.waitForSelector('[data-testid="field-country"]', { timeout: 20_000 });
  await page.click('[data-testid="field-country"]');
  console.log('  step: wait country row');
  await page.waitForSelector('[data-testid="country-row-ZZ"]', { timeout: 20_000 });
  // The sheet animates in: give it a beat, then click the row with retries (mid-transition nodes
  // are momentarily "not clickable" in the headless browser).
  await new Promise((resolve) => setTimeout(resolve, 700));
  let clicked = false;
  for (let attempt = 0; attempt < 5 && !clicked; attempt += 1) {
    try {
      const row = await page.$('[data-testid="country-row-ZZ"]');
      if (row === null) throw new Error('row disappeared');
      await row.evaluate((element) => element.scrollIntoView({ block: 'center' }));
      await row.click();
      clicked = true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  if (!clicked) throw new Error('country row ZZ never became clickable (sheet covered or zero-height?)');
  await new Promise((resolve) => setTimeout(resolve, 300));
}

async function waitForCodeStep(page) {
  // The code input appears once the server accepted the request and the machine moved on.
  await page.waitForSelector('input[aria-label="6-digit code"]', { timeout: 30_000 });
}

function uniqueEmail(tag) {
  return `e2e-cap-${tag}-${Date.now().toString(36)}@e2e.test`;
}

/** The five states and how to reach each from a fresh load (one fresh page per state). */
const STATES = [
  { name: 'sign-in', flow: async () => {} },
  { name: 'create-account', flow: (page) => clickLink(page, 'Create account') },
  {
    name: 'verify-code',
    flow: async (page) => {
      console.log('  step: link create-account');
      await clickLink(page, 'Create account');
      console.log('  step: fill name');
      await fill(page, 'Name', 'Capture Runner');
      console.log('  step: fill email');
      await fill(page, 'Email', uniqueEmail('verify'));
      console.log('  step: fill password');
      await fill(page, 'Password', 'E2ePassw0rd!x');
      console.log('  step: fill confirm');
      await fill(page, 'Confirm new password', 'E2ePassw0rd!x');
      await chooseCountry(page);
      console.log('  step: submit signup');
      await pressButton(page, 'Create account');
      await waitForCodeStep(page);
    },
  },
  { name: 'forgot-password', flow: (page) => clickLink(page, 'Forgot password') },
  {
    name: 'reset-code',
    flow: async (page) => {
      await clickLink(page, 'Forgot password');
      await fill(page, 'Email', uniqueEmail('reset'));
      await pressButton(page, 'Email me a link');
      await waitForCodeStep(page);
    },
  },
];

async function main() {
  const { api, web } = await bothUp();
  if (!api) {
    console.error(`MISSING API: ${API_URL}/health did not answer. Start it: npm run -w @rowta/server start`);
    process.exit(2);
  }
  if (!web) {
    console.error(`MISSING web server: ${BASE_URL} did not answer. Start it from app/:`);
    console.error('  EXPO_PUBLIC_API_URL=http://127.0.0.1:3000 npx expo start --web --port 8082');
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
        try {
          await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 120_000 });
          await state.flow(page);
          await settle(page);
        } catch (error) {
          console.error(`FAILED state=${state.name} ${viewport.name}: ${error?.message ?? String(error)}`);
          await page.close();
          throw new Error(`capture failed for ${state.name}-${viewport.name}`, { cause: error });
        }
        const file = path.join(OUT_DIR, `auth-${state.name}-${viewport.name}-web-render-not-android-p2.png`);
        await page.screenshot({ path: file });
        console.log(`saved ${path.relative(path.join(ROOT, '..'), file)}`);
        if (process.env.ROWTA_DUMP_HTML === '1') {
          const dump = path.join(process.env.TEMP ?? '.', `capture-dump-${state.name}-${viewport.name}-${Date.now()}.html`);
          fs.writeFileSync(dump, await page.content());
          console.log(`dump ${dump}`);
        }
        await page.close();
      }
    }
    console.log('capture result: 10 screenshots (5 states x 2 viewports, web render only)');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`FAILED: ${error?.message ?? String(error)}`);
  process.exit(1);
});
