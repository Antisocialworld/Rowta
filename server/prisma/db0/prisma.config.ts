// Prisma CLI config for DATABASE 0 (the global database AND shard 0).
// Prisma is the QUERY CLIENT ONLY: the schema of record is server/prisma/sql/*.sql (PRD 7 and 9.1).
// Never run `prisma migrate`, `prisma migrate dev`, `prisma migrate reset` or `prisma db push` (rule D8, skill
// rowta-db-sharding-recipes section 2). Allowed: `db pull` (introspect) and `generate`.
//
// Paths in this file resolve relative to THIS file, not to the working directory
// (https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference - "Path resolution").
// The URL name is DB0_ADMIN_URL (owner/setup use only; the app uses DB0_WRITE_URL). Name only in the file (S1).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, env } from 'prisma/config';

const here = dirname(fileURLToPath(import.meta.url));
// Prisma 7 does not load .env itself; this loads the repo root .env into THIS process only (S2: programs may load
// .env, the agent never reads or prints it). Nothing is printed here.
try {
  process.loadEnvFile(resolve(here, '..', '..', '..', '.env'));
} catch {
  // No .env: env() below reports the missing name and the command stops.
}

export default defineConfig({
  schema: resolve(here, 'schema.prisma'),
  datasource: {
    url: env('DB0_ADMIN_URL'),
  },
});
