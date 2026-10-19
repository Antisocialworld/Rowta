// @ts-check
// ESLint flat config for the Rowta mobile app (Phase 1 step 1).
// Same shape as the server config: typed linting (projectService) so the floating-promise rules the
// gate requires (C8, rowta-gate-checks section 6) can see types. TypeScript files only; this file is
// plain ESM.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'eslint.config.mjs',
            'scripts/capture-ui-matrix.mjs',
            'scripts/capture-web-matrix.mjs',
          ],
        },
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
    // Node scripts under app/scripts run in plain Node, not in React Native: declare the globals they use.
    // `document` and the timers also appear inside page.evaluate callbacks — those strings run in the browser,
    // never in Node (capture-web-matrix.mjs).
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', fetch: 'readonly', document: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' } },
  },
  {
    ignores: ['node_modules/**', 'android/**', 'ios/**', '.expo/**'],
  },
);
