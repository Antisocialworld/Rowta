// Data-access discipline: only src/db/** may import the generated Prisma clients (PRD 9.4, S7).
// A static scan proves no route, middleware or job reaches around the shard router.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '..', 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const files = walk(srcDir);

describe('data-access layering', () => {
  it('only src/db/** imports the generated Prisma clients', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(srcDir, file).replace(/\\/g, '/');
      if (rel.startsWith('db/')) continue;
      const text = readFileSync(file, 'utf8');
      if (/prisma\/generated\/db[01]/.test(text)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('the generated clients are not imported anywhere under src except src/db/clients.ts', () => {
    const importers = files
      .filter((f) => /prisma\/generated\/db[01]/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(srcDir, f).replace(/\\/g, '/'))
      .sort();
    expect(importers).toEqual(['db/clients.ts']);
  });

  it('src/db/clients.ts exports the four routing entry points', async () => {
    const mod = await import('../src/db/clients.ts');
    expect(typeof mod.globalDb).toBe('function');
    expect(typeof mod.forTeam).toBe('function');
    expect(typeof mod.readDb).toBe('function');
    expect(typeof mod.writeDb).toBe('function');
    expect(typeof mod.closeAllDatabases).toBe('function');
  });

  it('readDb and writeDb return the same client until a replica exists (PRD 9.4)', async () => {
    const mod = await import('../src/db/clients.ts');
    expect(mod.readDb(0)).toBe(mod.writeDb(0));
    expect(mod.readDb(1)).toBe(mod.writeDb(1));
  });

  it('forTeam routes to the same shard as shardFor', async () => {
    const mod = await import('../src/db/clients.ts');
    const { shardFor } = await import('../src/db/shard.ts');
    const id = '11111111-2222-3333-4444-555555555555';
    expect(mod.forTeam(id)).toBe(mod.writeDb(shardFor(id)));
  });

  it('globalDb is shard 0', async () => {
    const mod = await import('../src/db/clients.ts');
    expect(mod.globalDb()).toBe(mod.writeDb(0));
  });
});
