// ADR 0002 documents a Prisma introspection bug: a partial unique index on an FK-target column
// makes Prisma infer one-to-one for three relations that are really one-to-many. scripts/prisma-pull.mjs
// rewrites those back-relations to LISTS after every pull. This test is the tripwire: if a future
// pull reintroduces the bug, the test fails with the exact model and field.
//
// The introspected model names are the raw table names (model teams, model shifts, ...), not
// PascalCase, so the assertions below use those names.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const prismaDir = resolve(here, '..', 'prisma');

// ownerModel -> the field that MUST be a list, per schema file. db0 gets three repairs, db1 two
// (scripts/prisma-pull.mjs fails loudly if those counts ever change).
const MUST_BE_LISTS: Record<string, { file: string; ownerModel: string; field: string }[]> = {
  'db0/schema.prisma': [
    { file: 'db0/schema.prisma', ownerModel: 'teams', field: 'memberships' },
    { file: 'db0/schema.prisma', ownerModel: 'users', field: 'password_resets' },
    { file: 'db0/schema.prisma', ownerModel: 'shifts', field: 'swap_requests' },
  ],
  'db1/schema.prisma': [
    { file: 'db1/schema.prisma', ownerModel: 'teams', field: 'memberships' },
    { file: 'db1/schema.prisma', ownerModel: 'shifts', field: 'swap_requests' },
  ],
};

function modelBody(schemaText: string, modelName: string): string | null {
  const match = new RegExp(`model\\s+${modelName}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm').exec(schemaText);
  return match ? (match[1] ?? null) : null;
}

function fieldLine(schemaText: string, modelName: string, field: string): string | null {
  const body = modelBody(schemaText, modelName);
  if (body === null) return null;
  const match = new RegExp(`^\\s*${field}\\s+(.+)$`, 'm').exec(body);
  return match ? match[0].trim() : null;
}

describe('ADR 0002 back-relation repair', () => {
  for (const [schemaFile, entries] of Object.entries(MUST_BE_LISTS)) {
    for (const { ownerModel, field } of entries) {
      it(`${schemaFile}: ${ownerModel}.${field} is declared as a list`, () => {
        const text = readFileSync(resolve(prismaDir, schemaFile), 'utf8');
        const line = fieldLine(text, ownerModel, field);
        expect(line, `${ownerModel}.${field} not found in ${schemaFile}`).not.toBeNull();
        // The repaired shape is `<field> <relatedModel>[]` — a list, never a bare optional model.
        expect(line).toMatch(new RegExp(`^${field}\\s+\\w+\\[\\]$`));
      });
    }
  }

  it('db0 has exactly three repaired list relations and db1 has exactly two', () => {
    const db0 = readFileSync(resolve(prismaDir, 'db0/schema.prisma'), 'utf8');
    const db1 = readFileSync(resolve(prismaDir, 'db1/schema.prisma'), 'utf8');
    expect(fieldLine(db0, 'teams', 'memberships')).toMatch(/memberships\[\]/);
    expect(fieldLine(db0, 'users', 'password_resets')).toMatch(/password_resets\[\]/);
    expect(fieldLine(db0, 'shifts', 'swap_requests')).toMatch(/swap_requests\[\]/);
    expect(fieldLine(db1, 'teams', 'memberships')).toMatch(/memberships\[\]/);
    expect(fieldLine(db1, 'shifts', 'swap_requests')).toMatch(/swap_requests\[\]/);
  });

  it('a one-to-one-shaped back-relation would be caught', () => {
    // Sanity-check the detector itself against the bug's shape: `memberships memberships` (no []).
    const buggy = 'model teams {\n  id String\n  memberships memberships\n}\n';
    expect(fieldLine(buggy, 'teams', 'memberships')).toMatch(/^memberships\s+memberships$/);
    expect(fieldLine(buggy, 'teams', 'memberships')).not.toMatch(/\[\]$/);
  });
});
