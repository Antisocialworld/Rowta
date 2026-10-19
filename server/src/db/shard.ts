// Shard routing (PRD 7.1, 9.5; skill rowta-db-sharding-recipes).
//
// One pure function decides which of the two databases owns a team. It is the ONLY place that
// computes a shard, so the algorithm can be tested for determinism and for an even split without
// touching a database. blake2b512 is used for NON-SECRET hashing only (rule A2: Argon2id is for
// secrets; blake2b512 is the documented non-secret hasher).
import { createHash } from 'node:crypto';

export type Shard = 0 | 1;

/** Deterministic, uniform shard for a team. Same input always yields the same shard. */
export function shardFor(teamId: string): Shard {
  // First 4 bytes of the digest as a big-endian uint32, modulo the shard count. Reading a fixed
  // prefix (rather than a hex string) avoids any locale/parse surprises.
  const digest = createHash('blake2b512').update(teamId, 'utf8').digest();
  return (digest.readUInt32BE(0) % 2) as Shard;
}
