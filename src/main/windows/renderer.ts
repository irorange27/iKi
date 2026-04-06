import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_RENDERER_DEV_SERVER_URL = 'http://127.0.0.1:5173';

const normalizeLoopbackRendererUrl = (value: string): string => {
  try {
    const url = new URL(value);
    if (url.hostname === 'localhost' || url.hostname === '::1' || url.hostname === '[::1]') {
      url.hostname = '127.0.0.1';
    }
    return url.toString();
  } catch {
    return value;
  }
};

export const getRendererDevServerUrl = (): string =>
  normalizeLoopbackRendererUrl(
    process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL || DEFAULT_RENDERER_DEV_SERVER_URL
  );

export const getRendererProdHtmlPath = (): string =>
  // When bundled by electron-forge/plugin-vite, the main process runs from `.vite/build`.
  // The renderer build output is placed under `.vite/renderer/<name>/index.html`.
  path.join(__dirname, '../renderer/main_window/index.html');

const DEV_SERVER_WAIT_TIMEOUT_MS = 5000;
const DEV_SERVER_RETRY_INTERVAL_MS = 250;
const DEV_SERVER_REQUEST_TIMEOUT_MS = 500;

type RendererLoadTarget = {
  loadURL: (url: string) => Promise<unknown>;
  loadFile: (filePath: string, options?: { hash?: string }) => Promise<unknown>;
};

type LoadRendererEntryOptions = {
  isPackaged: boolean;
  hash?: string;
};

type LoadRendererEntryDeps = {
  waitForDevServer?: (url: string) => Promise<boolean>;
  prodHtmlExists?: (filePath: string) => boolean;
};

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const withRouteHash = (baseUrl: string, hash?: string): string => {
  if (!hash) return baseUrl;
  const url = new URL(baseUrl);
  url.hash = hash;
  return url.toString();
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const canReachRendererDevServer = async (url: string): Promise<boolean> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEV_SERVER_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml',
      },
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
};

export const waitForRendererDevServer = async (url: string): Promise<boolean> => {
  const deadline = Date.now() + DEV_SERVER_WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await canReachRendererDevServer(url)) {
      return true;
    }
    await delay(DEV_SERVER_RETRY_INTERVAL_MS);
  }

  return false;
};

const buildRendererUnavailablePage = (params: {
  devServerUrl: string;
  prodHtmlPath: string;
  hash?: string;
}): string => {
  const routeSuffix = params.hash ? `#${params.hash}` : '';
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Renderer Unavailable</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #111318;
        color: #f4f6fb;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top, rgba(92, 129, 255, 0.18), transparent 45%),
          linear-gradient(180deg, #151922 0%, #0f1117 100%);
      }
      main {
        width: min(720px, calc(100vw - 48px));
        padding: 28px 32px;
        border-radius: 18px;
        background: rgba(17, 19, 24, 0.88);
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.35);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 24px;
      }
      p, li {
        line-height: 1.6;
        color: rgba(244, 246, 251, 0.86);
      }
      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        background: rgba(255, 255, 255, 0.06);
        border-radius: 8px;
        padding: 2px 6px;
      }
      ul {
        margin: 16px 0 0;
        padding-left: 20px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Renderer not available</h1>
      <p>Electron started before the renderer was reachable.</p>
      <ul>
        <li>Expected dev server: <code>${escapeHtml(params.devServerUrl)}${escapeHtml(routeSuffix)}</code></li>
        <li>Expected built file: <code>${escapeHtml(params.prodHtmlPath)}</code></li>
        <li>For development, start with <code>npm run app:dev</code> (or <code>npm run start</code>).</li>
        <li>For a packaged local preview, run <code>npm run app:preview</code>.</li>
      </ul>
    </main>
  </body>
</html>`;

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
};

export const loadRendererEntry = async (
  target: RendererLoadTarget,
  options: LoadRendererEntryOptions,
  deps: LoadRendererEntryDeps = {}
): Promise<void> => {
  const hash = options.hash;
  const prodHtmlPath = getRendererProdHtmlPath();

  if (options.isPackaged) {
    await target.loadFile(prodHtmlPath, hash ? { hash } : undefined);
    return;
  }

  const devServerUrl = getRendererDevServerUrl();
  const waitForDevServer = deps.waitForDevServer ?? waitForRendererDevServer;
  const prodHtmlExists = deps.prodHtmlExists ?? fs.existsSync;

  if (await waitForDevServer(devServerUrl)) {
    await target.loadURL(withRouteHash(devServerUrl, hash));
    return;
  }

  if (prodHtmlExists(prodHtmlPath)) {
    await target.loadFile(prodHtmlPath, hash ? { hash } : undefined);
    return;
  }

  await target.loadURL(
    buildRendererUnavailablePage({
      devServerUrl,
      prodHtmlPath,
      ...(hash ? { hash } : {}),
    })
  );
};
