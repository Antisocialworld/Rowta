// Non-secret fingerprints (rule A4: blake2b512 for non-secret hashes — rate-limit keys,
// shard routing, job IDs, hashed identifiers).
import { createHash } from 'node:crypto';

export function fingerprint(value: string): string {
  return createHash('blake2b512').update(value, 'utf8').digest('hex');
}
