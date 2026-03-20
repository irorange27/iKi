import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/core/config', () => ({
  getAppConfig: vi.fn(),
}));

import { createDefaultAppConfig } from '../../../src/shared/config/defaults';
import type { AppConfig } from '../../../src/shared/types/config';
import { getAppConfig } from '../../../src/core/config';
import {
  fetchWithTimeout,
  getNetworkRetryAttempts,
  getNetworkTimeoutMs,
} from '../../../src/core/network/http';

const getAppConfigMock = vi.mocked(getAppConfig);
const ORIGINAL_ENV = { ...process.env };

const mockConfig = (configure?: (config: AppConfig) => void) => {
  const config = createDefaultAppConfig();
  configure?.(config);
  getAppConfigMock.mockReturnValue(config);
};

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

describe('network config helpers', () => {
  it('clamps timeout to allowed range', () => {
    mockConfig(config => {
      config.network.timeout = 999999;
    });
    expect(getNetworkTimeoutMs()).toBe(60_000);

    mockConfig(config => {
      config.network.timeout = 100;
    });
    expect(getNetworkTimeoutMs()).toBe(1_000);
  });

  it('clamps retry attempts to allowed range', () => {
    mockConfig(config => {
      config.network.retryAttempts = 99;
    });
    expect(getNetworkRetryAttempts()).toBe(10);

    mockConfig(config => {
      config.network.retryAttempts = -3;
    });
    expect(getNetworkRetryAttempts()).toBe(0);
  });
});

describe('fetchWithTimeout', () => {
  it('retries once on retryable HTTP status and returns the successful response', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('retry', { status: 503 }))
        .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    );

    const response = await fetchWithTimeout('https://example.com', {}, { timeoutMs: 1000, retries: 1 });
    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-retryable status codes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })));

    const response = await fetchWithTimeout('https://example.com/missing', {}, { timeoutMs: 1000, retries: 3 });
    expect(response.status).toBe(404);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('converts AbortError into a timeout error message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          if (!signal) {
            reject(new Error('missing abort signal'));
            return;
          }

          if (signal.aborted) {
            reject(new DOMException('aborted', 'AbortError'));
            return;
          }

          signal.addEventListener(
            'abort',
            () => {
              reject(new DOMException('aborted', 'AbortError'));
            },
            { once: true }
          );
        });
      })
    );

    await expect(
      fetchWithTimeout('https://example.com/slow', {}, { timeoutMs: 15, retries: 0 })
    ).rejects.toThrow(/timed out after 15 ms/i);
  });

  it('applies proxy environment variables when proxy is configured', async () => {
    mockConfig(config => {
      config.network.proxy = {
        enable: true,
        type: 'http',
        host: '127.0.0.1',
        port: 8080,
        username: 'u',
        password: 'p',
      };
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok', { status: 200 })));

    await fetchWithTimeout('https://example.com');

    expect(process.env.HTTP_PROXY).toBe('http://u:p@127.0.0.1:8080');
    expect(process.env.HTTPS_PROXY).toBe('http://u:p@127.0.0.1:8080');
  });
});
