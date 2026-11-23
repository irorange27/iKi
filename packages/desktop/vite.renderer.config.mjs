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
      { find: '@iki/harness/', replacement: path.join(ROOT, 'packages/harness/src/') },
      { find: '@iki/core/', replacement: path.join(ROOT, 'packages/core/src/') },
      { find: '@iki/store/', replacement: path.join(ROOT, 'packages/store/src/') },
      { find: '@iki/session/', replacement: path.join(ROOT, 'packages/session/src/') },
      { find: '@iki/llm/', replacement: path.join(ROOT, 'packages/llm/src/') },
      { find: '@iki/llm-pi-ai/', replacement: path.join(ROOT, 'packages/llm-pi-ai/src/') },
      { find: '@iki/agent/', replacement: path.join(ROOT, 'packages/agent/src/') },
      { find: '@iki/agent', replacement: path.join(ROOT, 'packages/agent/src/index.ts') },
      { find: '@iki/agent-loop/', replacement: path.join(ROOT, 'packages/agent-loop/src/') },
      { find: '@iki/agent-loop', replacement: path.join(ROOT, 'packages/agent-loop/src/index.ts') },
      { find: '@iki/system-prompt/', replacement: path.join(ROOT, 'packages/system-prompt/src/') },
      { find: '@iki/system-prompt', replacement: path.join(ROOT, 'packages/system-prompt/src/index.ts') },
      { find: '@iki/theme/', replacement: path.join(ROOT, 'packages/theme/src/') },
      { find: '@iki/theme', replacement: path.join(ROOT, 'packages/theme/src/index.ts') },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.IKI_VITE_PORT || 5173),
    strictPort: Boolean(process.env.IKI_VITE_PORT),
  },
  preview: {
    host: '127.0.0.1',
  },
});
