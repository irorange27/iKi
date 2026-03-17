import path from 'node:path';

export const getRendererDevServerUrl = (): string =>
  process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL || 'http://localhost:5173';

export const getRendererProdHtmlPath = (): string =>
  // When bundled by electron-forge/plugin-vite, the main process runs from `.vite/build`.
  // The renderer build output is placed under `.vite/renderer/<name>/index.html`.
  path.join(__dirname, '../renderer/main_window/index.html');
