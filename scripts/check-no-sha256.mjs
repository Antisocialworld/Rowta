#!/usr/bin/env node
// check-no-sha256.mjs — scans server/src, shared/src, and app/src to verify
// that SHA-256 and other banned hashing algorithms are completely absent (Rule A4).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SCAN_DIRS = [
  join(repoRoot, 'server', 'src'),
  join(repoRoot, 'shared', 'src'),
  join(repoRoot, 'app', 'src'),
  join(repoRoot, 'server', 'prisma', 'sql'),
];

const BANNED_PATTERNS = [
  { name: 'SHA-256 / SHA256 / HMAC-SHA256', regex: /\b(sha-?256|hmac-sha-?256|hs256|rs256|es256|ps256)\b/i },
  { name: 'MD5', regex: /\bmd5\b/i },
  { name: 'SHA-1', regex: /\bsha-?1\b/i },
];

function collectFiles(dir) {
  const results = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        results.push(...collectFiles(full));
      } else if (/\.(ts|tsx|js|jsx|mjs|cjs|json|sql)$/.test(entry)) {
        results.push(full);
      }
    }
  } catch {}
  return results;
}

let violations = 0;
let fileCount = 0;

for (const dir of SCAN_DIRS) {
  const files = collectFiles(dir);
  for (const file of files) {
    fileCount++;
    const content = readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const banned of BANNED_PATTERNS) {
        if (banned.regex.test(line)) {
          // Check if this is an allowed exception (e.g. comment citing rule A4 prohibition)
          const rel = relative(repoRoot, file).replace(/\\/g, '/');
          console.error(`BANNED ALGORITHM HIT [${banned.name}]: ${rel}:${i + 1}`);
          console.error(`  > ${line.trim()}`);
          violations++;
        }
      }
    }
  }
}

if (violations > 0) {
  console.error(`\nFAILED: Found ${violations} banned algorithm hit(s) across ${fileCount} files.`);
  process.exit(1);
} else {
  console.log(`BANNED ALGORITHM SCAN PASSED: 0 hits across ${fileCount} files in server/src, shared/src, app/src, server/prisma/sql.`);
  process.exit(0);
}
