// Rule: the Zod schema in src/config/env.ts and the names in .env.example must be the same set.
// This test is the drift detector (skill rowta-server-foundation-recipes section 1).
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ENV_NAMES } from '../src/config/env.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

// Names only. .env.example has empty values by design, and this test never reads .env (S2).
function exampleNames(): string[] {
  const text = readFileSync(resolve(repoRoot, '.env.example'), 'utf8');
  const names: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (match?.[1]) names.push(match[1]);
  }
  return names.sort();
}

describe('env parity', () => {
  it('schema keys and .env.example names are the same set', () => {
    expect([...ENV_NAMES]).toEqual(exampleNames());
  });

  // 49 = 50 minus MAILPIT_UI_PORT, removed with the mail catcher (owner decision 22 Oct 2026).
  // The count is a drift LOCK: if a name is added or removed anywhere, update it here on purpose.
  it('.env.example declares exactly 49 names', () => {
    expect(exampleNames()).toHaveLength(49);
  });

  it('ENV_NAMES is sorted and unique', () => {
    expect([...ENV_NAMES].sort()).toEqual([...ENV_NAMES]);
    expect(new Set(ENV_NAMES).size).toBe(ENV_NAMES.length);
  });
});
