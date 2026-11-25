import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const siteRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: siteRoot,
  base: './',
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@site': path.join(siteRoot, 'src'),
    },
  },
  build: {
    outDir: path.join(siteRoot, 'dist'),
    emptyOutDir: true,
  },
});
