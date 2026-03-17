import type { AppConfig } from '../../shared/types/config';
import { getAppConfig } from '../config';

const DEFAULT_NETWORK_TIMEOUT_MS = 5000;
const MIN_NETWORK_TIMEOUT_MS = 1000;
const MAX_NETWORK_TIMEOUT_MS = 60000;
const DEFAULT_NETWORK_RETRY_ATTEMPTS = 0;
const MIN_NETWORK_RETRY_ATTEMPTS = 0;
const MAX_NETWORK_RETRY_ATTEMPTS = 10;

const getNetworkConfig = (): AppConfig['network'] | null => {
  return getAppConfig()?.network ?? null;
};

export const getNetworkTimeoutMs = (): number => {
  const timeout = getNetworkConfig()?.timeout;

  if (typeof timeout !== 'number' || !Number.isFinite(timeout)) {
    return DEFAULT_NETWORK_TIMEOUT_MS;
  }

  return Math.min(
    MAX_NETWORK_TIMEOUT_MS,
    Math.max(MIN_NETWORK_TIMEOUT_MS, Math.trunc(timeout))
  );
};

export const getNetworkRetryAttempts = (): number => {
  const retries = getNetworkConfig()?.retryAttempts;

  if (typeof retries !== 'number' || !Number.isFinite(retries)) {
    return DEFAULT_NETWORK_RETRY_ATTEMPTS;
  }

  return Math.min(
    MAX_NETWORK_RETRY_ATTEMPTS,
    Math.max(MIN_NETWORK_RETRY_ATTEMPTS, Math.trunc(retries))
  );
};

const buildProxyUrl = (): string | null => {
  const proxy = getNetworkConfig()?.proxy;
  if (!proxy?.enable) return null;

  const host = typeof proxy.host === 'string' ? proxy.host.trim() : '';
  const port = typeof proxy.port === 'number' && Number.isFinite(proxy.port) ? proxy.port : null;
  if (!host || !port) return null;

  const protocol = proxy.type || 'http';
  const username = typeof proxy.username === 'string' ? proxy.username : '';
  const password = typeof proxy.password === 'string' ? proxy.password : '';
  const auth =
    username || password
      ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
      : '';

  return `${protocol}://${auth}${host}:${port}`;
};

const applyProxyEnv = () => {
  const proxyUrl = buildProxyUrl();
  if (!proxyUrl) return;
  process.env.HTTP_PROXY = proxyUrl;
  process.env.HTTPS_PROXY = proxyUrl;
};

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

export const fetchWithTimeout = async (
  url: string,
  init?: RequestInit,
  options?: { timeoutMs?: number; retries?: number }
): Promise<Response> => {
  const timeout =
    typeof options?.timeoutMs === 'number' ? Math.trunc(options.timeoutMs) : getNetworkTimeoutMs();
  const retries =
    typeof options?.retries === 'number' ? Math.trunc(options.retries) : getNetworkRetryAttempts();

  applyProxyEnv();

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
