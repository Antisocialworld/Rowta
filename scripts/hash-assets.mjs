// BLAKE2B512 digests for generated asset files — the icons gate evidence (phase-1.md) proves the pipeline is
// deterministic: run `npm run icons` twice and compare the two digest sets (never SHA-256, rule A2/A4).
// Run from the repo root:  node scripts/hash-assets.mjs [dir]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = process.argv[2] ?? path.join(ROOT, 'app', 'assets');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (entry.name === '.gitkeep') return [];
    return [full];
  });
}

const files = walk(DIR).sort();
for (const file of files) {
  const digest = crypto.createHash('blake2b512').update(fs.readFileSync(file)).digest('hex');
  console.log(`${digest}  ${path.relative(ROOT, file)}`);
}
