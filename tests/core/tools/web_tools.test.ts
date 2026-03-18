import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Avoid importing Electron-backed sqlite config in unit tests.
vi.mock('../../../src/core/db/database', () => ({
  getConfig: vi.fn(() => null),
}));

import { WebSearchTool } from '../../../src/core/tools/web_tools';

const asResults = (value: unknown): Array<{ title: string; url: string }> => {
  const record = value as { results?: unknown };
  return Array.isArray(record?.results) ? (record.results as Array<{ title: string; url: string }>) : [];
};

describe('WebSearchTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses DuckDuckGo HTML results even when attribute order varies', async () => {
    const html = `
      <html><body>
        <a href="https://example.com" class="result__a">Example One</a>
        <a class='result__a' href="https://example.org"><span>Example</span> Two</a>
      </body></html>
    `;

    const fetchMock = vi.fn(async () => {
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const tool = new WebSearchTool();
    const output = await tool.execute({ query: 'hello world', limit: 5 });
    const results = asResults(output);

    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0]).toEqual({ title: 'Example One', url: 'https://example.com' });
    expect(results[1]).toEqual({ title: 'Example Two', url: 'https://example.org' });
  });

  it('unwraps DuckDuckGo redirect wrappers and de-duplicates results', async () => {
    const html = `
      <html><body>
        <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fpath%3Fa%3D1%26b%3D2">Example A</a>
        <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.net%2F">Example B</a>
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.edu%2F">Example C</a>
        <a class="result__a" href="https://example.net/">Duplicate B</a>
      </body></html>
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

    const tool = new WebSearchTool();
    const output = await tool.execute({ query: 'x', limit: 10 });
    const results = asResults(output);

    expect(results).toEqual([
      { title: 'Example A', url: 'https://example.com/path?a=1&b=2' },
      { title: 'Example B', url: 'https://example.net/' },
      { title: 'Example C', url: 'https://example.edu/' },
    ]);
  });

  it('falls back to Bing RSS when DuckDuckGo request times out', async () => {
    const rss = `
      <rss version="2.0">
        <channel>
          <item>
            <title><![CDATA[News One]]></title>
            <link>https://news.example.com/1</link>
          </item>
          <item>
            <title>News &amp; Two</title>
            <link>https://news.example.com/2</link>
          </item>
        </channel>
      </rss>
    `;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('duckduckgo.com')) {
          // Simulate an abort (typical when we hit a network timeout).
          throw new DOMException('This operation was aborted', 'AbortError');
        }
        if (url.includes('bing.com')) {
          return new Response(rss, {
            status: 200,
            headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      })
    );

    const tool = new WebSearchTool();
    const output = (await tool.execute({ query: 'today news', limit: 5 })) as {
      source: string;
      sourcesTried?: string[];
      warnings?: string[];
      results: Array<{ title: string; url: string }>;
    };

    expect(output.source).toBe('bing');
    expect(output.sourcesTried).toEqual(['duckduckgo', 'bing']);
    expect(output.warnings?.[0] || '').toMatch(/duckduckgo/i);
    expect(output.results).toEqual([
      { title: 'News One', url: 'https://news.example.com/1' },
      { title: 'News & Two', url: 'https://news.example.com/2' },
    ]);
  });
});
