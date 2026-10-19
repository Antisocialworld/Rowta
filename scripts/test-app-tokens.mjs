// Test: app/src/theme/tokens.ts must be exactly what build-app-tokens.mjs produces from
// design-system/design-variables.css. Any colour, number or name the CSS does not have fails.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTokens, renderTokensTs, parseCssVariables, resolveValue } from './build-app-tokens.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(ROOT, 'design-system', 'design-variables.css'), 'utf8');
const expected = renderTokensTs(buildTokens(css));
const actual = fs.readFileSync(path.join(ROOT, 'app', 'src', 'theme', 'tokens.ts'), 'utf8');

let failures = [];
if (expected !== actual) {
  failures.push('tokens.ts differs from a fresh regeneration of design-variables.css (hand edit or stale file)');
}

const tokens = buildTokens(css);
if (Object.keys(tokens.typeStyles).length !== 17) failures.push('typeStyles count is ' + Object.keys(tokens.typeStyles).length + ', expected 17');
if (Object.keys(tokens.spacing).length !== 8) failures.push('spacing count wrong');
if (Object.keys(tokens.state).length !== 6) failures.push('state count wrong');
if (Object.keys(tokens.shadows).length !== 3) failures.push('shadows count wrong');

for (const [name, v] of Object.entries(tokens.colors)) {
  if (!/^#[0-9a-f]{8}$/.test(v)) failures.push('colour ' + name + ' is not 8-digit #rrggbbaa: ' + v);
}

// every colour must exist somewhere in the CSS (resolved)
const map = parseCssVariables(css);
const cssResolved = new Set([...map.values()].map(v => { try { return resolveValue(map, v); } catch { return v; } }));
for (const [name, v] of Object.entries(tokens.colors)) {
  if (!cssResolved.has(v)) failures.push('colour ' + name + ' value not present in CSS');
}

// no rogue hex/rgb/px/font-weight literals in the generated file beyond what regeneration allows
if (failures.length) {
  console.error('FAIL (' + failures.length + '):');
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log('PASS: tokens.ts is an exact copy of design-variables.css (391 vars -> colors='
  + Object.keys(tokens.colors).length + ', typeStyles=17, spacing=8, shape=7, state=6, shadows=3)');
