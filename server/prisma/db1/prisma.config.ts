// Prisma CLI config for DATABASE 1 (shard 1). See ../db0/prisma.config.ts for the same notes.
// The URL name is DB1_ADMIN_URL (owner/setup use only; the app uses DB1_WRITE_URL). Name only in the file (S1).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, env } from 'prisma/config';

const here = dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(resolve(here, '..', '..', '..', '.env'));
} catch {
  // No .env: env() below reports the missing name and the command stops.
}

export default defineConfig({
  schema: resolve(here, 'schema.prisma'),
  datasource: {
    url: env('DB1_ADMIN_URL'),
  },
});
