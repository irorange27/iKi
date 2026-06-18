import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Avoid importing Electron-backed sqlite config in unit tests.
vi.mock('@iki/backend/db/database', () => ({
  getConfig: vi.fn(() => null),
}));

import { FetchTool } from '@iki/backend/tools/web_tools';

describe('FetchTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects non-http(s) URLs', async () => {
    const tool = new FetchTool();
    await expect(tool.execute({ url: 'ftp://example.com/file.txt' })).rejects.toThrow(
      /only http\/https urls are supported/i
    );
  });

  it('extracts html text, title, and truncates long content', async () => {
    const html = `
      <html>
        <head>
          <title>  Hello &amp; World </title>
          <style>.x { color: red; }</style>
        </head>
        <body>
          <script>console.log('ignore me')</script>
          <h1>Main</h1>
          <p>
            Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi.
            Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi.
            Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi.
            Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi.
            Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi.
            Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi.
            Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi.
            Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi.
            Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi.
            Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi.
          </p>
        </body>
      </html>
    `;

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      })
    );

    const tool = new FetchTool();
    const output = (await tool.execute({
      url: 'https://example.com/page',
      maxChars: 500,
    })) as {
      title: string;
      content: string;
      truncated: boolean;
      ok: boolean;
      status: number;
    };

    expect(output.ok).toBe(true);
    expect(output.status).toBe(200);
    expect(output.title).toBe('Hello & World');
    expect(output.content).toContain('Main');
    expect(output.content).not.toContain('ignore me');
    expect(output.truncated).toBe(true);
  });

  it('returns an error payload for non-text content types', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response('PNGDATA', {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      })
    );

    const tool = new FetchTool();
    const output = (await tool.execute({
      url: 'https://example.com/image.png',
    })) as {
      ok: boolean;
      contentType: string;
      error?: string;
    };

    expect(output.ok).toBe(true);
    expect(output.contentType).toBe('image/png');
    expect(output.error).toMatch(/unsupported content type/i);
  });
});
