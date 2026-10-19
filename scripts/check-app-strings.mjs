#!/usr/bin/env node
// GATE: no hard-coded user-facing string in app/src (rule U8, PRD 11).
// Every visible word must come from app/src/i18n/en.ts through t(). This script fails (exit 1) when it finds
//   (a) inline JSX text — <Text>Sign in</Text> (the >text< pair on one line, prose only)
//   (b) wrapped JSX text — a standalone line of prose between tags (<Text> / newline / Sign in / newline / </Text>)
//   (c) a free-text UI prop assigned a string literal — accessibilityLabel="Close", title: 'Sign in'
// A prop may carry a catalog KEY (dot form, e.g. "auth.view.signIn.title"), because the component then calls t().
// The catalog itself, tests, type declarations, comments and pure code lines are excluded by construction:
// code carries = ( ) { } ; : ` characters, prose does not. Run: node scripts/check-app-strings.mjs
// Deliberate failure is proved by pointing it at a probe file: node scripts/check-app-strings.mjs <file>.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIR = path.join(ROOT, 'app', 'src');
const EXCLUDE_DIRS = new Set(['i18n', 'node_modules']);
const EXCLUDE_FILE = /(\.test\.tsx?|\.d\.ts)$/;

const TEXT_PROPS =
  /\b(accessibilityLabel|accessibilityHint|title|label|placeholder|hint|message|announcement|description|subtitle|caption)\s*([=:])\s*(["'])([^"']{1,300})\3/g;
const CATALOG_KEY = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/;

// Inline JSX text: a > that is not from /> (self-closing), => (arrow) or >= / -> (operators), followed by prose
// without any code character, then a <. Prose must contain a letter.
// (same-line `>text<` detection is done inside the tag machine below, so comparisons like `a > 0 && b < N`
// inside a {expression} are never mistaken for JSX children — proven by the probe in the gate checklist.)
// A standalone line that is prose only: starts with a letter, contains no code characters (quotes, brackets,
// operators, statements), does not begin with a JS/TS keyword, and ends with a letter or prose punctuation.
// This catches wrapped JSX text; any line of code trips one of those tests. The keyword test is case-sensitive,
// so catalog words like "Continue" or "Delete your team" are not confused with `continue`/`delete`.
const PROSE_LINE = /^[A-Za-z][A-Za-z0-9 ,.'’\u2013!?&/\u2014-]*[A-Za-z0-9.!?'\u2019]$/;
const CODE_CHARS = /[{}=;:`'"<>()\[\]|@#$~^\\*]/;
const KEYWORDS = new Set([
  'return', 'import', 'export', 'const', 'let', 'var', 'if', 'else', 'switch', 'case', 'from', 'type',
  'interface', 'await', 'async', 'function', 'class', 'new', 'throw', 'yield', 'do', 'while', 'for', 'try',
  'catch', 'finally', 'break', 'continue', 'default', 'void', 'typeof', 'instanceof', 'delete', 'in', 'of',
  'as', 'is', 'keyof', 'extends', 'implements', 'declare', 'readonly', 'true', 'false', 'null', 'undefined',
  'this', 'super', 'with', 'debugger', 'enum', 'namespace', 'module', 'get', 'set',
]);

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!EXCLUDE_DIRS.has(e.name)) yield* walk(p);
    } else if (e.isFile()) {
      yield p;
    }
  }
}

const targets = process.argv[2]
  ? [path.resolve(ROOT, process.argv[2])]
  : [...walk(SCAN_DIR)].filter((f) => /\.(ts|tsx)$/.test(f) && !EXCLUDE_FILE.test(f));

const hits = [];
for (const file of targets) {
  const rel = path.relative(ROOT, file);
  const isTsx = file.endsWith('.tsx');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

  // Tag state machine (tsx only): are we between <Tag and its closing >, ignoring > that lives inside {braces}
  // or strings? Wrapped prose is only reported OUTSIDE tags, so multi-line attributes like `accessible` are code.
  let inTag = false;
  let braceDepth = 0;
  let inString = null;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    const startedInTag = inTag;
    const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('*/');

    if (!isComment) {
      if (isTsx) {
        if (
          !startedInTag &&
          !CODE_CHARS.test(trimmed) &&
          PROSE_LINE.test(trimmed) &&
          !KEYWORDS.has(trimmed.split(/\s+/)[0] ?? '')
        ) {
          hits.push(`${rel}:${lineNumber} [jsx text line] ${JSON.stringify(trimmed.slice(0, 60))}`);
        }
        // One position-aware pass: the tag machine AND same-line children detection, so a `>` or `<` inside a
        // {expression} (comparisons) can never masquerade as tag delimiters.
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          const next = line[i + 1];
          if (inTag) {
            if (inString !== null) {
              if (ch === inString && line[i - 1] !== '\\') inString = null;
            } else if (ch === '"' || ch === "'") {
              inString = ch;
            } else if (ch === '{') {
              braceDepth += 1;
            } else if (ch === '}') {
              braceDepth = Math.max(0, braceDepth - 1);
            } else if (ch === '>' && braceDepth === 0) {
              inTag = false;
              let j = i + 1;
              let text = '';
              while (j < line.length) {
                const c2 = line[j];
                if (c2 === '{') {
                  let depth = 1;
                  j += 1;
                  while (j < line.length && depth > 0) {
                    if (line[j] === '{') depth += 1;
                    else if (line[j] === '}') depth -= 1;
                    j += 1;
                  }
                  continue;
                }
                if (c2 === '<') break;
                text += c2;
                j += 1;
              }
              const value = text.trim();
              // same prose class the gate has always used: code punctuation disqualifies the run
              if (/^[^<>{}()=;:`]{1,200}$/.test(value) && /[A-Za-z]/.test(value)) {
                hits.push(`${rel}:${lineNumber} [jsx text] ${JSON.stringify(value.slice(0, 60))}`);
              }
              i = j - 1;
            }
          } else if (ch === '<' && (/[A-Za-z/>]/.test(next ?? '') || next === undefined)) {
            inTag = true;
            braceDepth = 0;
            inString = null;
          }
        }
      }
    }

    for (const m of line.matchAll(TEXT_PROPS)) {
      const value = m[4].trim();
      if (value.length === 0) continue;
      if (CATALOG_KEY.test(value)) continue; // a key handed to t(), not display text
      if (value.startsWith('{') || value.startsWith('t(')) continue;
      hits.push(`${rel}:${lineNumber} [${m[1]}${m[2]}] ${JSON.stringify(value.slice(0, 60))}`);
    }
  });
}

console.log(`scanned files: ${targets.length}`);
if (hits.length) {
  console.error(`STRING GATE FAILED (${hits.length} hits):`);
  for (const h of hits) console.error('  ' + h);
  console.error('Move every visible word into app/src/i18n/en.ts and render it with t().');
  process.exit(1);
}
console.log('STRING GATE PASSED: no hard-coded user-facing text in app/src (catalog only, rule U8).');
