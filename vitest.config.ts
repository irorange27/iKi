import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
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
      { find: '@iki/tools/shell', replacement: path.join(ROOT, 'packages/tools/src/shell/index.ts') },
      { find: '@iki/tools/', replacement: path.join(ROOT, 'packages/tools/src/') },
      { find: '@iki/tools', replacement: path.join(ROOT, 'packages/tools/src/index.ts') },
      { find: '@iki/harness/', replacement: path.join(ROOT, 'packages/harness/src/') },
      { find: '@iki/theme/', replacement: path.join(ROOT, 'packages/theme/src/') },
      { find: '@iki/theme', replacement: path.join(ROOT, 'packages/theme/src/index.ts') },
    ],
  },
});
