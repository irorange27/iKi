import { defineConfig } from 'vite';
import { VITE_EXTERNAL_RUNTIME_DEPS } from './src/build/runtime_packaging';

// https://vitejs.dev/config
export default defineConfig({
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
