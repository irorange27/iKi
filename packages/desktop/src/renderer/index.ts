/**
 * This file will automatically be loaded by vite and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/process-model
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.ts` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */

import './assets/styles/globals.css';
import './assets/styles/index.css';

// If you are encountering issues with type declarations for CSS imports,
// you can create a `declaration.d.ts` file in your project with the following content:
// declare module '*.css';
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';

let rendererBootstrapFailed = false;
let rendererMounted = false;

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const renderRendererCrash = (title: string, detail: string) => {
  if (rendererBootstrapFailed) return;
  const appRoot = document.getElementById('app');
  if (!appRoot) return;
  rendererBootstrapFailed = true;

  appRoot.innerHTML = `
    <main style="height:100%;display:grid;place-items:center;padding:32px;box-sizing:border-box;background:var(--bg-primary);color:var(--text-primary);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <section style="width:min(880px,100%);border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:24px 28px;background:rgba(0,0,0,.18);box-shadow:0 18px 60px rgba(0,0,0,.25);">
        <h1 style="margin:0 0 10px;font-size:22px;">${escapeHtml(title)}</h1>
        <p style="margin:0 0 14px;line-height:1.6;opacity:.88;">Renderer failed during startup. Check the terminal log for the full stack.</p>
        <pre style="margin:0;white-space:pre-wrap;word-break:break-word;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;opacity:.92;">${escapeHtml(detail)}</pre>
      </section>
    </main>
  `;
};

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.stack || `${error.name}: ${error.message}`;
  }

  if (typeof error === 'string') return error;

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
};

window.addEventListener('error', event => {
  const detail = formatUnknownError(event.error ?? event.message);
  console.error('[renderer] unhandled error', event.error ?? event.message);
  if (!rendererMounted) {
    renderRendererCrash('Renderer startup error', detail);
  }
});

window.addEventListener('unhandledrejection', event => {
  const detail = formatUnknownError(event.reason);
  console.error('[renderer] unhandled rejection', event.reason);
  if (!rendererMounted) {
    renderRendererCrash('Renderer startup rejection', detail);
  }
});

window.addEventListener('DOMContentLoaded', () => {
  try {
    const app = createApp(App);
    app.use(createPinia());
    app.mount('#app');
    rendererMounted = true;
  } catch (error) {
    const detail = formatUnknownError(error);
    console.error('[renderer] mount failed', error);
    renderRendererCrash('Renderer mount failed', detail);
  }
});
