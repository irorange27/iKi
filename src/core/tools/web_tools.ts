import { z } from 'zod';
import { BaseTool } from './base';
import { getConfig } from '../db/database';
import type { AppConfig } from '../../shared/types/config';
import {
  DEFAULT_FETCH_MAX_CHARS,
  DEFAULT_SEARCH_RESULT_LIMIT,
  FetchToolInputSchema,
  MAX_FETCH_MAX_CHARS,
  MAX_SEARCH_RESULT_LIMIT,
  MIN_FETCH_MAX_CHARS,
  WebToolInputSchema,
} from './schemas';

const DEFAULT_NETWORK_TIMEOUT_MS = 5000;
const MIN_NETWORK_TIMEOUT_MS = 1000;
const MAX_NETWORK_TIMEOUT_MS = 60000;
const DEFAULT_NETWORK_RETRY_ATTEMPTS = 0;
const MIN_NETWORK_RETRY_ATTEMPTS = 0;
const MAX_NETWORK_RETRY_ATTEMPTS = 10;
// Give search a bit more time than the global default, but keep it interactive.
const MIN_WEB_SEARCH_TIMEOUT_MS = 12000;

const getNetworkTimeoutMs = (): number => {
  const rawConfig = getConfig('app_config') as Partial<AppConfig> | null;
  const timeout = rawConfig?.network?.timeout;

  if (typeof timeout !== 'number' || !Number.isFinite(timeout)) {
    return DEFAULT_NETWORK_TIMEOUT_MS;
  }

  return Math.min(
    MAX_NETWORK_TIMEOUT_MS,
    Math.max(MIN_NETWORK_TIMEOUT_MS, Math.trunc(timeout))
  );
};

const getNetworkRetryAttempts = (): number => {
  const rawConfig = getConfig('app_config') as Partial<AppConfig> | null;
  const retries = rawConfig?.network?.retryAttempts;

  if (typeof retries !== 'number' || !Number.isFinite(retries)) {
    return DEFAULT_NETWORK_RETRY_ATTEMPTS;
  }

  return Math.min(
    MAX_NETWORK_RETRY_ATTEMPTS,
    Math.max(MIN_NETWORK_RETRY_ATTEMPTS, Math.trunc(retries))
  );
};

const getWebSearchTimeoutMs = (): number => Math.max(getNetworkTimeoutMs(), MIN_WEB_SEARCH_TIMEOUT_MS);

const sleep = async (ms: number): Promise<void> => {
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise<void>(resolve => setTimeout(resolve, ms));
};

const isAbortError = (err: unknown): boolean =>
  err instanceof Error ? err.name === 'AbortError' : false;

const isRetryableStatus = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);

const normalizeTimeoutError = (timeout: number) =>
  new Error(`Network request timed out after ${timeout} ms`);

const fetchWithTimeout = async (
  url: string,
  init?: RequestInit,
  options?: { timeoutMs?: number; retries?: number }
): Promise<Response> => {
  const timeout = typeof options?.timeoutMs === 'number' ? Math.trunc(options.timeoutMs) : getNetworkTimeoutMs();
  const retries =
    typeof options?.retries === 'number' ? Math.trunc(options.retries) : getNetworkRetryAttempts();

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (response.ok) return response;

      if (attempt >= retries || !isRetryableStatus(response.status)) {
        return response;
      }

      // Drain body to avoid leaking resources before retrying.
      try {
        await response.arrayBuffer();
      } catch {
        // ignore
      }
    } catch (err) {
      lastError = err;
      if (isAbortError(err)) {
        lastError = normalizeTimeoutError(timeout);
      }

      if (attempt >= retries) {
        throw lastError;
      }
    } finally {
      clearTimeout(timer);
    }

    // Basic backoff: 250ms, 500ms, 1000ms, 2000ms...
    await sleep(Math.min(2000, 250 * Math.pow(2, attempt)));
  }

  throw lastError ?? new Error('Network request failed');
};

const entityMap: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const decodeHtmlEntities = (value: string): string =>
  value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, rawEntity: string) => {
    const entity = rawEntity.toLowerCase();
    if (entity in entityMap) return entityMap[entity];

    if (entity.startsWith('#x')) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    if (entity.startsWith('#')) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return match;
  });

const htmlToPlainText = (html: string): string => {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');

  const text = withoutNoise
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  return decodeHtmlEntities(text)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
};

const truncateText = (content: string, maxChars: number): { text: string; truncated: boolean } => {
  if (content.length <= maxChars) {
    return { text: content, truncated: false };
  }
  return { text: `${content.slice(0, maxChars)}…`, truncated: true };
};

const ensureHttpUrl = (value: string): URL => {
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http/https URLs are supported');
  }
  return parsed;
};

const extractTitle = (html: string): string => {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch || !titleMatch[1]) return '';
  return decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, ' ').trim();
};

const normalizeSearchHref = (href: string): string | null => {
  const trimmed = href.trim();
  if (!trimmed) return null;

  const tryDecodeUddg = (raw: string): string => {
    // DuckDuckGo occasionally double-encodes the `uddg` value; decode at most twice.
    let decoded = raw;
    for (let i = 0; i < 2; i += 1) {
      try {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      } catch {
        break;
      }
    }
    return decoded;
  };

  const unwrapDuckDuckGoRedirect = (urlValue: string): string | null => {
    try {
      const parsed = new URL(urlValue);
      const host = parsed.hostname.toLowerCase();
      if (!host.endsWith('duckduckgo.com')) return null;
      if (!parsed.pathname.startsWith('/l/')) return null;

      const uddg = parsed.searchParams.get('uddg');
      if (!uddg) return null;
      let target = tryDecodeUddg(uddg).trim();
      if (!target) return null;

      if (target.startsWith('//')) target = `https:${target}`;
      if (!target.startsWith('http://') && !target.startsWith('https://')) return null;

      try {
        const normalized = new URL(target);
        if (normalized.protocol !== 'http:' && normalized.protocol !== 'https:') return null;
        return normalized.toString();
      } catch {
        return target;
      }
    } catch {
      return null;
    }
  };

  const candidate = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;

  if (candidate.startsWith('/l/')) {
    const wrapper = `https://duckduckgo.com${candidate}`;
    return unwrapDuckDuckGoRedirect(wrapper) ?? wrapper;
  }

  if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
    return unwrapDuckDuckGoRedirect(candidate) ?? candidate;
  }

  return null;
};

const parseDuckDuckGoResults = (
  html: string,
  limit: number
): Array<{ title: string; url: string }> => {
  const results: Array<{ title: string; url: string }> = [];
  const seen = new Set<string>();

  const extractAttribute = (attrs: string, name: string): string | null => {
    // Support double-quoted, single-quoted, and unquoted attribute values.
    const regex = new RegExp(
      `${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
      'i'
    );
    const match = attrs.match(regex);
    const value = (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
    return value ? value : null;
  };

  const stripTags = (value: string): string => value.replace(/<[^>]*>/g, ' ');

  // DuckDuckGo's HTML is not stable about attribute ordering. Parse anchors and
  // extract `class`/`href` explicitly instead of relying on a single regex.
  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null = anchorRegex.exec(html);
  while (match && results.length < limit) {
    const attrs = match[1] || '';
    if (!/result__a/i.test(attrs)) {
      match = anchorRegex.exec(html);
      continue;
    }

    const classAttr = extractAttribute(attrs, 'class');
    const classTokens = (classAttr || '').split(/\s+/).filter(Boolean);
    if (!classTokens.includes('result__a')) {
      match = anchorRegex.exec(html);
      continue;
    }

    const hrefAttr = extractAttribute(attrs, 'href');
    const normalizedUrl = hrefAttr ? normalizeSearchHref(decodeHtmlEntities(hrefAttr)) : null;
    const rawTitle = match[2] || '';
    const title = decodeHtmlEntities(stripTags(rawTitle)).replace(/\s+/g, ' ').trim();

    if (normalizedUrl && title && !seen.has(normalizedUrl)) {
      seen.add(normalizedUrl);
      results.push({ title, url: normalizedUrl });
    }
    match = anchorRegex.exec(html);
  }

  return results;
};

const stripCdata = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.startsWith('<![CDATA[') && trimmed.endsWith(']]>')) {
    return trimmed.slice(9, -3);
  }
  return trimmed;
};

const extractXmlTag = (xml: string, tag: string): string => {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match && match[1] ? match[1] : '';
};

const parseBingRssResults = (xml: string, limit: number): Array<{ title: string; url: string }> => {
  const results: Array<{ title: string; url: string }> = [];
  const seen = new Set<string>();

  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null = itemRegex.exec(xml);
  while (match && results.length < limit) {
    const item = match[1] || '';
    const rawTitle = extractXmlTag(item, 'title');
    const rawLink = extractXmlTag(item, 'link');

    const title = decodeHtmlEntities(stripCdata(rawTitle)).replace(/\s+/g, ' ').trim();
    const url = decodeHtmlEntities(stripCdata(rawLink)).trim();

    if (title && url && (url.startsWith('http://') || url.startsWith('https://')) && !seen.has(url)) {
      seen.add(url);
      results.push({ title, url });
    }

    match = itemRegex.exec(xml);
  }

  return results;
};

export class WebSearchTool extends BaseTool {
  name = 'web';
  type = 'function';
  needsApproval = false;
  description =
    'Search the web for recent/public information and return a short list of relevant results.';

  paramSchema = WebToolInputSchema;

  protected async handler(args: z.infer<typeof this.paramSchema>) {
    const limit = Math.min(
      MAX_SEARCH_RESULT_LIMIT,
      Math.max(1, Math.trunc(args.limit || DEFAULT_SEARCH_RESULT_LIMIT))
    );
    const query = args.query.trim();
    if (!query) {
      throw new Error('Query cannot be empty');
    }

    const timeoutMs = getWebSearchTimeoutMs();
    const retries = 0;
    const warnings: string[] = [];
    const sourcesTried: string[] = [];

    const tryDuckDuckGo = async (): Promise<Array<{ title: string; url: string }> | null> => {
      sourcesTried.push('duckduckgo');
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await fetchWithTimeout(
        searchUrl,
        {
          method: 'GET',
          headers: {
            'user-agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36',
            accept: 'text/html,application/xhtml+xml',
          },
        },
        { timeoutMs, retries }
      );

      if (!response.ok) {
        throw new Error(`DuckDuckGo search failed with status ${response.status}`);
      }

      const html = await response.text();
      const results = parseDuckDuckGoResults(html, limit);
      return results.length > 0 ? results : null;
    };

    const tryBingRss = async (): Promise<Array<{ title: string; url: string }> > => {
      sourcesTried.push('bing');
      const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss`;
      const response = await fetchWithTimeout(
        searchUrl,
        {
          method: 'GET',
          headers: {
            'user-agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36',
            accept: 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
          },
        },
        { timeoutMs, retries }
      );

      if (!response.ok) {
        throw new Error(`Bing RSS search failed with status ${response.status}`);
      }

      const xml = await response.text();
      return parseBingRssResults(xml, limit);
    };

    let source: 'duckduckgo' | 'bing' = 'duckduckgo';
    let results: Array<{ title: string; url: string }> = [];

    try {
      const duckResults = await tryDuckDuckGo();
      if (duckResults) {
        source = 'duckduckgo';
        results = duckResults;
      } else {
        const bingResults = await tryBingRss();
        source = 'bing';
        results = bingResults;
      }
    } catch (err) {
      const firstError = err instanceof Error ? err.message : String(err);
      warnings.push(`duckduckgo: ${firstError}`);
      try {
        const bingResults = await tryBingRss();
        source = 'bing';
        results = bingResults;
      } catch (bingErr) {
        const secondError = bingErr instanceof Error ? bingErr.message : String(bingErr);
        const hint =
          'Hint: increase Settings > Network > Timeout, or enable Proxy if your network blocks certain sites.';
        throw new Error(
          `Web search failed (tried: ${sourcesTried.join(', ')}). duckduckgo: ${firstError}; bing: ${secondError}. ${hint}`
        );
      }
    }

    return {
      query,
      source,
      results,
      resultCount: results.length,
      ...(warnings.length > 0 ? { warnings } : {}),
      ...(sourcesTried.length > 0 ? { sourcesTried } : {}),
    };
  }
}

export class FetchTool extends BaseTool {
  name = 'fetch';
  type = 'function';
  needsApproval = false;
  description =
    'Fetch a webpage or text URL and return clean text content (with status and metadata).';

  paramSchema = FetchToolInputSchema;

  protected async handler(args: z.infer<typeof this.paramSchema>) {
    const parsedUrl = ensureHttpUrl(args.url);
    const maxChars = Math.min(
      MAX_FETCH_MAX_CHARS,
      Math.max(MIN_FETCH_MAX_CHARS, Math.trunc(args.maxChars || DEFAULT_FETCH_MAX_CHARS))
    );

    const response = await fetchWithTimeout(parsedUrl.toString(), {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36',
        accept: 'text/html,application/json,text/plain,application/xml,text/xml;q=0.9,*/*;q=0.8',
      },
    });

    const contentType = response.headers.get('content-type') || '';
    const body = await response.text();
    const isHtml = /text\/html|application\/xhtml\+xml/i.test(contentType);
    const isTextLike =
      isHtml ||
      /^text\//i.test(contentType) ||
      /application\/(json|xml|javascript|x-www-form-urlencoded)/i.test(contentType) ||
      contentType.length === 0;

    if (!isTextLike) {
      return {
        url: parsedUrl.toString(),
        finalUrl: response.url,
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        contentType,
        error: 'Unsupported content type for text extraction',
      };
    }

    const plainContent = isHtml ? htmlToPlainText(body) : body.trim();
    const { text: content, truncated } = truncateText(plainContent, maxChars);

    return {
      url: parsedUrl.toString(),
      finalUrl: response.url,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      contentType,
      title: isHtml ? extractTitle(body) : '',
      content,
      truncated,
    };
  }
}
