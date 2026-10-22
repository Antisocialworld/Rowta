import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The suite must boot even when .env holds empty SMTP placeholders (the real provider values
    // are the owner's, pasted by hand; owner decision 22 Oct 2026). These values never open a
    // connection: mail/transport.ts refuses to build the real transporter under vitest, and the
    // auth helpers install the in-process capture before any send.
    env: {
      SMTP_HOST: 'smtp.test.invalid',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      MAIL_FROM: 'Rowta Tests <no-reply@example.test>',
    },
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
