import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const OLD = ['ro', 'ta'].join('');
const OLD_CAP = OLD[0].toUpperCase() + OLD.slice(1);
const OLD_UP = OLD.toUpperCase();

const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|ttf|otf|woff2?|pdf|zip|gz|db|sqlite|heic|mp4|mov)$/i;

const SKIP_DIRS = new Set(['.git', 'node_modules', OLD + '-old-backup', 'rowta-old-backup']);
const SKIP_ROOT_FILES = new Set(['name', 'note', 'version', 'generated', 'README_1.md', 'convertTokens.js', '.env', 'fix-env-name.mjs']);
const REPORT_ONLY_DIRS = [
  path.join('.agents', 'rules'),
  path.join('.agents', 'skills'),
  path.join('.agents', 'PRD'),
  'design-system',
];

const STRAY_TRANSPORT = [
  new RegExp('^' + OLD + '-scaffold.*\\.(md|json)$', 'i'),
  new RegExp('^rowta-scaffold.*\\.(md|json)$', 'i'),
];

function isSkipPath(rel) {
  const parts = rel.split(path.sep);
  if (parts.some(p => SKIP_DIRS.has(p))) return true;
  if (parts.length === 1 && SKIP_ROOT_FILES.has(rel)) return true;
  const base = parts[parts.length - 1];
  if (STRAY_TRANSPORT.some(re => re.test(base))) return true;
  if (/^sql-.*\.md$/i.test(base)) return true;
  if (/^docs-.*\.md$/i.test(base)) return true;
  if (/_1\.[a-z]+$/i.test(base)) return true;
  return false;
}

function reportOnly(rel) {
  return REPORT_ONLY_DIRS.some(d => rel === d || rel.startsWith(d + path.sep));
}

const WORD = new RegExp(
  '(?<![A-Za-z0-9])(' + OLD_UP + '|' + OLD_CAP + '|' + OLD + ')(?![A-Za-z0-9])',
  'g'
);

function maskLine(text) {
  let out = text;
  if (/^\s*[A-Za-z0-9_]*(PASSWORD|SECRET|KEY|TOKEN|URL|DSN)[A-Za-z0-9_]*\s*=/i.test(out)) {
    const eq = out.indexOf('=');
    out = out.slice(0, eq + 1) + ' <masked>';
  }
  out = out.replace(/https?:\/\/\S+/g, '<url>');
  return out.trim();
}

const contentHits = [];
const nameHits = [];
const reportHits = [];

function scanFile(abs, rel) {
  let buf;
  try {
    buf = fs.readFileSync(abs);
  } catch {
    return;
  }
  if (BINARY_EXT.test(rel) || buf.includes(0)) return;
  const lines = buf.toString('utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    WORD.lastIndex = 0;
    if (WORD.test(line)) {
      const entry = { rel: rel.split(path.sep).join('/'), line: i + 1, text: maskLine(line) };
      if (reportOnly(rel)) reportHits.push(entry);
      else contentHits.push(entry);
    }
  });
}

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    const rel = path.relative(ROOT, abs);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      WORD.lastIndex = 0;
      if (!isSkipPath(rel) && WORD.test(e.name)) {
        nameHits.push({ rel: rel.split(path.sep).join('/'), line: 0, text: '<directory name>' });
      }
      WORD.lastIndex = 0;
      walk(abs);
    } else if (e.isFile()) {
      if (isSkipPath(rel)) continue;
      WORD.lastIndex = 0;
      if (WORD.test(e.name)) {
        nameHits.push({ rel: rel.split(path.sep).join('/'), line: 0, text: '<file name>' });
      }
      WORD.lastIndex = 0;
      scanFile(abs, rel);
    }
  }
}

walk(ROOT);

function print(title, hits) {
  console.log(`=== ${title} (${hits.length}) ===`);
  for (const h of hits) console.log(`${h.rel}:${h.line}: ${h.text}`);
}
print('TO FIX (outside protected areas)', contentHits);
print('NAME HITS (dirs/files)', nameHits);
print('REPORT ONLY (rules/skills/PRD/design-system - never edited)', reportHits);
console.log(`TOTAL fix=${contentHits.length} names=${nameHits.length} reportOnly=${reportHits.length}`);
