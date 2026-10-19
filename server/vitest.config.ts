import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Integration tests share the local Docker Redis and PostgreSQL; keep them sequential so a
    // lock test cannot race another file's Redis usage.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    globals: false,
  },
});
