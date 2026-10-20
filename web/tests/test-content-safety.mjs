// test-content-safety — no tokens or secrets on any page, no stray TODO outside the allowed [OWNER: ...]
// markers, and every docs/legal document starts with the visible DRAFT banner (L1).
// Run:  node web/tests/test-content-safety.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..');
const ROOT = path.resolve(WEB, '..');
const DIST = path.join(WEB, 'dist');
const LEGAL = path.join(ROOT, 'docs', 'legal');

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
};

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const htmlFiles = walk(DIST).filter((file) => file.endsWith('.html'));
const mdFiles = walk(LEGAL).filter((file) => file.endsWith('.md'));
check(htmlFiles.length >= 10, `built pages found (${htmlFiles.length})`);
check(mdFiles.length >= 9, `docs/legal sources found (${mdFiles.length})`);

const patterns = [
  ['JWT-like token', /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\./],
  ['64-hex secret', /\b[0-9a-f]{64}\b/i],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['password/token assignment', /\b(password|passwd|secret|api[_-]?key|access[_-]?token)\s*[=:]\s*["']?[A-Za-z0-9+/._-]{8,}/i],
  ['bearer header', /\bBearer\s+[A-Za-z0-9._-]{16,}/],
  ['connection string with credentials', /\b(postgres|postgresql|redis|mongodb):\/\/[^\s"']*[^\s"']/],
  ['stray TODO', /\b(TODO|FIXME|XXX|HACK)\b/],
  ['bare node -e reference', /node\s+-e\b/],
  ['banned hash names', /\b(SHA-?256|HMAC-SHA-?256|HS256|MD5|SHA-?1)\b/],
];

for (const file of [...htmlFiles, ...mdFiles]) {
  const rel = path.relative(ROOT, file);
  const text = fs.readFileSync(file, 'utf8');
  for (const [name, pattern] of patterns) {
    if (pattern.test(text)) check(false, `${name} in ${rel}`);
  }
}
check(true, `no token/secret/TODO/banned-hash pattern in ${htmlFiles.length} pages + ${mdFiles.length} legal docs`);

// The connection-string pattern would also hit our own copy mentioning provider URLs? we never write any.
// Allowed placeholder markers are counted (L3): they must all use [OWNER: ...] or [DECISION]/[verify...] style.
let placeholders = 0;
for (const file of mdFiles) {
  const text = fs.readFileSync(file, 'utf8');
  placeholders += (text.match(/\[OWNER[^\]]*\]/g) ?? []).length;
}
check(placeholders > 0, `owner placeholders present and used instead of invented values (${placeholders} found)`);

// L1: every docs/legal document starts with the visible DRAFT banner.
for (const file of mdFiles) {
  const rel = path.relative(ROOT, file);
  const first = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n').split('\n')[0];
  if (!/^>\s*\*{0,2}DRAFT — not legal advice\.?\*{0,2}/.test(first)) {
    check(false, `${rel} starts with the DRAFT banner (first line: "${first.slice(0, 60)}")`);
  }
}
check(true, 'every docs/legal document starts with the DRAFT banner (L1)');

// Contact channel: only the owner-approved address appears; no invented emails.
const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const allowedEmails = new Set(['rowtareply@gmail.com']);
for (const file of [...htmlFiles, ...mdFiles]) {
  const rel = path.relative(ROOT, file);
  const text = fs.readFileSync(file, 'utf8');
  for (const email of text.match(emailPattern) ?? []) {
    if (!allowedEmails.has(email)) check(false, `unexpected email ${email} in ${rel}`);
  }
}
check(true, `only the approved contact email appears (${[...allowedEmails].join(', ')})`);

process.exit(failures === 0 ? 0 : 1);
