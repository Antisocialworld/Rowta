// FORM READINESS PROBE (evidence for rules V6 / X14 not-ready buttons) — proves, per auth form on
// the running Expo web preview:
//   1 empty     the submit button is aria-disabled, never the native `disabled` attribute, and its
//               visible reason line (catalog words) is rendered next to it.
//   2 invalid   after typing values the SHARED Zod schema rejects, the button stays aria-disabled.
//   3 valid     when the shared schema passes, the button becomes active (aria-disabled clears).
//   4 press     clicking the inactive button sends NO request, keeps the view, and moves focus to
//               the first problem field (X14c). The button is focused before the click to show it
//               STAYS focusable while not ready (X14a).
//
// STUBS (test doubles): the API server is NOT running in this session, so request interception
// fulfils exactly three calls with canned bodies shaped by the shared envelope schemas —
// GET /auth/countries (sign-up country list), POST /auth/forgot and POST /auth/forgot/verify (the
// walk into the reset-code and new-password steps). No server code is touched or called; the
// readiness decisions themselves are pure client code. The stub grant is a placeholder string,
// never a credential.
//
// WEB RENDER ONLY — no Android, no TalkBack claim. A form whose step cannot run prints
// UNVERIFIED with the reason instead of a pass.
//
// Run (web server up first):  node app/scripts/probe-form-readiness-web.mjs
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE_URL = process.env.ROWTA_WEB_URL ?? 'http://localhost:8082';

const BROWSER_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

// Canned bodies (TEST DOUBLES). Shapes = shared success envelopes: { data, meta } (shared/src/http.ts).
const STUB = {
  countries: JSON.stringify({ data: [{ code: 'NG', name: 'Nigeria' }, { code: 'KE', name: 'Kenya' }] }),
  forgot: JSON.stringify({
    data: { message: 'code sent' },
    meta: { expiresInSeconds: 300, resendInSeconds: 60 },
  }),
  forgotVerify: JSON.stringify({
    data: { grant: 'probe-test-double-grant' },
    meta: { expiresInSeconds: 600 },
  }),
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** DOM facts about the submit button: aria-disabled, native disabled attr, opacity, tabIndex
 *  (focusable while not ready), the linkage attributes, and the sibling reason line. */
async function buttonProbe(page, label) {
  return page.evaluate((name) => {
    const candidates = [...document.querySelectorAll('[role="button"], button')];
    const element = candidates.find(
      (node) => (node.getAttribute('aria-label') ?? node.textContent ?? '').trim() === name,
    );
    if (element === undefined) return { found: false };
    const container = element.parentElement;
    const siblings =
      container === null
        ? []
        : [...container.children]
            .filter((child) => child !== element)
            .map((child) => child.textContent?.trim() ?? '')
            .filter((text) => text.length > 0);
    const style = getComputedStyle(element);
    return {
      found: true,
      tag: element.tagName,
      role: element.getAttribute('role'),
      ariaDisabled: element.getAttribute('aria-disabled'),
      nativeDisabledAttr: element.hasAttribute('disabled'),
      opacity: style.opacity,
      tabIndex: element.tabIndex,
      ariaDescription: element.getAttribute('aria-description'),
      ariaDescribedBy: element.getAttribute('aria-describedby'),
      hintText: element.getAttribute('title'),
      reasonText: siblings.join(' | '),
      outerHtml: element.outerHTML.slice(0, 400),
    };
  }, label);
}

/** Focus the button by keyboard order (JS focus) — proves focusable while aria-disabled (X14a). */
async function focusButton(page, label) {
  return page.evaluate((name) => {
    const candidates = [...document.querySelectorAll('[role="button"], button')];
    const element = candidates.find(
      (node) => (node.getAttribute('aria-label') ?? node.textContent ?? '').trim() === name,
    );
    if (element === undefined) return { focused: false, tag: null };
    element.focus();
    const active = document.activeElement;
    return { focused: active === element, tag: active === null ? null : active.tagName };
  }, label);
}

async function activeElementInfo(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (element === null || element === document.body) {
      return { tag: element === null ? 'null' : 'body' };
    }
    return {
      tag: element.tagName,
      type: element.getAttribute('type'),
      ariaLabel: element.getAttribute('aria-label'),
      testId: element.getAttribute('data-testid'),
      role: element.getAttribute('role'),
    };
  });
}

async function headingText(page) {
  return page.evaluate(() => {
    // RN accessibilityRole="header" may land as role="heading" or role="header" in RNW; headings
    // are also matched semantically so the view identity check never depends on one spelling.
    const headings = [...document.querySelectorAll('[role="heading"], [role="header"], h1, h2, h3, h4')];
    return headings.map((node) => node.textContent?.trim() ?? '').filter((text) => text.length > 0).join(' | ');
  });
}

async function inputsSummary(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('input')].map((input) => ({
      type: input.getAttribute('type'),
      ariaLabel: input.getAttribute('aria-label'),
      autocomplete: input.getAttribute('autocomplete'),
    })),
  );
}

/** Set input `index` to `value` through the native setter so React's controlled state updates. */
async function fill(page, index, value) {
  await page.evaluate(
    (i, text) => {
      const inputs = document.querySelectorAll('input');
      const input = inputs[i];
      if (input === undefined) throw new Error(`no input at index ${i}`);
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set;
      if (setter === undefined) throw new Error('no value setter');
      setter.call(input, text);
      const event = document.createEvent('Event');
      event.initEvent('input', true, true);
      input.dispatchEvent(event);
    },
    index,
    value,
  );
  await sleep(250);
}

/** Step report line + returned probe, so every raw line carries form, step and state. */
async function report(page, form, step, extra = {}) {
  const state = await buttonProbe(page, extra.label ?? formLabel(form));
  const heading = await headingText(page);
  const line = {
    ariaDisabled: state.ariaDisabled,
    nativeDisabled: state.nativeDisabledAttr,
    opacity: state.opacity,
    tabIndex: state.tabIndex,
    describedBy: state.ariaDescribedBy,
    reason: state.reasonText,
    heading,
    ...extra.data,
  };
  console.log(`FORM ${form} ${step} ${JSON.stringify(line)}`);
  if (step === 'empty') console.log(`FORM ${form} dom ${state.outerHtml ?? 'not-found'}`);
  return state;
}

const LABELS = {
  signIn: 'Sign in',
  createAccount: 'Create account',
  forgot: 'Email me a link',
  resetPassword: 'Reset password',
  magicRequest: 'Email me a link',
};
function formLabel(form) {
  return LABELS[form];
}

async function main() {
  if (!(await serverUp())) {
    console.error(`MISSING web server: ${BASE_URL} did not answer. Start it first: npx expo start --web --port 8082`);
    process.exit(2);
  }
  const executablePath = findBrowser();
  console.log(`browser: ${executablePath}`);
  console.log(`url: ${BASE_URL}`);
  console.log(`api stubs: GET /auth/countries, POST /auth/forgot, POST /auth/forgot/verify (test doubles — API server not running)`);

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  // Phase-tagged record of every API call the app makes, so "press ignored" can prove ZERO requests.
  let phase = 'load';
  const apiCalls = [];
  let countriesStubbed = 0;

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      const method = request.method();
      // The app runs on :8082 and the API base URL on :3000 — every stubbed response needs CORS
      // headers, and POSTs with a JSON body send an OPTIONS preflight first.
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'accept,content-type,authorization',
      };
      if (method === 'OPTIONS') {
        void request.respond({ status: 204, headers: cors });
        return;
      }
      if (method === 'GET' && url.includes('/auth/countries')) {
        countriesStubbed += 1;
        void request.respond({ status: 200, contentType: 'application/json', headers: cors, body: STUB.countries });
        return;
      }
      if (method === 'POST' && url.endsWith('/auth/forgot')) {
        apiCalls.push({ phase, path: '/auth/forgot' });
        void request.respond({ status: 200, contentType: 'application/json', headers: cors, body: STUB.forgot });
        return;
      }
      if (method === 'POST' && url.endsWith('/auth/forgot/verify')) {
        apiCalls.push({ phase, path: '/auth/forgot/verify' });
        void request.respond({ status: 200, contentType: 'application/json', headers: cors, body: STUB.forgotVerify });
        return;
      }
      if (method !== 'GET' && url.includes('/auth/')) apiCalls.push({ phase, path: url.replace(/^https?:\/\/[^/]+/, '') });
      void request.continue();
    });

    await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 120_000 });
    await page.waitForSelector('input', { timeout: 15_000 });
    await sleep(600);

    const results = {};

    // ------------------------------------------------------------------------------------
    // 1. SIGN IN — shared signInSchema: email shape + non-empty password (V7)
    // ------------------------------------------------------------------------------------
    phase = 'signIn';
    console.log('VIEW signIn inputs ' + JSON.stringify(await inputsSummary(page)));
    results.signIn = { empty: false, press: false, invalid: false, valid: false };

    const s1 = await report(page, 'signIn', 'empty');
    results.signIn.empty =
      s1.ariaDisabled === 'true' &&
      s1.nativeDisabledAttr === false &&
      s1.reasonText.length > 0 &&
      s1.opacity === '0.38' &&
      s1.ariaDescribedBy !== null;

    const focusBefore = await focusButton(page, LABELS.signIn);
    const callsBefore = apiCalls.length;
    const headingBefore = await headingText(page);
    await buttonHandle(page, LABELS.signIn).then((handle) => handle.click());
    await sleep(600);
    const s2 = await buttonProbe(page, LABELS.signIn);
    const afterPress = await activeElementInfo(page);
    const pressData = {
      focusBefore,
      ariaDisabledAfter: s2.ariaDisabled,
      apiCallsDuring: apiCalls.slice(callsBefore),
      headingKept: headingBefore === (await headingText(page)),
      focusAfter: afterPress,
    };
    console.log('FORM signIn press ' + JSON.stringify(pressData));
    results.signIn.press =
      focusBefore.focused === true &&
      s2.ariaDisabled === 'true' &&
      pressData.apiCallsDuring.length === 0 &&
      pressData.headingKept &&
      afterPress.tag === 'INPUT';

    await fill(page, 0, 'not-an-email');
    await fill(page, 1, 'x');
    const s3 = await report(page, 'signIn', 'invalid');
    results.signIn.invalid = s3.ariaDisabled === 'true';

    await fill(page, 0, 'ada@example.com');
    await fill(page, 1, 'correct-horse-battery');
    const s4 = await report(page, 'signIn', 'valid');
    results.signIn.valid = s4.ariaDisabled === null && s4.opacity === '1';

    // ------------------------------------------------------------------------------------
    // 2. CREATE ACCOUNT — shared signUpSchema (country picked from the stubbed SERVER list)
    // ------------------------------------------------------------------------------------
    phase = 'createAccount';
    await clickLeaf(page, 'Create account');
    await sleep(500);
    console.log('VIEW createAccount inputs ' + JSON.stringify(await inputsSummary(page)));
    results.createAccount = { empty: false, press: false, invalid: false, valid: false, note: '' };

    const c1 = await report(page, 'createAccount', 'empty');
    results.createAccount.empty =
      c1.ariaDisabled === 'true' && c1.nativeDisabledAttr === false && c1.reasonText.length > 0 && c1.opacity === '0.38';

    const cFocusBefore = await focusButton(page, LABELS.createAccount);
    const cCallsBefore = apiCalls.length;
    const cHeadingBefore = await headingText(page);
    await buttonHandle(page, LABELS.createAccount).then((handle) => handle.click());
    await sleep(600);
    const c2 = await buttonProbe(page, LABELS.createAccount);
    const cAfter = await activeElementInfo(page);
    const cPressData = {
      focusBefore: cFocusBefore,
      ariaDisabledAfter: c2.ariaDisabled,
      apiCallsDuring: apiCalls.slice(cCallsBefore),
      headingKept: cHeadingBefore === (await headingText(page)),
      focusAfter: cAfter,
    };
    console.log('FORM createAccount press ' + JSON.stringify(cPressData));
    results.createAccount.press =
      cFocusBefore.focused === true &&
      c2.ariaDisabled === 'true' &&
      cPressData.apiCallsDuring.length === 0 &&
      cPressData.headingKept &&
      cAfter.tag === 'INPUT';

    // Pick a country FIRST so the invalid step proves an INVALID VALUE keeps it inactive.
    // The country list is a STUBBED GET /auth/countries (server-owned, S5); if the request never
    // reaches the stub (EXPO_PUBLIC_API_URL unset in the dev server) the valid step is UNVERIFIED.
    let sheetOk = true;
    try {
      await page.click('[data-testid="field-country"]');
      await page.waitForSelector('[data-testid="country-row-NG"]', { timeout: 10_000 });
      // The BottomSheet scrim intercepts the synthetic mouse click; a DOM click reaches the row's
      // own press handler (the same mechanism the links above use).
      const clicked = await page.evaluate(() => {
        const row = document.querySelector('[data-testid="country-row-NG"]');
        if (row === null) return false;
        row.click();
        return true;
      });
      if (!clicked) throw new Error('country row DOM click failed');
    } catch (error) {
      sheetOk = false;
      const diag = await page.evaluate(() => ({
        testIds: [...document.querySelectorAll('[data-testid]')].map((node) => node.getAttribute('data-testid')),
        bodySnippet: document.body.innerText.slice(0, 400),
      }));
      console.log(
        'SHEET-DIAG ' +
          JSON.stringify({
            error: String(error?.message ?? error).slice(0, 140),
            countriesStubbed,
            ...diag,
          }),
      );
    }
    await sleep(400);
    await fill(page, 0, 'Ada Lovelace');
    await fill(page, 1, 'nope');
    await fill(page, 2, 'short');
    await fill(page, 3, 'shorter');
    const c3 = await report(page, 'createAccount', 'invalid');
    results.createAccount.invalid = c3.ariaDisabled === 'true';

    await fill(page, 1, 'ada@example.com');
    await fill(page, 2, 'Correct-Horse-Battery-1');
    await fill(page, 3, 'Correct-Horse-Battery-1');
    const c4 = await report(page, 'createAccount', 'valid');
    results.createAccount.valid = sheetOk && c4.ariaDisabled === null && c4.opacity === '1';
    if (!sheetOk || countriesStubbed === 0) {
      results.createAccount.valid = null;
      results.createAccount.note = 'UNVERIFIED: country list unavailable (stub never reached or sheet empty)';
      console.log('FORM createAccount valid ' + results.createAccount.note);
    }

    // ------------------------------------------------------------------------------------
    // 3. FORGOT PASSWORD — shared forgotSchema (email shape only)
    // ------------------------------------------------------------------------------------
    phase = 'forgot';
    await clickLeaf(page, 'Back to sign in');
    await sleep(400);
    await clickLeaf(page, 'Forgot password');
    await sleep(500);
    console.log('VIEW forgotPassword inputs ' + JSON.stringify(await inputsSummary(page)));
    results.forgot = { empty: false, press: false, invalid: false, valid: false };

    const f1 = await report(page, 'forgot', 'empty');
    results.forgot.empty =
      f1.ariaDisabled === 'true' && f1.nativeDisabledAttr === false && f1.reasonText.length > 0 && f1.opacity === '0.38';

    const fFocusBefore = await focusButton(page, LABELS.forgot);
    const fCallsBefore = apiCalls.length;
    const fHeadingBefore = await headingText(page);
    await buttonHandle(page, LABELS.forgot).then((handle) => handle.click());
    await sleep(600);
    const f2 = await buttonProbe(page, LABELS.forgot);
    const fAfter = await activeElementInfo(page);
    const fPressData = {
      focusBefore: fFocusBefore,
      ariaDisabledAfter: f2.ariaDisabled,
      apiCallsDuring: apiCalls.slice(fCallsBefore),
      headingKept: fHeadingBefore === (await headingText(page)),
      focusAfter: fAfter,
    };
    console.log('FORM forgot press ' + JSON.stringify(fPressData));
    results.forgot.press =
      fFocusBefore.focused === true &&
      f2.ariaDisabled === 'true' &&
      fPressData.apiCallsDuring.length === 0 &&
      fPressData.headingKept &&
      fAfter.tag === 'INPUT';

    await fill(page, 0, 'nope@');
    const f3 = await report(page, 'forgot', 'invalid');
    results.forgot.invalid = f3.ariaDisabled === 'true';

    await fill(page, 0, 'ada@example.com');
    const f4 = await report(page, 'forgot', 'valid');
    results.forgot.valid = f4.ariaDisabled === null && f4.opacity === '1';

    // ------------------------------------------------------------------------------------
    // 4. NAVIGATION (stubs) into the reset steps: active forgot press -> resetCode -> resetPassword
    // ------------------------------------------------------------------------------------
    phase = 'forgotSubmit';
    await buttonHandle(page, LABELS.forgot).then((handle) => handle.click());
    await sleep(800);
    console.log('NAV afterForgotSubmit heading ' + JSON.stringify(await headingText(page)));
    console.log('NAV apiCalls ' + JSON.stringify(apiCalls));

    phase = 'resetCode';
    await fill(page, 0, '123456');
    await sleep(200);
    const codeState = await buttonProbe(page, 'Verify');
    console.log('NAV resetCode verifyButton ' + JSON.stringify({ ariaDisabled: codeState.ariaDisabled, note: 'CodeStep readiness NOT changed (task: leave code buttons); shown for navigation only' }));
    await buttonHandle(page, 'Verify').then((handle) => handle.click());
    await sleep(800);
    console.log('NAV afterVerify heading ' + JSON.stringify(await headingText(page)));

    // ------------------------------------------------------------------------------------
    // 5. RESET (NEW PASSWORD) — shared resetNewPasswordSchema: 8-128 + identical confirmation
    // ------------------------------------------------------------------------------------
    phase = 'resetPassword';
    const onReset = (await headingText(page)).includes('New password');
    results.resetPassword = { empty: false, press: false, invalid: false, valid: false, note: onReset ? '' : 'UNVERIFIED: did not land on the new-password step' };
    if (onReset) {
      console.log('VIEW resetPassword inputs ' + JSON.stringify(await inputsSummary(page)));
      const r1 = await report(page, 'resetPassword', 'empty');
      results.resetPassword.empty =
        r1.ariaDisabled === 'true' && r1.nativeDisabledAttr === false && r1.reasonText.length > 0 && r1.opacity === '0.38';

      const rFocusBefore = await focusButton(page, LABELS.resetPassword);
      const rCallsBefore = apiCalls.length;
      const rHeadingBefore = await headingText(page);
      await buttonHandle(page, LABELS.resetPassword).then((handle) => handle.click());
      await sleep(600);
      const r2 = await buttonProbe(page, LABELS.resetPassword);
      const rAfter = await activeElementInfo(page);
      const rPressData = {
        focusBefore: rFocusBefore,
        ariaDisabledAfter: r2.ariaDisabled,
        apiCallsDuring: apiCalls.slice(rCallsBefore),
        headingKept: rHeadingBefore === (await headingText(page)),
        focusAfter: rAfter,
      };
      console.log('FORM resetPassword press ' + JSON.stringify(rPressData));
      results.resetPassword.press =
        rFocusBefore.focused === true &&
        r2.ariaDisabled === 'true' &&
        rPressData.apiCallsDuring.length === 0 &&
        rPressData.headingKept &&
        rAfter.tag === 'INPUT';

      await fill(page, 0, 'short');
      await fill(page, 1, 'short');
      const r3 = await report(page, 'resetPassword', 'invalid');
      results.resetPassword.invalid = r3.ariaDisabled === 'true';

      await fill(page, 0, 'Correct-Horse-Battery-1');
      await fill(page, 1, 'different-password');
      const r4 = await report(page, 'resetPassword', 'invalidMismatch');
      results.resetPassword.invalid = results.resetPassword.invalid && r4.ariaDisabled === 'true';

      await fill(page, 1, 'Correct-Horse-Battery-1');
      const r5 = await report(page, 'resetPassword', 'valid');
      results.resetPassword.valid = r5.ariaDisabled === null && r5.opacity === '1';
    } else {
      console.log('FORM resetPassword UNVERIFIED ' + JSON.stringify({ reason: 'reset step not reachable in this session', apiCalls }));
    }

    // ------------------------------------------------------------------------------------
    // 6. MAGIC LINK REQUEST — shared magicRequestSchema (email shape only); fresh page load
    // ------------------------------------------------------------------------------------
    phase = 'magicRequest';
    await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 120_000 });
    await page.waitForSelector('input', { timeout: 15_000 });
    await sleep(600);
    await clickLeaf(page, 'Email me a sign-in link');
    await sleep(500);
    console.log('VIEW magicRequest inputs ' + JSON.stringify(await inputsSummary(page)));
    results.magicRequest = { empty: false, press: false, invalid: false, valid: false };

    const m1 = await report(page, 'magicRequest', 'empty');
    results.magicRequest.empty =
      m1.ariaDisabled === 'true' && m1.nativeDisabledAttr === false && m1.reasonText.length > 0 && m1.opacity === '0.38';

    const mFocusBefore = await focusButton(page, LABELS.magicRequest);
    const mCallsBefore = apiCalls.length;
    const mHeadingBefore = await headingText(page);
    await buttonHandle(page, LABELS.magicRequest).then((handle) => handle.click());
    await sleep(600);
    const m2 = await buttonProbe(page, LABELS.magicRequest);
    const mAfter = await activeElementInfo(page);
    const mPressData = {
      focusBefore: mFocusBefore,
      ariaDisabledAfter: m2.ariaDisabled,
      apiCallsDuring: apiCalls.slice(mCallsBefore),
      headingKept: mHeadingBefore === (await headingText(page)),
      focusAfter: mAfter,
    };
    console.log('FORM magicRequest press ' + JSON.stringify(mPressData));
    results.magicRequest.press =
      mFocusBefore.focused === true &&
      m2.ariaDisabled === 'true' &&
      mPressData.apiCallsDuring.length === 0 &&
      mPressData.headingKept &&
      mAfter.tag === 'INPUT';

    await fill(page, 0, 'nope@');
    const m3 = await report(page, 'magicRequest', 'invalid');
    results.magicRequest.invalid = m3.ariaDisabled === 'true';

    await fill(page, 0, 'ada@example.com');
    const m4 = await report(page, 'magicRequest', 'valid');
    results.magicRequest.valid = m4.ariaDisabled === null && m4.opacity === '1';

    // ------------------------------------------------------------------------------------
    // Summary
    // ------------------------------------------------------------------------------------
    console.log('STUB countriesRequests=' + countriesStubbed);
    console.log('API-CALLS ' + JSON.stringify(apiCalls));
    let failed = 0;
    for (const [form, checks] of Object.entries(results)) {
      for (const [step, value] of Object.entries(checks)) {
        if (value === true) {
          console.log(`CHECK ${form.padEnd(14)} ${step.padEnd(10)} PASS`);
        } else if (value === false) {
          failed += 1;
          console.log(`CHECK ${form.padEnd(14)} ${step.padEnd(10)} FAIL`);
        } else {
          console.log(`CHECK ${form.padEnd(14)} ${step.padEnd(10)} ${String(value).toUpperCase()}`);
        }
      }
    }
    console.log(failed === 0 ? 'READINESS PROBE: ALL CHECKS PASSED' : `READINESS PROBE: ${failed} CHECK(S) FAILED`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

/** ElementHandle for the labelled submit button (for real mouse clicks). */
async function buttonHandle(page, label) {
  const handle = await page.evaluateHandle((name) => {
    const candidates = [...document.querySelectorAll('[role="button"], button')];
    return candidates.find((node) => (node.getAttribute('aria-label') ?? node.textContent ?? '').trim() === name);
  }, label);
  const element = handle.asElement();
  if (element === null) throw new Error(`submit button not found: ${label}`);
  return element;
}

main().catch((error) => {
  console.error(`FAILED: ${error?.message ?? String(error)}`);
  process.exit(1);
});
