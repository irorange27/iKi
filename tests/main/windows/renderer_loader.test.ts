import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getRendererProdHtmlPath, loadRendererEntry } from '../../../src/main/windows/renderer';

describe('loadRendererEntry', () => {
  const loadURL = vi.fn((url: string) => Promise.resolve(void url));
  const loadFile = vi.fn((filePath: string, options?: { hash?: string }) =>
    Promise.resolve(void [filePath, options])
  );

  beforeEach(() => {
    vi.clearAllMocks();
    loadURL.mockResolvedValue();
    loadFile.mockResolvedValue();
    process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL = 'http://localhost:5173';
  });

  it('loads the dev server URL when the renderer becomes reachable', async () => {
    await loadRendererEntry(
      { loadURL, loadFile },
      { isPackaged: false, hash: 'settings' },
      {
        waitForDevServer: vi.fn().mockResolvedValue(true),
        prodHtmlExists: vi.fn().mockReturnValue(false),
      }
    );

    expect(loadURL).toHaveBeenCalledWith('http://localhost:5173/#settings');
    expect(loadFile).not.toHaveBeenCalled();
  });

  it('falls back to the built renderer HTML when the dev server is unavailable', async () => {
    await loadRendererEntry(
      { loadURL, loadFile },
      { isPackaged: false, hash: 'settings' },
      {
        waitForDevServer: vi.fn().mockResolvedValue(false),
        prodHtmlExists: vi.fn().mockReturnValue(true),
      }
    );

    expect(loadFile).toHaveBeenCalledWith(getRendererProdHtmlPath(), { hash: 'settings' });
    expect(loadURL).not.toHaveBeenCalled();
  });

  it('loads an explanatory fallback page when neither the dev server nor built HTML is available', async () => {
    await loadRendererEntry(
      { loadURL, loadFile },
      { isPackaged: false, hash: 'settings' },
      {
        waitForDevServer: vi.fn().mockResolvedValue(false),
        prodHtmlExists: vi.fn().mockReturnValue(false),
      }
    );

    expect(loadFile).not.toHaveBeenCalled();
    expect(loadURL).toHaveBeenCalledTimes(1);
    expect(loadURL.mock.calls[0]?.[0]).toContain('data:text/html');
    expect(loadURL.mock.calls[0]?.[0]).toContain(encodeURIComponent('Renderer not available'));
    expect(loadURL.mock.calls[0]?.[0]).toContain(encodeURIComponent('npm run app:dev'));
    expect(loadURL.mock.calls[0]?.[0]).toContain(encodeURIComponent('npm run app:preview'));
  });

  it('loads the packaged renderer HTML directly in production mode', async () => {
    await loadRendererEntry(
      { loadURL, loadFile },
      { isPackaged: true },
      {
        waitForDevServer: vi.fn().mockResolvedValue(true),
        prodHtmlExists: vi.fn().mockReturnValue(true),
      }
    );

    expect(loadFile).toHaveBeenCalledWith(getRendererProdHtmlPath(), undefined);
    expect(loadURL).not.toHaveBeenCalled();
  });
});
