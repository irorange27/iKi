import { z } from 'zod';
import { BaseTool } from '@iki/core/tools/base';
import { fetchWithTimeout, getNetworkRetryAttempts, getNetworkTimeoutMs } from '@iki/backend/network/http';
import { RetryableError } from '@iki/core/utils/errors';
import { getAppConfig } from '../config';
import type { WebSearchEngine } from '@iki/core/types/config';
import {
  DEFAULT_FETCH_MAX_CHARS,
  DEFAULT_SEARCH_RESULT_LIMIT,
  FetchToolInputSchema,
  MAX_FETCH_MAX_CHARS,
  MAX_SEARCH_RESULT_LIMIT,
  MIN_FETCH_MAX_CHARS,
  WebToolInputSchema,
} from '@iki/core/tools/schemas';

// Give search a bit more time than the global default, but keep it interactive.
const MIN_WEB_SEARCH_TIMEOUT_MS = 12000;
const DEFAULT_WEB_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36';
const GOOGLE_HOST_PATTERN = /(^|\.)google\./i;

const getWebSearchTimeoutMs = (): number =>
  Math.max(getNetworkTimeoutMs(), MIN_WEB_SEARCH_TIMEOUT_MS);

const entityMap: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

type SearchLocale = {
  googleLanguage: string;
  googleCountry: string;
  duckDuckGoRegion: string;
  bingMarket: string;
  bingCountry: string;
  acceptLanguage: string;
};

type SearchProviderName = WebSearchEngine;
type SearchResult = { title: string; url: string };

const CJK_QUERY_PATTERN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

const inferSearchLocale = (query: string): SearchLocale => {
  if (CJK_QUERY_PATTERN.test(query)) {
    return {
      googleLanguage: 'zh-CN',
      googleCountry: 'CN',
      duckDuckGoRegion: 'cn-zh',
      bingMarket: 'zh-CN',
      bingCountry: 'CN',
      acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.6',
    };
  }

  return {
    googleLanguage: 'en',
    googleCountry: 'US',
    duckDuckGoRegion: 'us-en',
    bingMarket: 'en-US',
    bingCountry: 'US',
    acceptLanguage: 'en-US,en;q=0.9',
  };
};

const getPreferredSearchProvider = (): SearchProviderName => {
  return getAppConfig().network.webSearch.preferredEngine;
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

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

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

const extractAttribute = (attrs: string, name: string): string | null => {
  const regex = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = attrs.match(regex);
  const value = (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
  return value ? value : null;
};

const stripTags = (value: string): string => value.replace(/<[^>]*>/g, ' ');

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
  return normalizeWhitespace(decodeHtmlEntities(titleMatch[1]));
};

const normalizeAbsoluteHttpUrl = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const candidate = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};

const normalizeDuckDuckGoSearchHref = (href: string): string | null => {
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
      const target = tryDecodeUddg(uddg).trim();
      if (!target) return null;

      return normalizeAbsoluteHttpUrl(target);
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

const isGoogleHost = (hostname: string): boolean => GOOGLE_HOST_PATTERN.test(hostname);

const normalizeGoogleSearchHref = (href: string): string | null => {
  const decodedHref = decodeHtmlEntities(href).trim();
  if (!decodedHref) return null;

  const unwrapGoogleRedirect = (value: string): string | null => {
    try {
      const parsed = new URL(value, 'https://www.google.com');
      if (!isGoogleHost(parsed.hostname)) return null;
      if (parsed.pathname !== '/url' && parsed.pathname !== '/imgres') return null;

      const target = parsed.searchParams.get('q') ?? parsed.searchParams.get('url');
      return target ? normalizeAbsoluteHttpUrl(target) : null;
    } catch {
      return null;
    }
  };

  const candidate = decodedHref.startsWith('//') ? `https:${decodedHref}` : decodedHref;

  if (candidate.startsWith('/url?') || candidate.startsWith('/imgres?')) {
    return unwrapGoogleRedirect(`https://www.google.com${candidate}`);
  }

  if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
    const unwrapped = unwrapGoogleRedirect(candidate);
    if (unwrapped) return unwrapped;

    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      if (isGoogleHost(parsed.hostname)) return null;
      return parsed.toString();
    } catch {
      return null;
    }
  }

  return null;
};

const parseGoogleResults = (html: string, limit: number): SearchResult[] => {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null = anchorRegex.exec(html);
  while (match && results.length < limit) {
    const attrs = match[1] || '';
    const hrefAttr = extractAttribute(attrs, 'href');
    const normalizedUrl = hrefAttr ? normalizeGoogleSearchHref(hrefAttr) : null;
    if (!normalizedUrl || seen.has(normalizedUrl)) {
      match = anchorRegex.exec(html);
      continue;
    }

    const rawContent = match[2] || '';
    const h3Match = rawContent.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i);
    const rawTitle = h3Match?.[1] ?? extractAttribute(attrs, 'aria-label') ?? '';
    const title = normalizeWhitespace(decodeHtmlEntities(stripTags(rawTitle)));
    if (!title) {
      match = anchorRegex.exec(html);
      continue;
    }

    seen.add(normalizedUrl);
    results.push({ title, url: normalizedUrl });
    match = anchorRegex.exec(html);
  }

  return results;
};

const getGoogleSearchFailure = (
  html: string,
  results: SearchResult[]
): string | null => {
  const pageTitle = extractTitle(html);
  const bodyText = normalizeWhitespace(htmlToPlainText(html));
  const lowerBodyText = bodyText.toLowerCase();
  const consentLike =
    /before you continue to google|在继续之前|继续前往 google|consent/i.test(bodyText) ||
    /consent\.google\.com|[?&]consent=|\/consent/i.test(html);
  const captchaLike =
    /unusual traffic|verify you are human|not a robot|captcha|我们的系统检测到/i.test(bodyText) ||
    /\/sorry\//i.test(html) ||
    /captcha-form|g-recaptcha/i.test(html);
  const hasSearchRoot = /id\s*=\s*["']search["']/i.test(html) || /role\s*=\s*["']main["']/i.test(html);

  if (captchaLike) {
    return 'Google search requires human verification before results can be accessed';
  }
  if (consentLike) {
    return 'Google search requires a consent page before results can be accessed';
  }
  if (!hasSearchRoot && results.length === 0) {
    return pageTitle
      ? `Google search page was not parseable (title: ${pageTitle})`
      : 'Google search page did not expose a stable search result region';
  }
  if (results.length === 0) {
    return lowerBodyText.includes('did not match any documents')
      ? 'Google search returned no results for this query'
      : 'Google search returned no parseable organic results';
  }
  return null;
};

const parseDuckDuckGoResults = (html: string, limit: number): SearchResult[] => {
  const results: SearchResult[] = [];
  const seen = new Set<string>();

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
    const normalizedUrl = hrefAttr ? normalizeDuckDuckGoSearchHref(decodeHtmlEntities(hrefAttr)) : null;
    const rawTitle = match[2] || '';
    const title = normalizeWhitespace(decodeHtmlEntities(stripTags(rawTitle)));

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

const parseBingRssResults = (xml: string, limit: number): SearchResult[] => {
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null = itemRegex.exec(xml);
  while (match && results.length < limit) {
    const item = match[1] || '';
    const rawTitle = extractXmlTag(item, 'title');
    const rawLink = extractXmlTag(item, 'link');

    const title = normalizeWhitespace(decodeHtmlEntities(stripCdata(rawTitle)));
    const url = decodeHtmlEntities(stripCdata(rawLink)).trim();

    if (
      title &&
      url &&
      (url.startsWith('http://') || url.startsWith('https://')) &&
      !seen.has(url)
    ) {
      seen.add(url);
      results.push({ title, url });
    }

    match = itemRegex.exec(xml);
  }

  return results;
};

export class WebSearchTool extends BaseTool {
  override name = 'web';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = false;
  override description =
    'Search the public web and return candidate result titles/URLs. Use this to discover sources; if the answer depends on page contents, call `fetch` on the selected result before answering.';

  override paramSchema = WebToolInputSchema;

  override retry = { maxRetries: 2 };

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const limit = Math.min(
      MAX_SEARCH_RESULT_LIMIT,
      Math.max(1, Math.trunc(args.limit || DEFAULT_SEARCH_RESULT_LIMIT))
    );
    const query = args.query.trim();
    if (!query) {
      throw new Error('Query cannot be empty');
    }

    const timeoutMs = getWebSearchTimeoutMs();
    const retries = Math.min(getNetworkRetryAttempts(), 1);
    const warnings: string[] = [];
    const sourcesTried: SearchProviderName[] = [];
    const locale = inferSearchLocale(query);

    const tryGoogle = async (): Promise<SearchResult[]> => {
      const searchUrl =
        `https://www.google.com/search?q=${encodeURIComponent(query)}` +
        `&hl=${encodeURIComponent(locale.googleLanguage)}` +
        `&gl=${encodeURIComponent(locale.googleCountry)}` +
        `&num=${Math.max(limit, DEFAULT_SEARCH_RESULT_LIMIT)}`;
      const response = await fetchWithTimeout(
        searchUrl,
        {
          method: 'GET',
          headers: {
            'user-agent': DEFAULT_WEB_USER_AGENT,
            accept: 'text/html,application/xhtml+xml',
            'accept-language': locale.acceptLanguage,
          },
        },
        { timeoutMs, retries }
      );

      if (!response.ok) {
        throw new RetryableError(`Google search failed with status ${response.status}`);
      }

      const html = await response.text();
      const results = parseGoogleResults(html, limit);
      const failure = getGoogleSearchFailure(html, results);
      if (failure) {
        throw new RetryableError(failure);
      }

      return results;
    };

    const tryDuckDuckGo = async (): Promise<SearchResult[]> => {
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=${encodeURIComponent(locale.duckDuckGoRegion)}`;
      const response = await fetchWithTimeout(
        searchUrl,
        {
          method: 'GET',
          headers: {
            'user-agent': DEFAULT_WEB_USER_AGENT,
            accept: 'text/html,application/xhtml+xml',
            'accept-language': locale.acceptLanguage,
          },
        },
        { timeoutMs, retries }
      );

      if (!response.ok) {
        throw new RetryableError(`DuckDuckGo search failed with status ${response.status}`);
      }

      const html = await response.text();
      const results = parseDuckDuckGoResults(html, limit);
      if (results.length === 0) {
        throw new RetryableError('DuckDuckGo search returned no parseable results');
      }

      return results;
    };

    const tryBingRss = async (): Promise<SearchResult[]> => {
      const searchUrl =
        `https://www.bing.com/search?q=${encodeURIComponent(query)}` +
        `&format=rss&mkt=${encodeURIComponent(locale.bingMarket)}` +
        `&setlang=${encodeURIComponent(locale.bingMarket)}` +
        `&cc=${encodeURIComponent(locale.bingCountry)}`;
      const response = await fetchWithTimeout(
        searchUrl,
        {
          method: 'GET',
          headers: {
            'user-agent': DEFAULT_WEB_USER_AGENT,
            accept: 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
            'accept-language': locale.acceptLanguage,
          },
        },
        { timeoutMs, retries }
      );

      if (!response.ok) {
        throw new RetryableError(`Bing RSS search failed with status ${response.status}`);
      }

      const xml = await response.text();
      const results = parseBingRssResults(xml, limit);
      if (results.length === 0) {
        throw new RetryableError('Bing RSS search returned no parseable results');
      }
      return results;
    };

    const providersByName: Record<
      SearchProviderName,
      {
        name: SearchProviderName;
        execute: () => Promise<SearchResult[]>;
      }
    > = {
      google: { name: 'google', execute: tryGoogle },
      duckduckgo: { name: 'duckduckgo', execute: tryDuckDuckGo },
      bing: { name: 'bing', execute: tryBingRss },
    };
    const preferredProvider = getPreferredSearchProvider();
    const providerOrder: SearchProviderName[] = [
      preferredProvider,
      ...(['google', 'duckduckgo', 'bing'] as SearchProviderName[]).filter(
        provider => provider !== preferredProvider
      ),
    ];
    const providers = providerOrder.map(provider => providersByName[provider]);

    const providersConfig: Array<{
      name: SearchProviderName;
      execute: () => Promise<SearchResult[]>;
    }> = providers;

    let source: SearchProviderName = 'google';
    let results: SearchResult[] = [];

    for (const provider of providersConfig) {
      sourcesTried.push(provider.name);
      try {
        results = await provider.execute();
        source = provider.name;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`${provider.name}: ${message}`);
      }
    }

    if (results.length === 0) {
      const hint =
        'Hint: increase Settings > Network > Timeout, or enable Proxy if your network blocks certain sites.';
      throw new RetryableError(`Web search failed (tried: ${sourcesTried.join(', ')}). ${warnings.join('; ')}. ${hint}`);
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
  override name = 'fetch';
  override type = 'function';
  override autoAllowed = true;
  override needsApproval = false;
  override description =
    'Fetch a specific webpage or text URL and return clean extracted text with status and metadata. Use this after `web` when you need facts from the page itself, not just result titles.';

  override paramSchema = FetchToolInputSchema;

  override retry = { maxRetries: 1 };

  protected override async handler(args: z.infer<typeof this.paramSchema>) {
    const parsedUrl = ensureHttpUrl(args.url);
    const maxChars = Math.min(
      MAX_FETCH_MAX_CHARS,
      Math.max(MIN_FETCH_MAX_CHARS, Math.trunc(args.maxChars || DEFAULT_FETCH_MAX_CHARS))
    );

    const response = await fetchWithTimeout(parsedUrl.toString(), {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent': DEFAULT_WEB_USER_AGENT,
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
