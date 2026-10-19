#!/usr/bin/env node
// GENERATED-FILE BUILDER — scripts/build-app-tokens.mjs
// Reads design-system/design-variables.css (READ-ONLY) and COPIES its values into app/src/theme/tokens.ts.
// Transformations allowed (and the only ones): resolve var() references to their literal value;
// convert rem spacing to px numbers (16px root, the documented scale); convert px strings to numbers
// inside type styles. Colours stay byte-identical to the CSS (8-digit #rrggbbaa, alpha last).
// Light theme only while Q9 is open. Run: node scripts/build-app-tokens.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS_PATH = path.join(ROOT, 'design-system', 'design-variables.css');
const OUT_PATH = path.join(ROOT, 'app', 'src', 'theme', 'tokens.ts');

export function parseCssVariables(css) {
  const map = new Map();
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    map.set(m[1], m[2].trim());
  }
  return map;
}

export function resolveValue(map, value, depth = 0) {
  if (depth > 10) throw new Error('var() cycle resolving ' + value);
  const m = value.match(/^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]+))?\)$/i);
  if (!m) return value;
  const target = map.get(m[1]);
  if (target === undefined) {
    if (m[2] !== undefined) return resolveValue(map, m[2].trim(), depth + 1);
    throw new Error('unresolved var ' + m[1]);
  }
  return resolveValue(map, target, depth + 1);
}

function pxToNumber(v) {
  const m = String(v).match(/^(-?\d+(?:\.\d+)?)px$/);
  return m ? Number(m[1]) : v;
}

function remToPxNumber(v) {
  const m = String(v).match(/^(-?\d+(?:\.\d+)?)rem$/);
  return m ? Number(m[1]) * 16 : v;
}

function jsonToTsLiteral(value, indent = 0) {
  const pad = '  '.repeat(indent);
  const padIn = '  '.repeat(indent + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return '[\n' + value.map(v => padIn + jsonToTsLiteral(v, indent + 1) + ',').join('\n') + '\n' + pad + ']';
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    return '{\n' + keys.map(k => padIn + JSON.stringify(k) + ': ' + jsonToTsLiteral(value[k], indent + 1) + ',').join('\n') + '\n' + pad + '}';
  }
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

export function buildTokens(css) {
  const map = parseCssVariables(css);
  const get = name => resolveValue(map, map.get(name));

  const colors = {};
  for (const name of map.keys()) {
    if (name.startsWith('--color-')) colors[name.slice(2)] = get(name);
  }

  const fontFamilies = {
    primary: get('--font-family-primary'),
    secondary: get('--font-family-secondary'),
  };

  const styleGroups = ['display', 'headline', 'title', 'subtitle', 'body', 'label'];
  const typeStyles = {};
  for (const g of styleGroups) {
    for (const size of ['large', 'medium', 'small']) {
      const prefix = `--font-${g}-${size}-`;
      if (!map.has(prefix + 'fontsize')) continue;
      typeStyles[`${g}-${size}`] = {
        fontSize: pxToNumber(get(prefix + 'fontsize')),
        fontWeight: get(prefix + 'fontweight'),
        fontFamily: get(prefix + 'fontfamily'),
        fontStyle: get(prefix + 'fontstyle'),
        letterSpacing: pxToNumber(get(prefix + 'letterspacing')),
        lineHeight: pxToNumber(get(prefix + 'lineheight')),
        textDecoration: get(prefix + 'textdecoration'),
        textCase: get(prefix + 'textcase'),
        fontStretch: get(prefix + 'fontstretch'),
        paragraphIndent: get(prefix + 'paragraphindent'),
        paragraphSpacing: get(prefix + 'paragraphspacing'),
      };
    }
  }

  const spacingNames = {
    '--spacing-no-spacing': 'noSpacing',
    '--spacing-extra-small-spacing': 'extraSmall',
    '--spacing-small-spacing': 'small',
    '--spacing-medium': 'medium',
    '--spacing-base-spacing': 'base',
    '--spacing-large-spacing': 'large',
    '--spacing-extra-large': 'extraLarge',
    '--spacing-very-large': 'veryLarge',
  };
  const spacing = {};
  for (const [cssName, key] of Object.entries(spacingNames)) spacing[key] = remToPxNumber(get(cssName));

  const shapeNames = {
    '--shape-corner-none': 'none',
    '--shape-corner-extra-small': 'extraSmall',
    '--shape-corner-small': 'small',
    '--shape-corner-medium': 'medium',
    '--shape-corner-large': 'large',
    '--shape-corner-extra-large': 'extraLarge',
    '--shape-corner-full': 'full',
  };
  const shape = {};
  for (const [cssName, key] of Object.entries(shapeNames)) shape[key] = pxToNumber(get(cssName));

  const stateNames = {
    '--state-hover': 'hover',
    '--state-focus': 'focus',
    '--state-pressed': 'pressed',
    '--state-dragged': 'dragged',
    '--state-disabled-container': 'disabledContainer',
    '--state-disabled-content': 'disabledContent',
  };
  const state = {};
  for (const [cssName, key] of Object.entries(stateNames)) state[key] = Number(get(cssName));

  const shadowNames = {
    '--shadow-hard-shadow': 'hardShadow',
    '--shadow-medium': 'medium',
    '--shadow-soft': 'soft',
  };
  const shadows = {};
  for (const [cssName, key] of Object.entries(shadowNames)) shadows[key] = get(cssName);

  return { colors, fontFamilies, typeStyles, spacing, shape, state, shadows };
}

export function renderTokensTs(tokens) {
  const header = [
    '// GENERATED FILE — built by scripts/build-app-tokens.mjs from design-system/design-variables.css.',
    '// DO NOT EDIT BY HAND. Values are COPIED from the CSS: only var() references are resolved,',
    '// rem spacing is converted to px numbers (16px root) and px strings inside type styles become numbers.',
    '// Colours are 8-digit #rrggbbaa (alpha last; React Native accepts alpha last). Light theme only (Q9 open).',
    '/* eslint-disable */',
    '',
  ].join('\n');
  return header
    + 'export const colors = ' + jsonToTsLiteral(tokens.colors) + ' as const;\n\n'
    + 'export const fontFamilies = ' + jsonToTsLiteral(tokens.fontFamilies) + ' as const;\n\n'
    + 'export const typeStyles = ' + jsonToTsLiteral(tokens.typeStyles) + ' as const;\n\n'
    + 'export const spacing = ' + jsonToTsLiteral(tokens.spacing) + ' as const;\n\n'
    + 'export const shape = ' + jsonToTsLiteral(tokens.shape) + ' as const;\n\n'
    + 'export const state = ' + jsonToTsLiteral(tokens.state) + ' as const;\n\n'
    + 'export const shadows = ' + jsonToTsLiteral(tokens.shadows) + ' as const;\n\n'
    + 'export const tokens = { colors, fontFamilies, typeStyles, spacing, shape, state, shadows };\n'
    + 'export type Tokens = typeof tokens;\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const css = fs.readFileSync(CSS_PATH, 'utf8');
  const tokens = buildTokens(css);
  const out = renderTokensTs(tokens);
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, out, 'utf8');
  console.log('wrote app/src/theme/tokens.ts');
  console.log('colors=' + Object.keys(tokens.colors).length
    + ' typeStyles=' + Object.keys(tokens.typeStyles).length
    + ' spacing=' + Object.keys(tokens.spacing).length
    + ' shape=' + Object.keys(tokens.shape).length
    + ' state=' + Object.keys(tokens.state).length
    + ' shadows=' + Object.keys(tokens.shadows).length);
}
