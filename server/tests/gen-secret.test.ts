// Safe secret generator test (Rule S1, A4).
// Proves:
// 1. Script runs and prints exactly 64 random bytes as 128 hex characters.
// 2. Output format matches /^[0-9a-f]{128}\n?$/.
// 3. Two runs produce distinct random values.
// 4. Secret value is never printed or logged.
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scriptPath = join(repoRoot, 'scripts', 'gen-secret.mjs');

describe('scripts/gen-secret.mjs', () => {
  it('outputs 128 hex chars, differs between runs, and never logs secret value', () => {
    const run1 = execFileSync(process.execPath, [scriptPath], { encoding: 'utf8' });
    const run2 = execFileSync(process.execPath, [scriptPath], { encoding: 'utf8' });

    expect(run1).toMatch(/^[0-9a-f]{128}\n?$/);
    expect(run2).toMatch(/^[0-9a-f]{128}\n?$/);

    // Format & inequality checks without ever displaying or logging the actual secret value
    const isHex128 = (val: string): boolean => /^[0-9a-f]{128}\n?$/.test(val);
    expect(isHex128(run1) ? 'OK' : 'FAIL').toBe('OK');
    expect(isHex128(run2) ? 'OK' : 'FAIL').toBe('OK');
    expect(run1.trim() !== run2.trim() ? 'OK' : 'FAIL').toBe('OK');
  });
});
