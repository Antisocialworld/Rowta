// test-input-attributes.ts — verifies that the shared Input sets id and name,
// and that all autoComplete tokens in app/src are valid HTML autocomplete tokens (rules U5, X1).
// Pure text scan only — never imports components or react-native.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures += 1;
}

const ROOT = resolve(__dirname, '..');
const INPUT_PATH = resolve(ROOT, 'src/components/Input.tsx');

console.log('--- 1. Shared Input component existence and attributes ---');
check(existsSync(INPUT_PATH), 'Input.tsx exists');

const inputSrc = existsSync(INPUT_PATH) ? readFileSync(INPUT_PATH, 'utf8') : '';

// Verify that Input.tsx sets id, name, and nativeID on TextInput
check(
  /<TextInput[\s\S]*?\bid=\{[^}]+\}/.test(inputSrc),
  'Input.tsx passes id prop to TextInput',
);
check(
  /<TextInput[\s\S]*?\bname=\{[^}]+\}/.test(inputSrc),
  'Input.tsx passes name prop to TextInput',
);
check(
  /<TextInput[\s\S]*?\bnativeID=\{[^}]+\}/.test(inputSrc),
  'Input.tsx passes nativeID prop to TextInput',
);

// Verify that Input.tsx derives inputId and inputName
check(
  inputSrc.includes('const inputName =') || inputSrc.includes('const derivedName ='),
  'Input.tsx derives stable inputName',
);
check(
  inputSrc.includes('const inputId =') || inputSrc.includes('const derivedId ='),
  'Input.tsx derives stable inputId',
);

// Verify that mapAutoComplete function exists in Input.tsx
check(
  inputSrc.includes('function mapAutoComplete'),
  'Input.tsx defines mapAutoComplete helper',
);
check(
  inputSrc.includes("'current-password'"),
  "Input.tsx uses standard 'current-password' token",
);

console.log('\n--- 2. Scan all autoComplete values across app/src ---');

const VALID_HTML_AUTOCOMPLETE_TOKENS = new Set([
  'email',
  'username',
  'current-password',
  'new-password',
  'one-time-code',
  'name',
  'off',
  'on',
  'tel',
  'url',
  'street-address',
  'postal-code',
  'country',
  'additional-name',
  'family-name',
  'given-name',
  'honorific-prefix',
  'honorific-suffix',
  'nickname',
  'organization',
  'organization-title',
]);

const SRC_DIR = resolve(ROOT, 'src');

function getAllFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...getAllFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

const files = getAllFiles(SRC_DIR);
check(files.length > 50, `Found ${files.length} source files to scan in app/src`);

// Check that no file uses non-standard autoComplete: 'password'
let foundNonStandardPassword = false;
const extractedTokens: Array<{ file: string; token: string }> = [];

for (const file of files) {
  const content = readFileSync(file, 'utf8');
  // Match autoComplete: 'token' or autoComplete="token"
  const regex = /autoComplete(?::\s*['"]([^'"]+)['"]|=\s*['"]([^'"]+)['"])/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const token = match[1] || match[2];
    if (token) {
      extractedTokens.push({ file: file.replace(ROOT, ''), token });
      if (token === 'password') {
        foundNonStandardPassword = true;
      }
    }
  }
}

check(!foundNonStandardPassword, "No file in app/src uses non-standard autoComplete: 'password'");

for (const { file, token } of extractedTokens) {
  const isValid = VALID_HTML_AUTOCOMPLETE_TOKENS.has(token);
  check(isValid, `Valid autocomplete token "${token}" in ${file}`);
}

if (failures > 0) {
  console.error(`Input attribute checks failed with ${failures} error(s).`);
  process.exit(1);
} else {
  console.log(`All input attribute checks passed (${extractedTokens.length} tokens checked).`);
}

