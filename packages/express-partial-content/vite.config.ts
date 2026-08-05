/// <reference types='vitest' />
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/express-partial-content',
  plugins: [],
  test: {
    watch: false,
    globals: true,
    environment: 'happy-dom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: [
      'default',
      ['junit', { outputFile: './test-output/vitest/junit.xml', addFileAttribute: true }]
    ],
    coverage: {
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100
      },
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['**/*.{test,spec}.{ts,mts,cts,tsx,js,jsx}', '**/*.d.ts'],
      // Codecov resolves an lcov `SF:` path by matching it against the repo's file list, so the
      // package-relative paths istanbul emits by default (`src/utils.ts`, relative to cwd) are
      // ambiguous in this monorepo and get attributed to whichever package wins the match. Emit
      // repo-root-relative paths instead.
      reporter: ['text', ['lcov', { projectRoot: resolve(__dirname, '../..') }]],
    }
  },
}));
