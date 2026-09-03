import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      { find: '@iki/daemon/', replacement: new URL('./packages/daemon/src/', import.meta.url).pathname },
      { find: '@iki/daemon', replacement: new URL('./packages/daemon/src/index.ts', import.meta.url).pathname },
      { find: '@iki/theme/', replacement: new URL('./packages/theme/src/', import.meta.url).pathname },
      { find: '@iki/theme', replacement: new URL('./packages/theme/src/index.ts', import.meta.url).pathname },
      { find: '@iki/backend/', replacement: new URL('./packages/backend/src/', import.meta.url).pathname },
      { find: '@iki/backend', replacement: new URL('./packages/backend/src/index.ts', import.meta.url).pathname },
    ],
  },
  test: {
    name: 'integration',
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 30000,
  },
});
