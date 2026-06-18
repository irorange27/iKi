import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: [
      { find: '@iki/core/', replacement: path.join(ROOT, 'packages/core/src/') },
      { find: '@iki/core', replacement: path.join(ROOT, 'packages/core/src/index.ts') },
      { find: '@iki/backend/', replacement: path.join(ROOT, 'packages/backend/src/') },
      { find: '@iki/backend', replacement: path.join(ROOT, 'packages/backend/src/index.ts') },
      { find: '@iki/theme/', replacement: path.join(ROOT, 'packages/theme/src/') },
      { find: '@iki/theme', replacement: path.join(ROOT, 'packages/theme/src/index.ts') },
      { find: '@iki/daemon/', replacement: path.join(ROOT, 'packages/daemon/src/') },
      { find: '@iki/daemon', replacement: path.join(ROOT, 'packages/daemon/src/index.ts') },
    ],
  },
  server: {
    host: '127.0.0.1',
  },
  preview: {
    host: '127.0.0.1',
  },
});
