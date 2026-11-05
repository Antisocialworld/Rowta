#!/usr/bin/env node
// Gate: no hand-written UI values outside the design system.
// Fails if any source file under app/src, web/src, web/public or server email templates contains
// a hard-coded colour (hex/rgb/hsl/named), font size, line height, shadow, spacing/px magic number
// in a style literal, or an opacity — unless the file IS the design system (design-system/, tokens.ts).
// web/src exception (copy/layout lock, owner 20 Oct 2026): plain CSS layout in px is the owner's locked
// sizing (200px logo, 40px/32px gaps, 1100px max width) — the two px-LAYOUT patterns are skipped for web
// files only; colours, font sizes, shadows and opacities stay enforced everywhere.
// server/src/mail exception (AGENT DECISION, 20 Oct 2026, FOR OWNER RATIFICATION): email HTML cannot
// use the design system — px is the only length unit mail clients render reliably — and rule U5 covers
// component files only. Only the 'css px in stylesheet' pattern is skipped for files under
// server/src/mail/; colours, font sizes, shadows, opacities and every other pattern stay enforced
// there (proved by scripts/test-ui-tokens-gate.mjs). U5's wording may need an owner edit to name the
// email surface explicitly.
// Run: node scripts/check-ui-tokens.mjs   (exit 1 = gate failed)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['app/src', 'web/src', 'web/public', 'server/src'];
const EXEMPT_FILES = new Set(['tokens.ts']); // generated copy of the CSS
const EXEMPT_DIRS = ['design-system', 'node_modules', 'rowta-old-backup', '.git'];

const patterns = [
  { name: 'hex colour', re: /#[0-9a-fA-F]{3,8}\b/ },
  { name: 'rgb/hsl colour', re: /\b(rgba?|hsla?)\s*\(/ },
  { name: 'named colour', re: /\b(white|black|red|green|blue|gray|grey|orange|yellow|purple|pink|cyan|magenta|beige|ivory|teal|navy|maroon|olive|silver|gold|bronze)\b(?=[^\n]*(color|background|tint|border))/i },
  { name: 'fontSize literal', re: /\bfontSize\s*[:=]\s*['"]?\d/ },
  { name: 'lineHeight literal', re: /\blineHeight\s*[:=]\s*['"]?\d/ },
  { name: 'letterSpacing literal', re: /\bletterSpacing\s*[:=]\s*['"]?-?\d/ },
  { name: 'borderRadius literal', re: /\bborderRadius\s*[:=]\s*['"]?\d/ },
  { name: 'shadow literal', re: /\bshadow(Color|Offset|Radius|Opacity)\s*[:=]/ },
  { name: 'padding/margin/gap px literal', re: /\b(padding|margin|gap|paddingHorizontal|paddingVertical|marginTop|marginBottom|marginLeft|marginRight|paddingTop|paddingBottom|paddingLeft|paddingRight)\s*[:=]\s*['"]?\d/ },
  { name: 'opacity literal', re: /\bopacity\s*[:=]\s*0?\.\d+/ },
  { name: 'css px in stylesheet', re: /\b\d+px\b/ },
  { name: 'css hex in stylesheet', re: /:\s*#[0-9a-fA-F]{3,8}\b/ },
];

function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (EXEMPT_DIRS.includes(e.name)) continue;
      yield* walk(p);
    } else if (e.isFile()) {
      yield p;
    }
  }
}

const WEB_LAYOUT_PX_PATTERNS = new Set(['css px in stylesheet', 'padding/margin/gap px literal']);

const exts = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.html']);
let hits = [];
let scanned = 0;
for (const dir of SCAN_DIRS) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) continue;
  for (const file of walk(abs)) {
    if (!exts.has(path.extname(file))) continue;
    if (EXEMPT_FILES.has(path.basename(file))) continue;
    if (path.basename(file).endsWith('.test.ts') || path.basename(file).endsWith('.test.tsx')) continue;
    scanned++;
    const rel = path.relative(ROOT, file).replaceAll('\\', '/');
    const isWeb = rel.startsWith('web/');
    const isServerMail = rel.startsWith('server/src/mail/');
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (line.includes('eslint-disable') || line.trim().startsWith('//') || line.trim().startsWith('*') || line.trim().startsWith('/*')) return;
      for (const { name, re } of patterns) {
        if (isWeb && WEB_LAYOUT_PX_PATTERNS.has(name)) continue;
        if (isServerMail && name === 'css px in stylesheet') continue;
        if (re.test(line)) {
          hits.push(rel + ':' + (i + 1) + ' [' + name + ']');
          break;
        }
      }
    });
  }
}

console.log('scanned files: ' + scanned);
if (hits.length) {
  console.error('UI TOKEN GATE FAILED (' + hits.length + ' hits):');
  hits.forEach(h => console.error('  ' + h));
  process.exit(1);
}
console.log('UI TOKEN GATE PASSED: no hard-coded colours, font sizes, spacing numbers, radii, shadows or opacities outside the design system.');
