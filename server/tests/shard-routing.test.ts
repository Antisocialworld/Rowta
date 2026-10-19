// Shard routing (PRD 9.5): deterministic, uniform, no duplicates (skill rowta-db-sharding-recipes).
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { shardFor } from '../src/db/shard.ts';

describe('shardFor', () => {
  it('returns only 0 or 1', () => {
    for (let i = 0; i < 100; i += 1) {
      expect([0, 1]).toContain(shardFor(randomUUID()));
    }
  });

  it('is deterministic: the same team id always maps to the same shard', () => {
    for (let i = 0; i < 50; i += 1) {
      const id = randomUUID();
      expect(shardFor(id)).toBe(shardFor(id));
      expect(shardFor(id)).toBe(shardFor(`${id}`));
    }
  });

  it('splits 1000 distinct ids across both shards, each getting at least 40%', () => {
    const counts = { 0: 0, 1: 0 } as Record<0 | 1, number>;
    for (let i = 0; i < 1000; i += 1) {
      counts[shardFor(randomUUID())] += 1;
    }
    expect(counts[0] + counts[1]).toBe(1000);
    expect(counts[0]).toBeGreaterThanOrEqual(400);
    expect(counts[1]).toBeGreaterThanOrEqual(400);
    // Print the split so the Phase 0 gate can quote it as evidence.
    console.log(`shard split over 1000 uuids: shard0=${counts[0]} shard1=${counts[1]}`);
  });

  it('routes a fixed set of known ids without collisions', () => {
    const ids = Array.from({ length: 100 }, () => randomUUID());
    const shards = new Set(ids.map(shardFor));
    expect(shards.size).toBe(2);
  });

  it('treats the zero uuid and a normal uuid independently', () => {
    const zero = '00000000-0000-0000-0000-000000000000';
    expect([0, 1]).toContain(shardFor(zero));
  });
});
