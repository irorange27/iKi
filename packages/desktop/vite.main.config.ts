import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VITE_EXTERNAL_RUNTIME_DEPS } from './src/build/runtime_packaging';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: [
      { find: '@iki/backend/', replacement: path.join(ROOT, 'packages/backend/src/') },
      { find: '@iki/backend', replacement: path.join(ROOT, 'packages/backend/src/index.ts') },
      { find: '@iki/theme/', replacement: path.join(ROOT, 'packages/theme/src/') },
      { find: '@iki/theme', replacement: path.join(ROOT, 'packages/theme/src/index.ts') },
      { find: '@iki/daemon/', replacement: path.join(ROOT, 'packages/daemon/src/') },
      { find: '@iki/daemon', replacement: path.join(ROOT, 'packages/daemon/src/index.ts') },
    ],
  },
  optimizeDeps: {
    exclude: [...VITE_EXTERNAL_RUNTIME_DEPS],
  },
  ssr: {
    external: [...VITE_EXTERNAL_RUNTIME_DEPS],
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      external: [...VITE_EXTERNAL_RUNTIME_DEPS],
    },
  },
});
