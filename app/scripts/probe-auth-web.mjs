// WEB DOM PROBE (evidence for the five UI items) — reads live facts from the running Expo web preview:
//   A. computed outline* on the focused text input (the UA "inner black rectangle") + the field border
//      colour before/after focus (the outer indigo ring drawn by Input.tsx).
//   C. the <link rel="icon"> the document advertises (favicon wiring).
//   D. how many password reveal controls exist: the app toggle (aria-label from the catalog) vs the
//      browser-native one (Edge ::-ms-reveal — not queryable; presence of our style rule is checked).
//   E. document.activeElement after load and after driving the real links (first-input focus per view).
// WEB RENDER ONLY — no Android, no TalkBack claim. Run with the web server up:
//   node app/scripts/probe-auth-web.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE_URL = process.env.ROWTA_WEB_URL ?? 'http://localhost:8082';

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

/** Click the first leaf text node whose trimmed text equals label (the RNW link's inner span). */
async function clickLeaf(page, label) {
  return page.waitForFunction(
    (text) => {
      const matches = [...document.querySelectorAll('*')].filter(
        (element) => element.children.length === 0 && element.textContent?.trim() === text,
      );
      if (matches.length === 0) return false;
      matches[0].click();
      return true;
    },
    { timeout: 15_000 },
    label,
  );
}

async function describeActiveElement(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (el === null || el === document.body) return { tag: el === null ? 'null' : 'body' };
    return {
      tag: el.tagName,
      type: el.getAttribute('type'),
      name: el.getAttribute('name'),
      autocomplete: el.getAttribute('autocomplete'),
      ariaLabel: el.getAttribute('aria-label'),
      testId: el.getAttribute('data-testid'),
    };
  });
}

async function main() {
  if (!(await serverUp())) {
    console.error(`MISSING web server: ${BASE_URL} did not answer. Start it first: npx expo start --web --port 8082`);
    process.exit(2);
  }
  const executablePath = findBrowser();
  console.log(`browser: ${executablePath}`);
  console.log(`url: ${BASE_URL}`);

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false });
    await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 120_000 });
    await page.waitForSelector('input', { timeout: 15_000 });
    await new Promise((resolve) => setTimeout(resolve, 500));

    // --- C: favicon link in the document head
    const favicon = await page.evaluate(() =>
      [...document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]')].map(
        (link) => ({ rel: link.getAttribute('rel'), href: link.getAttribute('href'), type: link.getAttribute('type') }),
      ),
    );
    console.log('FAVICON-LINKS ' + JSON.stringify(favicon));

    // --- A: outline on the first input, blurred vs focused; field border colour vs input outline
    const outline = await page.evaluate(() => {
      const input = document.querySelector('input');
      if (input === null) return { error: 'no input' };
      const field = input.closest('div'); // RNW TextInput sits inside the kit's field View
      const read = () => {
        const style = getComputedStyle(input);
        return {
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
          outlineColor: style.outlineColor,
          fieldBorder: field === null ? null : getComputedStyle(field).borderColor,
        };
      };
      input.blur();
      const blurred = read();
      input.focus();
      const focused = read();
      return { blurred, focused, activeTag: document.activeElement?.tagName ?? null };
    });
    console.log('OUTLINE ' + JSON.stringify(outline));

    // --- E: focus on load (sign-in) — activeElement after settle
    const onSignIn = await describeActiveElement(page);
    console.log('FOCUS signIn ' + JSON.stringify(onSignIn));

    // --- D: password reveal controls on the sign-in form (app toggles by catalog aria-label)
    const toggles = await page.evaluate(() =>
      [...document.querySelectorAll('[aria-label]')]
        .map((el) => el.getAttribute('aria-label'))
        .filter((label) => label !== null && (label.includes('password') || label.includes('Password'))),
    );
    console.log('PASSWORD-CONTROLS ' + JSON.stringify(toggles));
    const nativeRevealRule = await page.evaluate(() => {
      for (const style of document.querySelectorAll('style')) {
        if (style.textContent !== null && style.textContent.includes('::-ms-reveal')) return true;
      }
      return false;
    });
    console.log('NATIVE-REVEAL-RULE-PRESENT ' + nativeRevealRule);

    // --- E: drive the real links; check first-input focus per form view
    await clickLeaf(page, 'Create account');
    await new Promise((resolve) => setTimeout(resolve, 400));
    console.log('FOCUS createAccount ' + JSON.stringify(await describeActiveElement(page)));

    await clickLeaf(page, 'Back to sign in');
    await new Promise((resolve) => setTimeout(resolve, 400));
    console.log('FOCUS backToSignIn ' + JSON.stringify(await describeActiveElement(page)));

    await clickLeaf(page, 'Forgot password');
    await new Promise((resolve) => setTimeout(resolve, 400));
    console.log('FOCUS forgotPassword ' + JSON.stringify(await describeActiveElement(page)));

    await clickLeaf(page, 'Back to sign in');
    await new Promise((resolve) => setTimeout(resolve, 400));
    await clickLeaf(page, 'Email me a sign-in link');
    await new Promise((resolve) => setTimeout(resolve, 400));
    console.log('FOCUS magicRequest ' + JSON.stringify(await describeActiveElement(page)));

    // --- re-render re-focus guard: type into the email field, wait, confirm focus stays but was not stolen
    //     by any later effect (activeElement still the same input after 600ms idle).
    await page.type('input', 'a@b.co');
    await new Promise((resolve) => setTimeout(resolve, 600));
    console.log('FOCUS afterTypingIdle ' + JSON.stringify(await describeActiveElement(page)));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`FAILED: ${error?.message ?? String(error)}`);
  process.exit(1);
});
