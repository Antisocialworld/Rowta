// CONTRAST REPORT (rule U11e): computes WCAG 2.1 contrast ratios for the token pairs the app actually uses and
// writes docs/a11y/contrast.md. It REPORTS honestly; it never adjusts a colour (owner decision: do nothing for
// colours; Q9/Q11 open). Pairs below 4.5:1 (text) or 3:1 (UI/borders) are marked PROBLEM, with the exemption
// notes the design system documents (disabled content, decorative-only pairs).
// Run from the repo root:  node scripts/contrast-report.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS = fs.readFileSync(path.join(ROOT, 'app', 'src', 'theme', 'tokens.ts'), 'utf8');

const colors = {};
for (const m of TOKENS.matchAll(/"?(color-[\w-]+)"?:\s*"(#[0-9a-fA-F]{8})"/g)) {
  colors[m[1]] = m[2].slice(0, 7); // design-system colours are opaque (alpha ff); trim for the maths
}

function channel(value) {
  const c = parseInt(value, 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance(hex) {
  return 0.2126 * channel(hex.slice(1, 3)) + 0.7152 * channel(hex.slice(3, 5)) + 0.0722 * channel(hex.slice(5, 7));
}
function ratio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const PAIRS = [
  { fg: 'color-on-surface', bg: 'color-surface', use: 'body text on the page background', kind: 'text' },
  { fg: 'color-on-surface', bg: 'color-surface-container', use: 'body text on a raised card', kind: 'text' },
  { fg: 'color-on-surface-variant', bg: 'color-surface-container', use: 'secondary text on a raised card', kind: 'text' },
  { fg: 'color-on-surface-variant', bg: 'color-surface-container-high', use: 'secondary text on a quiet control (ghost button)', kind: 'text' },
  { fg: 'color-on-primary', bg: 'color-primary', use: 'primary button label', kind: 'text' },
  { fg: 'color-on-secondary-container', bg: 'color-secondary-container', use: 'secondary button label', kind: 'text' },
  { fg: 'color-primary', bg: 'color-surface', use: 'ghost button label / links on the page', kind: 'text' },
  { fg: 'color-error', bg: 'color-surface', use: 'error text on the page', kind: 'text' },
  { fg: 'color-on-error-container', bg: 'color-error-container', use: 'error banner text', kind: 'text' },
  { fg: 'color-on-success-container', bg: 'color-success-container', use: 'success banner text', kind: 'text' },
  { fg: 'color-on-warning-container', bg: 'color-warning-container', use: 'warning banner text', kind: 'text' },
  { fg: 'color-inverse-on-surface', bg: 'color-inverse-surface', use: 'toast text', kind: 'text' },
  { fg: 'color-on-tertiary-container', bg: 'color-tertiary-container', use: 'tertiary chip text (design-system default)', kind: 'text' },
  { fg: 'color-outline', bg: 'color-surface', use: 'borders and dividers', kind: 'ui' },
  { fg: 'color-primary', bg: 'color-surface', use: 'focus ring on the page background', kind: 'ui' },
  { fg: 'color-primary', bg: 'color-surface-container-high', use: 'focus ring on a quiet control', kind: 'ui' },
  { fg: 'color-outline-variant', bg: 'color-surface-container', use: 'decorative separators only', kind: 'decorative' },
  { fg: 'color-on-surface', bg: 'color-surface', use: 'disabled content over a disabled container (exempt)', kind: 'disabled' },
];

const rows = PAIRS.map((pair) => {
  const fg = colors[pair.fg];
  const bg = colors[pair.bg];
  if (fg === undefined || bg === undefined) return { ...pair, value: null };
  return { ...pair, value: ratio(fg, bg) };
});

const lines = [
  '# Contrast (rule U11e)',
  '',
  'Computed from the generated design-system tokens (`app/src/theme/tokens.ts`) with the WCAG 2.1 relative',
  'luminance formula. Thresholds: text 4.5:1, UI/borders 3:1. Decorative and disabled pairs are listed for',
  'completeness and are exempt by WCAG. Colours are NEVER adjusted here (owner decision: "do nothing for',
  'colors"; Q9 and Q11 open) — problems are reported, and any fix is the owner\'s call.',
  '',
  '| Pair | Use | Ratio | Verdict |',
  '|---|---|---|---|',
];

for (const row of rows) {
  if (row.value === null) {
    lines.push(`| \`${row.fg}\` on \`${row.bg}\` | ${row.use} | missing token | SKIP |`);
    continue;
  }
  const threshold = row.kind === 'text' ? 4.5 : row.kind === 'ui' ? 3 : 0;
  const exempt = row.kind === 'decorative' || row.kind === 'disabled';
  const verdict = exempt ? `exempt (${row.kind})` : row.value >= threshold ? 'PASS' : `PROBLEM (< ${threshold}:1, ${row.kind})`;
  lines.push(`| \`${row.fg}\` on \`${row.bg}\` | ${row.use} | ${row.value.toFixed(2)}:1 | ${verdict} |`);
}

const problems = rows.filter((r) => r.value !== null && r.kind !== 'decorative' && r.kind !== 'disabled' && r.value < (r.kind === 'text' ? 4.5 : 3));
lines.push('', `Problems found: ${problems.length}. Every PROBLEM above is a report, not a change.`, '');

fs.mkdirSync(path.join(ROOT, 'docs', 'a11y'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'a11y', 'contrast.md'), lines.join('\n'), 'utf8');
console.log(`wrote docs/a11y/contrast.md — ${rows.length} pairs, ${problems.length} problems`);
for (const p of problems) console.log(`PROBLEM ${p.fg} on ${p.bg}: ${p.value?.toFixed(2)}:1 (${p.use})`);
