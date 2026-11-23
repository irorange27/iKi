import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// https://vitejs.dev/config
export default defineConfig({
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
      { find: '@iki/theme/', replacement: path.join(ROOT, 'packages/theme/src/') },
      { find: '@iki/theme', replacement: path.join(ROOT, 'packages/theme/src/index.ts') },
    ],
  },
});
