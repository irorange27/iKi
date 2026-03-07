import { z } from 'zod';
import { BaseTool } from './base';
import { getConfig } from '../db/database';
import type { AppConfig } from '../../shared/types/config';

const DEFAULT_NETWORK_TIMEOUT_MS = 5000;
const MIN_NETWORK_TIMEOUT_MS = 1000;
const MAX_NETWORK_TIMEOUT_MS = 60000;
const DEFAULT_SEARCH_RESULT_LIMIT = 5;
const MAX_SEARCH_RESULT_LIMIT = 10;
const DEFAULT_FETCH_MAX_CHARS = 12000;
const MIN_FETCH_MAX_CHARS = 500;
const MAX_FETCH_MAX_CHARS = 80000;

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

const fetchWithTimeout = async (url: string, init?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timeout = getNetworkTimeoutMs();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
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

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  if (trimmed.startsWith('//')) {
    return `https:${trimmed}`;
  }

  if (trimmed.startsWith('/l/?')) {
    try {
      const url = new URL(`https://duckduckgo.com${trimmed}`);
      const target = url.searchParams.get('uddg');
      if (target) return decodeURIComponent(target);
    } catch {
      return null;
    }
  }

  return null;
};

const parseDuckDuckGoResults = (
  html: string,
  limit: number
): Array<{ title: string; url: string }> => {
  const results: Array<{ title: string; url: string }> = [];
  const seen = new Set<string>();
  const resultLinkRegex =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null = resultLinkRegex.exec(html);
  while (match && results.length < limit) {
    const normalizedUrl = normalizeSearchHref(decodeHtmlEntities(match[1] || ''));
    const title = decodeHtmlEntities(match[2] || '').replace(/\s+/g, ' ').trim();

    if (normalizedUrl && title && !seen.has(normalizedUrl)) {
      seen.add(normalizedUrl);
      results.push({ title, url: normalizedUrl });
    }
    match = resultLinkRegex.exec(html);
  }

  return results;
};

export class WebSearchTool extends BaseTool {
  name = 'web';
  type = 'function';
  needsApproval = false;
  description =
    'Search the web for recent/public information and return a short list of relevant results.';

  paramSchema = z.object({
    query: z.string().min(1).describe('Search query text'),
    limit: z
      .number()
      .int()
      .optional()
      .default(DEFAULT_SEARCH_RESULT_LIMIT)
      .describe('Maximum number of search results'),
  });

  get parameters() {
    return {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query text' },
        limit: {
          type: 'number',
          description: `Maximum number of search results (${DEFAULT_SEARCH_RESULT_LIMIT}-${MAX_SEARCH_RESULT_LIMIT})`,
          default: DEFAULT_SEARCH_RESULT_LIMIT,
        },
      },
      required: ['query'],
    };
  }

  protected async handler(args: z.infer<typeof this.paramSchema>) {
    const limit = Math.min(
      MAX_SEARCH_RESULT_LIMIT,
      Math.max(1, Math.trunc(args.limit || DEFAULT_SEARCH_RESULT_LIMIT))
    );
    const query = args.query.trim();
    if (!query) {
      throw new Error('Query cannot be empty');
    }

    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetchWithTimeout(searchUrl, {
      method: 'GET',
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36',
        accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      throw new Error(`Search request failed with status ${response.status}`);
    }

    const html = await response.text();
    const results = parseDuckDuckGoResults(html, limit);

    return {
      query,
      source: 'duckduckgo',
      results,
      resultCount: results.length,
    };
  }
}

export class FetchTool extends BaseTool {
  name = 'fetch';
  type = 'function';
  needsApproval = false;
  description =
    'Fetch a webpage or text URL and return clean text content (with status and metadata).';

  paramSchema = z.object({
    url: z.string().url().describe('HTTP/HTTPS URL to fetch'),
    maxChars: z
      .number()
      .int()
      .optional()
      .default(DEFAULT_FETCH_MAX_CHARS)
      .describe('Maximum number of characters to return from fetched content'),
  });

  get parameters() {
    return {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'HTTP/HTTPS URL to fetch' },
        maxChars: {
          type: 'number',
          description: `Maximum number of characters to return (${MIN_FETCH_MAX_CHARS}-${MAX_FETCH_MAX_CHARS})`,
          default: DEFAULT_FETCH_MAX_CHARS,
        },
      },
      required: ['url'],
    };
  }

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
