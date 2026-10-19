// Verifies design-variables.css against the four token JSON files. No dependencies. Run: node verifyTokens.js
// Exit code 0 = every token is in the CSS with the same value, and the CSS holds nothing the JSON does not.
const fs = require('fs'), path = require('path');
const FILES = ['design-tokens.token.json', 'design-tokens.tokens.json', 'design-tokens.tokenss.json', 'design-tokens.material3.json'];
const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const px = v => (typeof v === 'number' && v !== 0 ? `${v}px` : String(v));
const css = fs.readFileSync(path.join(__dirname, 'design-variables.css'), 'utf8');
const vars = new Map(); let dup = 0;
for (const m of css.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) { if (vars.has(m[1])) dup++; vars.set(m[1], m[2].trim()); }
const resolve = (name, seen = new Set()) => {
  let v = vars.get(name); if (v === undefined || seen.has(name)) return undefined; seen.add(name);
  const r = v.match(/^var\((--[\w-]+)\)$/); return r ? resolve(r[1], seen) : v;
};
const expected = new Map(); const errors = [];
const leaves = (o, out = []) => { for (const [k, v] of Object.entries(o)) { if (v && typeof v === 'object' && (v.value !== undefined || v.fontSize)) out.push([k, v]); else if (v && typeof v === 'object') leaves(v, out); } return out; };
const add = (n, v) => { if (expected.has(n)) errors.push('duplicate token name ' + n); expected.set(n, v); };
for (const f of FILES) {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));
  for (const [cat, items] of Object.entries(d)) {
    const c = cat.toLowerCase();
    for (const [k, t] of leaves(items)) {
      const b = norm(k);
      if (c.includes('typography')) { for (const [p, x] of Object.entries(t)) if (x && x.value !== undefined) add(`--font-${b}-${norm(p)}`, x.type === 'dimension' ? px(x.value) : String(x.value)); }
      else if (t.type === 'fontFamily') add(`--font-family-${b}`, String(t.value));
      else if (t.type === 'custom-shadow') { const v = t.value; add(`--shadow-${b}`, `${px(v.offsetX)} ${px(v.offsetY)} ${px(v.radius)} ${px(v.spread)} ${v.color}`); }
      else if (t.type === 'color') add(`--color-${b}`, t.value.toLowerCase());
      else if (c === 'shape') add(`--shape-${b}`, px(t.value));
      else if (c.includes('state layer')) add(`--state-${b}`, String(t.value));
      else if (t.type === 'dimension') add(`--spacing-${b}`, typeof t.value === 'number' && t.value !== 0 ? `${t.value / 16}rem` : String(t.value));
      else errors.push(`unhandled token ${cat}/${k} (${t.type})`);
    }
  }
}
for (const [n, v] of expected) {
  const got = resolve(n);
  if (got === undefined) errors.push('MISSING in CSS: ' + n);
  else if (String(got).toLowerCase() !== String(v).toLowerCase()) errors.push(`VALUE differs: ${n} css=${got} json=${v}`);
}
for (const n of vars.keys()) if (!expected.has(n)) errors.push('ORPHAN in CSS (no JSON source): ' + n);
if (dup) errors.push(dup + ' variable(s) declared twice in the CSS');
console.log(`JSON tokens: ${expected.size}   CSS variables: ${vars.size}   errors: ${errors.length}`);
errors.forEach(e => console.log(' - ' + e));
process.exit(errors.length ? 1 : 0);
