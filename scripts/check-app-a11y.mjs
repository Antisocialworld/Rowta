// APP A11Y GATE (Phase 1 step 5) — the static half of rules X1, X7, X14a and rule 21.
// What it checks in app/src (files only; nothing is executed):
//   R1 X7    no maxFontSizeMultiplier anywhere: the app must follow the OS font scale (2.0 in the matrix).
//   R2 rule21 no setAccessibilityFocus: it is deprecated in React Native 0.88; lib/a11y's focusOn is the
//            one helper (element.focus() with sendAccessibilityEvent fallback).
//   R3 X1    every <MaterialIcons> element is either decorative (accessibilityElementsHidden) or named
//            (accessibilityLabel). A bare icon is a silent control to TalkBack.
//   R4 X1    every JSX element with onPress= outside the kit has accessibilityRole= in the same element
//            (the kit sets roles internally — Button/Chip/ShiftCard and LinkButton, which exposes
//            accessibilityRole="link"; screens must not add raw pressables without a role).
//   R5 X14a  no native disabled= on a Pressable outside the kit: waiting buttons use the kit's ready/reason
//            (dimmed + accessibilityState.disabled + focusable), never the native prop.
// Run from the repo root:  node scripts/check-app-a11y.mjs   (wired into `npm run lint --workspace @rowta/app`)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIR = path.join(ROOT, 'app', 'src');
const EXCLUDE_FILE = /(\.test\.|__tests__|\.d\.ts$)/;
const EXCLUDE_PATHS = /[\\/]i18n[\\/]/;

const KIT_PRESSABLE_TAGS = new Set(['Button', 'Chip', 'ShiftCard', 'LinkButton', 'PinnedFooter', 'Pressable', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback']);
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return [full];
  });
}

/** Body of a JSX element starting at lines[lineIndex][start] (the `<`), across lines, ending at the balanced `>`. */
function elementBody(lines, lineIndex, start) {
  let braceDepth = 0;
  let inString = null;
  let inBlockComment = false;
  const parts = [];
  for (let li = lineIndex; li < lines.length; li++) {
    const line = lines[li];
    const from = li === lineIndex ? start + 1 : 0;
    parts.push(line.slice(from));
    for (let i = from; i < line.length; i++) {
      const ch = line[i];
      if (inBlockComment) {
        if (ch === '*' && line[i + 1] === '/') {
          inBlockComment = false;
          i += 1;
        }
        continue;
      }
      if (inString !== null) {
        if (ch === inString && line[i - 1] !== '\\') inString = null;
        continue;
      }
      // Comments inside JSX expressions are not code. Before this guard, the apostrophe in
      // "attempt's" on CreateTeamScreen line 93 opened the string state, so the scan ran past the
      // Input's `/>` and attributed the following Button's onPress to the Input (Fix Round 2).
      if (braceDepth > 0 && ch === '/') {
        if (line[i + 1] === '/') {
          parts[parts.length - 1] = parts[parts.length - 1].slice(0, i - from);
          break;
        }
        if (line[i + 1] === '*') {
          inBlockComment = true;
          i += 1;
          continue;
        }
      }
      if (ch === '"' || ch === "'") inString = ch;
      else if (ch === '{') braceDepth += 1;
      else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1);
      else if (ch === '>' && braceDepth === 0) {
        parts[parts.length - 1] = line.slice(from, i + 1);
        return parts.join('\n');
      }
    }
  }
  return parts.join('\n');
}

const targets = walk(SCAN_DIR).filter((f) => /\.(ts|tsx)$/.test(f) && !EXCLUDE_FILE.test(f) && !EXCLUDE_PATHS.test(f));
const hits = [];

for (const file of targets) {
  const rel = path.relative(ROOT, file);
  const source = fs.readFileSync(file, 'utf8');
  const lines = source.split(/\r?\n/);
  const inComponents = /[\\/]components[\\/]/.test(file);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;

    if (line.includes('maxFontSizeMultiplier')) {
      hits.push(`${rel}:${lineNumber} [R1] maxFontSizeMultiplier caps the OS font scale (X7 forbids it)`);
    }
    if (line.includes('setAccessibilityFocus')) {
      hits.push(`${rel}:${lineNumber} [R2] setAccessibilityFocus is deprecated; use focusOn from lib/a11y (rule 21)`);
    }

    for (const m of line.matchAll(/<(MaterialIcons)\b/g)) {
      const body = elementBody(lines, index, m.index ?? 0);
      if (!body.includes('accessibilityElementsHidden') && !body.includes('accessibilityLabel')) {
        hits.push(`${rel}:${lineNumber} [R3] MaterialIcons is neither decorative (accessibilityElementsHidden) nor named (accessibilityLabel) (X1)`);
      }
    }

    for (const m of line.matchAll(/<([A-Z][A-Za-z]*)\b/g)) {
      const tag = m[1];
      const body = elementBody(lines, index, m.index ?? 0);
      const hasPress = body.includes('onPress=');
      if (!hasPress) continue;
      if (KIT_PRESSABLE_TAGS.has(tag)) {
        if (tag === 'Pressable' && !inComponents && !body.includes('accessibilityRole=')) {
          hits.push(`${rel}:${lineNumber} [R4] raw Pressable with onPress has no accessibilityRole (X1)`);
        }
        if (tag === 'Pressable' && !inComponents && /\bdisabled=/.test(body)) {
          hits.push(`${rel}:${lineNumber} [R5] native disabled= on Pressable; use the kit's ready/reason instead (X14a)`);
        }
        continue;
      }
      if (!body.includes('accessibilityRole=')) {
        hits.push(`${rel}:${lineNumber} [R4] <${tag}> with onPress has no accessibilityRole (X1)`);
      }
    }
  });
}

console.log(`scanned files: ${targets.length}`);
if (hits.length) {
  console.error(`A11Y GATE FAILED (${hits.length} hits):`);
  for (const h of hits) console.error('  ' + h);
  console.error('Fix the pattern or, if the rule itself is wrong, change it here with a reason (rule 21).');
  process.exit(1);
}
console.log('A11Y GATE PASSED: no capped font scale, no deprecated focus call, icons decorative or named, pressables roled, no native disabled (X1/X7/X14a).');
