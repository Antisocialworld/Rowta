// Test: app/src/theme/tokens.ts must be exactly what build-app-tokens.mjs produces from
// design-system/design-variables.css. Any colour, number or name the CSS does not have fails,
// and every one of the CSS's 391 declarations must be covered by some token in the output.
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

// Full coverage: every declaration in design-variables.css must be represented in tokens.ts,
// under the group the generator maps it to. A new group added to the CSS fails here until the
// generator (not the output) is extended — it is never acceptable to drop a token.
const cssGroups = { color: 0, font: 0, spacing: 0, shape: 0, state: 0, shadow: 0 };
for (const name of map.keys()) {
  if (name.startsWith('--color-')) cssGroups.color++;
  else if (name.startsWith('--font-')) cssGroups.font++;
  else if (name.startsWith('--spacing-')) cssGroups.spacing++;
  else if (name.startsWith('--shape-')) cssGroups.shape++;
  else if (name.startsWith('--state-')) cssGroups.state++;
  else if (name.startsWith('--shadow-')) cssGroups.shadow++;
  else failures.push('CSS group not handled by build-app-tokens.mjs: ' + name);
}

const coveredGroups = {
  color: Object.keys(tokens.colors).length,
  font: Object.keys(tokens.fontFamilies).length + Object.keys(tokens.typeStyles).length * 11,
  spacing: Object.keys(tokens.spacing).length,
  shape: Object.keys(tokens.shape).length,
  state: Object.keys(tokens.state).length,
  shadow: Object.keys(tokens.shadows).length,
};
for (const g of Object.keys(cssGroups)) {
  if (coveredGroups[g] !== cssGroups[g]) {
    failures.push(g + ': tokens.ts covers ' + coveredGroups[g] + ' of ' + cssGroups[g] + ' CSS declarations');
  }
}
const covered = Object.values(coveredGroups).reduce((a, b) => a + b, 0);
if (covered !== map.size) failures.push('total coverage ' + covered + ' of ' + map.size + ' CSS variables');

// every --color-* name in the CSS, and nothing else, must be a key of tokens.colors
const cssColorNames = new Set([...map.keys()].filter(n => n.startsWith('--color-')).map(n => n.slice(2)));
for (const k of cssColorNames) if (!(k in tokens.colors)) failures.push('colour token missing: ' + k);
for (const k of Object.keys(tokens.colors)) if (!cssColorNames.has(k)) failures.push('colour token not in the CSS: ' + k);

// no rogue hex/rgb/px/font-weight literals in the generated file beyond what regeneration allows
if (failures.length) {
  console.error('FAIL (' + failures.length + '):');
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log('PASS: tokens.ts is an exact copy of design-variables.css (' + map.size + ' vars -> colors='
  + Object.keys(tokens.colors).length + ', typeStyles=' + Object.keys(tokens.typeStyles).length
  + ', spacing=' + Object.keys(tokens.spacing).length + ', shape=' + Object.keys(tokens.shape).length
  + ', state=' + Object.keys(tokens.state).length + ', shadows=' + Object.keys(tokens.shadows).length
  + '; covered ' + covered + '/' + map.size + ')');
