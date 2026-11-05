// @ts-check
// ESLint flat config for the Rowta server (Phase 0 part B).
// Typed linting is enabled (projectService) so the two floating-promise rules that Phase 0's gate
// requires (C8, rowta-gate-checks section 6) can see types. eslint.config.mjs itself is plain ESM.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    files: ['**/*.{js,mjs,ts}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        // projectService discovers files through tsconfig.json; eslint.config.mjs itself is not a
        // TS project file, so allow it as a one-off default project.
        projectService: { allowDefaultProject: ['eslint.config.mjs'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Generated Prisma clients are introspected output, never hand-written (ADR 0002).
    ignores: ['prisma/generated/**', 'dist/**', 'node_modules/**', '../node_modules/**'],
  },
);
