import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getAppConfigMock } = vi.hoisted(() => ({
  getAppConfigMock: vi.fn(),
}));

// Avoid importing Electron-backed sqlite config in unit tests.
vi.mock('@iki/backend/db/database', () => ({
  getConfig: vi.fn(() => null),
}));

vi.mock('@iki/backend/config', () => ({
  getAppConfig: getAppConfigMock,
}));

import { createDefaultAppConfig } from '@iki/backend/config/defaults';
import { FetchTool, WebSearchTool } from '@iki/backend/tools/web_tools';

const asResults = (value: unknown): Array<{ title: string; url: string }> => {
  const record = value as { results?: unknown };
  return Array.isArray(record?.results) ? (record.results as Array<{ title: string; url: string }>) : [];
};

describe('WebSearchTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAppConfigMock.mockReturnValue(createDefaultAppConfig());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses Google organic result wrappers and de-duplicates results', async () => {
    const html = `
      <html><body>
        <div id="search">
          <a href="/url?q=https%3A%2F%2Fexample.com%2Farticle%3Fa%3D1%26b%3D2&sa=U&ved=2ah">
            <div><h3>Example One</h3></div>
          </a>
          <a href="https://example.org/report">
            <div><h3><span>Example</span> Two</h3></div>
          </a>
          <a href="https://www.google.com/preferences">
            <div><h3>Ignored Google Link</h3></div>
          </a>
          <a href="/url?q=https%3A%2F%2Fexample.org%2Freport&sa=U&ved=2ah">
            <div><h3>Duplicate Example Two</h3></div>
          </a>
        </div>
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
    expect(results[0]).toEqual({ title: 'Example One', url: 'https://example.com/article?a=1&b=2' });
    expect(results[1]).toEqual({ title: 'Example Two', url: 'https://example.org/report' });
  });

  it('falls back to DuckDuckGo when Google returns a consent wall', async () => {
    const googleConsent = `
      <html>
        <head><title>Before you continue to Google</title></head>
        <body>Before you continue to Google</body>
      </html>
    `;

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
      vi.fn(async (url: string) => {
        if (url.includes('google.com/search')) {
          return new Response(googleConsent, {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          });
        }
        return new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      })
    );

    const tool = new WebSearchTool();
    const output = await tool.execute({ query: 'x', limit: 10 });
    const results = asResults(output);

    expect((output as { source?: string }).source).toBe('duckduckgo');
    expect(results).toEqual([
      { title: 'Example A', url: 'https://example.com/path?a=1&b=2' },
      { title: 'Example B', url: 'https://example.net/' },
      { title: 'Example C', url: 'https://example.edu/' },
    ]);
  });

  it('falls back to Bing RSS when Google and DuckDuckGo fail', async () => {
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
        if (url.includes('google.com/search')) {
          throw new DOMException('This operation was aborted', 'AbortError');
        }
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
    expect(output.sourcesTried).toEqual(['google', 'duckduckgo', 'bing']);
    expect(output.warnings?.[0] || '').toMatch(/google/i);
    expect(output.warnings?.[1] || '').toMatch(/duckduckgo/i);
    expect(output.results).toEqual([
      { title: 'News One', url: 'https://news.example.com/1' },
      { title: 'News & Two', url: 'https://news.example.com/2' },
    ]);
  });

  it('uses English locale parameters for Latin-script web queries', async () => {
    const html = `
      <html><body><div id="search">
        <a href="https://example.com/news"><div><h3>Example News</h3></div></a>
      </div></body></html>
    `;
    const fetchMock = vi.fn(async () => {
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const tool = new WebSearchTool();
    await tool.execute({ query: 'BBC African author road accident died', limit: 5 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('google.com/search');
    expect(url).toContain('hl=en');
    expect(url).toContain('gl=US');
    expect(init.headers).toMatchObject({
      'accept-language': 'en-US,en;q=0.9',
    });
  });

  it('uses Chinese locale parameters for CJK web queries', async () => {
    const html = `
      <html><body><div id="search">
        <a href="https://example.cn/news"><div><h3>示例新闻</h3></div></a>
      </div></body></html>
    `;
    const fetchMock = vi.fn(async () => {
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const tool = new WebSearchTool();
    await tool.execute({ query: '今天 新闻', limit: 5 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('google.com/search');
    expect(url).toContain('hl=zh-CN');
    expect(url).toContain('gl=CN');
    expect(init.headers).toMatchObject({
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6',
    });
  });

  it('starts from the configured preferred search engine', async () => {
    const config = createDefaultAppConfig();
    config.network.webSearch.preferredEngine = 'bing';
    getAppConfigMock.mockReturnValue(config);

    const rss = `
      <rss version="2.0">
        <channel>
          <item>
            <title>Bing First</title>
            <link>https://news.example.com/bing-first</link>
          </item>
        </channel>
      </rss>
    `;
    const fetchMock = vi.fn(async (url: string) => {
      if (!url.includes('bing.com')) {
        throw new Error(`Unexpected URL: ${url}`);
      }
      return new Response(rss, {
        status: 200,
        headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const tool = new WebSearchTool();
    const output = await tool.execute({ query: 'market headlines', limit: 5 });

    expect((output as { source?: string }).source).toBe('bing');
    expect((output as { sourcesTried?: string[] }).sourcesTried).toEqual(['bing']);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('bing.com/search');
  });

  it('can search and then fetch page content for a London spot-gold query', async () => {
    const googleHtml = `
      <html>
        <body>
          <div id="search">
            <a href="/url?q=https%3A%2F%2Fwww.lbma.org.uk%2Fprices-and-data%2Fprecious-metal-prices&sa=U">
              <div><h3>LBMA Precious Metal Prices</h3></div>
            </a>
          </div>
        </body>
      </html>
    `;
    const quoteHtml = `
      <html>
        <head><title>LBMA Precious Metal Prices</title></head>
        <body>
          <main>
            <h1>Precious Metal Prices</h1>
            <section>
              <h2>Spot gold</h2>
              <p>USD 3267.40 per troy ounce</p>
              <p>Updated 2026-04-07T10:15:00Z</p>
            </section>
          </main>
        </body>
      </html>
    `;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('google.com/search')) {
          return new Response(googleHtml, {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          });
        }
        if (url === 'https://www.lbma.org.uk/prices-and-data/precious-metal-prices') {
          return new Response(quoteHtml, {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      })
    );

    const webTool = new WebSearchTool();
    const fetchTool = new FetchTool();

    const searchOutput = await webTool.execute({ query: '这一时刻伦敦金现货是多少？', limit: 3 });
    const [firstResult] = asResults(searchOutput);
    expect(firstResult).toEqual({
      title: 'LBMA Precious Metal Prices',
      url: 'https://www.lbma.org.uk/prices-and-data/precious-metal-prices',
    });

    const fetchOutput = (await fetchTool.execute({
      url: firstResult.url,
      maxChars: 2000,
    })) as {
      title: string;
      content: string;
      ok: boolean;
    };

    expect(fetchOutput.ok).toBe(true);
    expect(fetchOutput.title).toBe('LBMA Precious Metal Prices');
    expect(fetchOutput.content).toContain('Spot gold');
    expect(fetchOutput.content).toContain('USD 3267.40');
  });
});
