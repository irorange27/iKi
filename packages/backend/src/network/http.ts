import type { AppConfig } from '@iki/core/types/config';
import { buildProxyUrl } from './proxy';
import { getAppConfig } from '@iki/core/config';
import { canUseElectronNetworkStack, electronFetchWithTimeout } from './electron_fetch';

const DEFAULT_NETWORK_TIMEOUT_MS = 5000;
const MIN_NETWORK_TIMEOUT_MS = 1000;
const MAX_NETWORK_TIMEOUT_MS = 60000;
const DEFAULT_NETWORK_RETRY_ATTEMPTS = 0;
const MIN_NETWORK_RETRY_ATTEMPTS = 0;
const MAX_NETWORK_RETRY_ATTEMPTS = 10;

const managedProxyEnvState: {
  active: boolean;
  currentProxyUrl?: string;
  previousHttpProxy?: string;
  previousHttpsProxy?: string;
} = {
  active: false,
};

const getNetworkConfig = (): AppConfig['network'] | null => {
  return getAppConfig()?.network ?? null;
};

export const clampNetworkTimeoutMs = (timeout: unknown): number => {
  if (typeof timeout !== 'number' || !Number.isFinite(timeout)) {
    return DEFAULT_NETWORK_TIMEOUT_MS;
  }

  return Math.min(
    MAX_NETWORK_TIMEOUT_MS,
    Math.max(MIN_NETWORK_TIMEOUT_MS, Math.trunc(timeout))
  );
};

export const getNetworkTimeoutMs = (): number => {
  return clampNetworkTimeoutMs(getNetworkConfig()?.timeout);
};

export const clampNetworkRetryAttempts = (retries: unknown): number => {
  if (typeof retries !== 'number' || !Number.isFinite(retries)) {
    return DEFAULT_NETWORK_RETRY_ATTEMPTS;
  }

  return Math.min(
    MAX_NETWORK_RETRY_ATTEMPTS,
    Math.max(MIN_NETWORK_RETRY_ATTEMPTS, Math.trunc(retries))
  );
};

export const getNetworkRetryAttempts = (): number => {
  return clampNetworkRetryAttempts(getNetworkConfig()?.retryAttempts);
};

export const getConfiguredProxyUrl = (): string | null => {
  return buildProxyUrl(getNetworkConfig());
};

const restoreManagedProxyEnv = () => {
  if (!managedProxyEnvState.active) return;

  if (managedProxyEnvState.previousHttpProxy === undefined) {
    delete process.env.HTTP_PROXY;
  } else {
    process.env.HTTP_PROXY = managedProxyEnvState.previousHttpProxy;
  }

  if (managedProxyEnvState.previousHttpsProxy === undefined) {
    delete process.env.HTTPS_PROXY;
  } else {
    process.env.HTTPS_PROXY = managedProxyEnvState.previousHttpsProxy;
  }

  managedProxyEnvState.active = false;
  delete managedProxyEnvState.currentProxyUrl;
  delete managedProxyEnvState.previousHttpProxy;
  delete managedProxyEnvState.previousHttpsProxy;
};

const applyProxyEnv = () => {
  const proxyUrl = getConfiguredProxyUrl();
  if (!proxyUrl) {
    restoreManagedProxyEnv();
    return;
  }

  const envMatchesManagedProxy =
    managedProxyEnvState.active &&
    process.env.HTTP_PROXY === managedProxyEnvState.currentProxyUrl &&
    process.env.HTTPS_PROXY === managedProxyEnvState.currentProxyUrl;

  if (!envMatchesManagedProxy) {
    managedProxyEnvState.previousHttpProxy = process.env.HTTP_PROXY;
    managedProxyEnvState.previousHttpsProxy = process.env.HTTPS_PROXY;
  }

  process.env.HTTP_PROXY = proxyUrl;
  process.env.HTTPS_PROXY = proxyUrl;
  managedProxyEnvState.active = true;
  managedProxyEnvState.currentProxyUrl = proxyUrl;
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
  const hasElectronNetwork = await canUseElectronNetworkStack();

  applyProxyEnv();

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (hasElectronNetwork) {
      try {
        const electronResponse = await electronFetchWithTimeout(url, init, timeout);
        if (!electronResponse) {
          throw new Error('Electron network stack is unavailable');
        }

        if (electronResponse.ok) return electronResponse;

        if (attempt >= retries || !isRetryableStatus(electronResponse.status)) {
          return electronResponse;
        }

        try {
          await electronResponse.arrayBuffer();
        } catch {
          // ignore
        }
      } catch (error) {
        lastError = error;
        if (attempt >= retries) {
          throw lastError;
        }
      }

      await sleep(Math.min(2000, 250 * Math.pow(2, attempt)));
      continue;
    }

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
