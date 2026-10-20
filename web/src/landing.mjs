// landing — the home page. ONE logo only (logo.svg, large, directly on the page background, no panel),
// text-link nav, one hero button driven by one env name, three borderless feature columns, one privacy
// summary line. Source of the words: docs/legal/landing.md (single source of truth; see build.mjs).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { inline } from './markdown.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Parses `## Section` blocks of docs/legal/landing.md into a map of trimmed single-paragraph strings. */
export function loadLandingCopy() {
  const raw = readFileSync(path.join(HERE, '..', '..', 'docs', 'legal', 'landing.md'), 'utf8');
  const copy = {};
  let current = null;
  for (const line of raw.replaceAll('\r\n', '\n').split('\n')) {
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) {
      current = heading[1].trim();
      copy[current] = [];
      continue;
    }
    if (current && line.trim() !== '' && !line.startsWith('>')) copy[current].push(line.trim());
  }
  const one = (key) => (copy[key] ?? []).join(' ');
  return {
    headline: one('Headline'),
    description: one('Description'),
    feature1Title: one('Feature 1 title'),
    feature1Text: one('Feature 1 text'),
    feature2Title: one('Feature 2 title'),
    feature2Text: one('Feature 2 text'),
    feature3Title: one('Feature 3 title'),
    feature3Text: one('Feature 3 text'),
    privacyLine: one('Privacy line'),
    platformNote: one('Platform note'),
  };
}

export function landingMain(copy, downloadUrl) {
  const cta = downloadUrl
    ? `<a class="button" href="${downloadUrl.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}" id="get-rowta">Get the Android app</a>`
    : `<p class="soon" id="get-rowta">Download link coming soon</p>`;
  // COPY LOCK (owner, 20 Oct 2026): desktop = text left (~55%), lettered logo right (200px), ~40px gap,
  // vertically centred; phone = logo first, then text, one column (DOM order is logo first).
  return `<section class="hero">
    <img class="hero-logo" src="/brand/logo.svg" width="200" height="200" alt="Rowta">
    <div class="hero-text">
      <h1>${inline(copy.headline)}</h1>
      <p class="lede">${inline(copy.description)}</p>
      ${cta}
      <p class="platform-note">${inline(copy.platformNote)}</p>
    </div>
  </section>
  <ul class="features">
    <li>
      <h2>${inline(copy.feature1Title)}</h2>
      <p>${inline(copy.feature1Text)}</p>
    </li>
    <li>
      <h2>${inline(copy.feature2Title)}</h2>
      <p>${inline(copy.feature2Text)}</p>
    </li>
    <li>
      <h2>${inline(copy.feature3Title)}</h2>
      <p>${inline(copy.feature3Text)}</p>
    </li>
  </ul>
  <p class="privacy-summary">${inline(copy.privacyLine)}</p>`;
}
