import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: [
      { find: '@iki/backend/', replacement: path.join(ROOT, 'packages/backend/src/') },
      { find: '@iki/core/', replacement: path.join(ROOT, 'packages/core/src/') },
      { find: '@iki/store/', replacement: path.join(ROOT, 'packages/store/src/') },
      { find: '@iki/theme/', replacement: path.join(ROOT, 'packages/theme/src/') },
      { find: '@iki/theme', replacement: path.join(ROOT, 'packages/theme/src/index.ts') },
    ],
  },
});
