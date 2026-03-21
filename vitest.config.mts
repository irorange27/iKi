// eslint-disable-next-line import/no-unresolved
import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup/strict_error_logs.ts'],
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.vue'],
      exclude: ['src/**/*.d.ts', 'src/core/db/migration/**'],
      thresholds: {
        lines: 62,
        functions: 59,
        branches: 46,
        statements: 59,
      },
    },
  },
});
