// eslint-disable-next-line import/no-unresolved
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.d.ts', 'src/core/db/migration/**'],
      thresholds: {
        lines: 24,
        functions: 23,
        branches: 21,
        statements: 24,
      },
    },
  },
});
