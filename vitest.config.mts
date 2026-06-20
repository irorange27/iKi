// eslint-disable-next-line import/no-unresolved
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      { find: '@iki/daemon/', replacement: path.join(ROOT, 'packages/daemon/src/') },
      { find: '@iki/daemon', replacement: path.join(ROOT, 'packages/daemon/src/index.ts') },
      { find: '@iki/theme/', replacement: path.join(ROOT, 'packages/theme/src/') },
      { find: '@iki/theme', replacement: path.join(ROOT, 'packages/theme/src/index.ts') },
      { find: '@iki/backend/', replacement: path.join(ROOT, 'packages/backend/src/') },
      { find: '@iki/backend', replacement: path.join(ROOT, 'packages/backend/src/index.ts') },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup/wire_core_context.ts', 'tests/setup/strict_error_logs.ts'],
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx', 'packages/*/src/**/*.vue'],
      exclude: ['packages/*/src/db/migration/**'],
      thresholds: {
        lines: 60,
        functions: 59,
        branches: 46,
        statements: 59,
      },
    },
  },
});
