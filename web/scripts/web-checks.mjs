// WEB ACCESSIBILITY + ROBUSTNESS CHECKS (Phase 11 evidence) — keyboard-only tab order with visible focus,
// 44px targets in header/footer/nav, 200% text scaling without horizontal overflow, JavaScript-off rendering,
// and an axe-core run (WCAG 2.0/2.1 A + AA) on the landing and privacy pages.
//
// Browser: system Edge/Chrome via puppeteer-core (pinned in @rowta/app). axe-core is loaded from node_modules
// (npm i --no-save axe-core, dev-only, never shipped).
// Run from the repo root with the static server up:  node web/serve.mjs  then:
//   node web/scripts/web-checks.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE_URL = process.env.ROWTA_WEB_URL ?? 'http://localhost:8321';
const AXE_PATH = path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js');

const BROWSER_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

let failures = 0;
function check(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}

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

function focusSnapshot() {
  const element = document.activeElement;
  if (!element || element === document.body) return 'BODY';
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const inNav = element.closest('nav') !== null;
  return JSON.stringify({
    key: `${element.tagName}|${element.getAttribute('href') ?? ''}|${element.textContent?.trim().slice(0, 40) ?? ''}`,
    tag: element.tagName,
    href: element.getAttribute('href'),
    inNav,
    visible: rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight && rect.bottom > 0,
    outlineWidth: style.outlineWidth,
    outlineStyle: style.outlineStyle,
    rectHeight: Math.round(rect.height),
  });
}

async function keyboardWalk(page, maxStops = 40) {
  const stops = [];
  let firstKey = null;
  for (let i = 0; i < maxStops; i += 1) {
    await page.keyboard.press('Tab');
    const raw = await page.evaluate(focusSnapshot);
    if (raw === 'BODY') break;
    const stop = JSON.parse(raw);
    if (firstKey === null) firstKey = stop.key;
    else if (stop.key === firstKey) break; // wrapped around to the first stop
    stops.push(stop);
  }
  return stops;
}

async function main() {
  if (!(await serverUp())) {
    console.error(`MISSING static server: ${BASE_URL} did not answer. Start it first: node web/serve.mjs`);
    process.exit(2);
  }
  if (!fs.existsSync(AXE_PATH)) {
    console.error(`MISSING axe-core at ${AXE_PATH} — install with: npm i --no-save axe-core@4.10.3`);
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
    // ---- 1. Keyboard-only walkthrough on the landing page (X3, X4, X5, U7)
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 60_000 });
    await page.evaluate(() => document.fonts?.ready);

    const stops = await keyboardWalk(page);
    check(stops.length >= 10, `keyboard: tab stops reachable in order (${stops.length} stops, expected >= 10)`);
    check(
      (stops[0]?.href ?? '') === '#main',
      `keyboard: first tab stop is the skip link (got href=${stops[0]?.href ?? 'none'})`,
    );
    const noOutline = stops.filter(
      (stop) => stop.outlineStyle === 'none' || stop.outlineWidth === '0px' || stop.outlineWidth === '',
    );
    check(noOutline.length === 0, `keyboard: every tab stop shows a visible focus outline (${stops.length} checked)`);
    const invisible = stops.filter((stop) => !stop.visible);
    check(invisible.length === 0, 'keyboard: every tab stop is inside the viewport while focused');
    const smallNavTargets = stops.filter((stop) => stop.inNav && stop.rectHeight < 44);
    check(
      smallNavTargets.length === 0,
      `keyboard: nav tab targets are >= 44px tall (${
        stops.filter((stop) => stop.inNav).length
      } nav stops; inline prose links are exempt)`,
    );
    console.log(
      `INFO: tab order = ${stops
        .map((stop) => `${stop.tag}${stop.href ? `(${stop.href})` : ''}`)
        .join(' > ')}`,
    );
    await page.close();

    // ---- 2. 200% text scaling: default font 32px (2 x 16px), no horizontal overflow (X8, U10)
    for (const target of [
      { name: 'landing', url: '/' },
      { name: 'privacy', url: '/privacy/' },
    ]) {
      for (const viewport of [
        { name: '360x800', width: 360, height: 800 },
        { name: '1280x800', width: 1280, height: 800 },
      ]) {
        const scaled = await browser.newPage();
        await scaled.setViewport({ width: viewport.width, height: viewport.height });
        await scaled.goto(new URL(target.url, BASE_URL).href, { waitUntil: 'networkidle0', timeout: 60_000 });
        const client = await scaled.createCDPSession();
        await client.send('Page.setFontSizes', { fontSizes: { defaultFontSize: 32 } });
        await new Promise((resolve) => setTimeout(resolve, 200));
        const overflow = await scaled.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        check(overflow <= 1, `200% scaling: ${target.name} at ${viewport.name} has no horizontal overflow (${overflow}px)`);
        await scaled.close();
      }
    }

    // ---- 3. JavaScript off: content still renders (progressive enhancement, W6)
    const noJs = await browser.newPage();
    await noJs.setJavaScriptEnabled(false);
    await noJs.setViewport({ width: 360, height: 800 });
    await noJs.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 60_000 });
    const landingNoJs = await noJs.evaluate(() => ({
      h1: document.querySelector('h1')?.textContent?.trim() ?? '',
      links: document.querySelectorAll('a[href]').length,
      text: document.body.innerText.length,
    }));
    check(
      landingNoJs.h1.includes('Publish shifts') && landingNoJs.links >= 5 && landingNoJs.text > 300,
      `no-JS: landing renders content (${landingNoJs.links} links, ${landingNoJs.text} chars)`,
    );
    await noJs.goto(new URL('/privacy/', BASE_URL).href, { waitUntil: 'networkidle0', timeout: 60_000 });
    const privacyNoJs = await noJs.evaluate(() => ({
      h1: document.querySelector('h1')?.textContent?.trim() ?? '',
      text: document.body.innerText.length,
    }));
    check(
      privacyNoJs.h1.includes('Privacy') && privacyNoJs.text > 1000,
      `no-JS: privacy renders full text (${privacyNoJs.text} chars)`,
    );
    await noJs.close();

    // ---- 4. axe-core: WCAG 2.0/2.1 A + AA on the two main pages (X13)
    for (const target of [
      { name: 'landing', url: '/' },
      { name: 'privacy', url: '/privacy/' },
    ]) {
      const audited = await browser.newPage();
      await audited.setViewport({ width: 1280, height: 800 });
      await audited.goto(new URL(target.url, BASE_URL).href, { waitUntil: 'networkidle0', timeout: 60_000 });
      await audited.addScriptTag({ path: AXE_PATH });
      const results = await audited.evaluate(async () =>
        window.axe.run(document, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
        }),
      );
      const violations = results.violations.map(
        (violation) => `${violation.id} (${violation.impact}): ${violation.nodes.length} node(s)`,
      );
      check(
        violations.length === 0,
        `axe ${target.name}: 0 WCAG A/AA violations${violations.length ? ` — ${violations.join('; ')}` : ''}`,
      );
      if (violations.length > 0) {
        for (const violation of results.violations) {
          for (const node of violation.nodes.slice(0, 3)) {
            console.log(`  node: ${node.target.join(' ')}`);
          }
        }
      }
      await audited.close();
    }
  } finally {
    await browser.close();
  }

  console.log(failures === 0 ? 'ALL WEB CHECKS PASSED' : `WEB CHECKS FAILED: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`FAILED: ${error?.message ?? String(error)}`);
  process.exit(1);
});
