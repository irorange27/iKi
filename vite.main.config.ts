import { defineConfig } from 'vite';

const externalDeps = [
  'better-sqlite3',
  'whisper-node',
  'ffmpeg-static',
  'shelljs',
  'readline-sync',
];

// https://vitejs.dev/config
export default defineConfig({
  optimizeDeps: {
    exclude: externalDeps,
  },
  ssr: {
    external: externalDeps,
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      external: externalDeps,
    },
  },
});
