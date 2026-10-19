#!/usr/bin/env node
// Writes docs/a11y/contrast.md — a REPORT of contrast ratios computed from
// design-system/design-variables.css (READ-ONLY). It never repairs the palette.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCssVariables, resolveValue } from './build-app-tokens.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(ROOT, 'design-system', 'design-variables.css'), 'utf8');
const map = parseCssVariables(css);
const get = n => resolveValue(map, map.get(n));

function toRgb(hex) {
  const m = hex.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (!m) throw new Error('not an 8/6-digit hex: ' + hex);
  const r = parseInt(m[1].slice(0, 2), 16), g = parseInt(m[1].slice(2, 4), 16), b = parseInt(m[1].slice(4, 6), 16);
  const a = m[2] ? parseInt(m[2], 16) / 255 : 1;
  return [r, g, b, a];
}
function compositeOver(fg, bg) {
  const [r, g, b, a] = fg; const [br, bg2, bb] = bg;
  return [r * a + br * (1 - a), g * a + bg2 * (1 - a), b * a + bb * (1 - a)];
}
function lum(rgb) {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}
function ratio(fgHex, bgHex) {
  let fg = toRgb(fgHex); const bg = toRgb(bgHex);
  const bgOpaque = [bg[0], bg[1], bg[2]];
  const fgComp = fg[3] < 1 ? compositeOver(fg, bgOpaque) : [fg[0], fg[1], fg[2]];
  const l1 = lum(fgComp), l2 = lum(bgOpaque);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const pairs = [
  ['on-primary', 'primary'],
  ['on-secondary', 'secondary'],
  ['on-tertiary', 'tertiary'],
  ['on-error', 'error'],
  ['on-warning', 'warning'],
  ['on-success', 'success'],
  ['on-surface', 'surface'],
  ['on-surface-variant', 'surface'],
  ['inverse-on-surface', 'inverse-surface'],
  ['on-tertiary-container', 'tertiary-container'],
  ['on-primary-container', 'primary-container'],
  ['on-secondary-container', 'secondary-container'],
  ['on-error-container', 'error-container'],
];

const rows = [];
for (const [fgRole, bgRole] of pairs) {
  const fgName = '--color-' + fgRole, bgName = '--color-' + bgRole;
  if (!map.has(fgName) || !map.has(bgName)) { rows.push([fgRole, bgRole, 'n/a (role missing)', '-']); continue; }
  const r = ratio(get(fgName), get(bgName));
  rows.push([fgRole, bgRole, r.toFixed(2) + ':1', r >= 4.5 ? 'PASS text' : (r >= 3 ? 'large/UI only' : 'FAIL — do not use for text')]);
}

const md = [];
md.push('# Contrast report (generated, do not repair the palette)');
md.push('');
md.push('Computed from `design-system/design-variables.css` with the WCAG 2.1 relative-luminance formula');
md.push('(alpha composited over the background). Thresholds: 4.5:1 text, 3:1 large text and UI parts.');
md.push("Rule X5. This file REPORTS only; changing the palette is the owner's call.");
md.push('');
md.push('| Foreground | Background | Ratio | Verdict |');
md.push('|---|---|---|---|');
for (const r of rows) md.push('| ' + r.join(' | ') + ' |');
md.push('');
md.push('## Known pair to avoid for text');
md.push('');
md.push('- `on-tertiary-container` on `tertiary-container` = **' + (rows.find(r => r[1] === 'tertiary-container') || ['','','n/a'])[2] + '** (fails 4.5:1). Do not use this pair for text; icons/large text only if >= 3.');
md.push('');
md.push('## Data oddities (reported, never repaired)');
md.push('');
md.push('- `neutral-20` = `' + get('--color-neutral-20') + '` — a ramp step that is pure black; expect a dark grey. Owner: confirm intended value.');
md.push('- `secondary-60` = `' + get('--color-secondary-60') + '` — sits off the secondary ramp used by the other steps. Owner: confirm intended value.');
md.push('');
md.push('## Notes');
md.push('');
md.push('- `outline-variant` is DECORATION ONLY (dividers, hairlines): never text, never an essential icon.');
md.push('- There is no info colour: use primary or secondary roles.');
md.push('- Q9 open: light theme only.');
md.push('');
fs.writeFileSync(path.join(ROOT, 'docs', 'a11y', 'contrast.md'), md.join('\n'), 'utf8');
console.log('wrote docs/a11y/contrast.md');
rows.forEach(r => console.log('  ' + r[0] + ' on ' + r[1] + ' = ' + r[2] + ' ' + r[3]));
