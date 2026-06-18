import { app, net, session, type Session } from 'electron';
import { randomUUID } from 'node:crypto';

import { getAppConfig } from '../../../core/config';
import { clampNetworkTimeoutMs } from '../../../shared/network/http';
import { normalizeAppConfig } from '../../../shared/config/normalize';
import { buildProxyUrl, getProxyCredentials } from '../../../shared/network/proxy';
import type {
  AppConfig,
  NetworkDiagnosticProbeResult,
  NetworkDiagnosticResult,
  NetworkDiagnosticTargetKey,
  WebSearchEngine,
} from '../../../shared/types/config';
import { getErrorMessage } from '../../../shared/utils/errors';

type NetworkDiagnosticTarget = {
  key: NetworkDiagnosticTargetKey;
  url: string;
};

const getSearchEngineDiagnosticUrl = (engine: WebSearchEngine): string => {
  if (engine === 'duckduckgo') {
    return 'https://html.duckduckgo.com/html/?q=ping';
  }
  if (engine === 'bing') {
    return 'https://www.bing.com/search?format=rss&q=ping';
  }
  return 'https://www.google.com/generate_204';
};

const buildNetworkDiagnosticTargets = (network: AppConfig['network']): NetworkDiagnosticTarget[] => [
  {
    key: 'internet',
    url: 'https://example.com/',
  },
  {
    key: 'searchEngine',
    url: getSearchEngineDiagnosticUrl(network.webSearch.preferredEngine),
  },
];

const buildEffectiveProxyLabel = (network: AppConfig['network']): string | null => {
  return buildProxyUrl(network, { maskPassword: true });
};

const buildSessionProxyRules = (network: AppConfig['network']): string | null => {
  return buildProxyUrl(network, { includeAuth: false });
};

const normalizeNetworkConfig = (candidate: AppConfig['network']): AppConfig['network'] => {
  return normalizeAppConfig(
    {
      network: candidate,
    },
    getAppConfig()
  ).network;
};

const validateNetworkConfig = (network: AppConfig['network']): string | null => {
  if (!network.proxy.enable) return null;

  const host = network.proxy.host.trim();
  if (!host) {
    return 'Proxy host is required when proxy is enabled.';
  }

  const port = network.proxy.port;
  if (!Number.isFinite(port) || Math.trunc(port) < 1 || Math.trunc(port) > 65535) {
    return 'Proxy port must be between 1 and 65535.';
  }

  return null;
};

const configureSessionProxy = async (ses: Session, network: AppConfig['network']): Promise<void> => {
  const proxyRules = buildSessionProxyRules(network);
  if (proxyRules) {
    await ses.setProxy({
      mode: 'fixed_servers',
      proxyRules,
    });
  } else {
    await ses.setProxy({ mode: 'direct' });
  }

  await ses.forceReloadProxyConfig();
};

const resolveProxyForTarget = async (ses: Session, url: string): Promise<string | null> => {
  try {
    return await ses.resolveProxy(url);
  } catch {
    return null;
  }
};

const runNetworkProbe = async (
  ses: Session,
  target: NetworkDiagnosticTarget,
  timeoutMs: number,
  credentials: { username: string; password: string } | null
): Promise<NetworkDiagnosticProbeResult> => {
  const startedAt = Date.now();
  const resolvedProxy = await resolveProxyForTarget(ses, target.url);

  return await new Promise(resolve => {
    let settled = false;
    let responseStatusCode: number | null = null;
    let loginAttempted = false;

    const request = net.request({
      method: 'GET',
      redirect: 'follow',
      session: ses,
      url: target.url,
    });
    const timer = setTimeout(() => {
      request.abort();
    }, timeoutMs);

    const finish = (partial: {
      success: boolean;
      statusCode?: number | null;
      error?: string | null;
    }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      resolve({
        key: target.key,
        url: target.url,
        success: partial.success,
        statusCode: partial.statusCode ?? responseStatusCode ?? null,
        durationMs: Date.now() - startedAt,
        error: partial.error ?? null,
        resolvedProxy,
      });
    };

    request.on('login', (authInfo, callback) => {
      if (!authInfo.isProxy || loginAttempted || !credentials) {
        callback();
        return;
      }

      loginAttempted = true;
      callback(credentials.username, credentials.password);
    });

    request.on('response', response => {
      responseStatusCode = typeof response.statusCode === 'number' ? response.statusCode : 0;

      response.on('data', () => undefined);
      response.on('aborted', () => {
        finish({
          success: false,
          error: 'Response aborted before completion.',
        });
      });
      response.on('end', () => {
        const success =
          responseStatusCode !== null && responseStatusCode >= 200 && responseStatusCode < 400;
        finish({
          success,
          error: success ? null : `HTTP ${responseStatusCode}`,
        });
      });
    });

    request.on('abort', () => {
      finish({
        success: false,
        error: `Timed out after ${timeoutMs} ms`,
      });
    });

    request.on('error', error => {
      finish({
        success: false,
        error: getErrorMessage(error),
      });
    });

    request.end();
  });
};

export const testNetworkConnectivity = async (
  candidate: AppConfig['network']
): Promise<NetworkDiagnosticResult> => {
  await app.whenReady();

  const network = normalizeNetworkConfig(candidate);
  const testedAt = new Date().toISOString();
  const effectiveProxy = buildEffectiveProxyLabel(network);
  const validationError = validateNetworkConfig(network);
  if (validationError) {
    return {
      success: false,
      testedAt,
      effectiveProxy,
      error: validationError,
      results: [],
    };
  }

  const ses = session.fromPartition(`network-diagnostics:${randomUUID()}`, {
    cache: false,
  });

  try {
    await configureSessionProxy(ses, network);
    const timeoutMs = clampNetworkTimeoutMs(network.timeout);
    const credentials = getProxyCredentials(network);
    const results: NetworkDiagnosticProbeResult[] = [];

    for (const target of buildNetworkDiagnosticTargets(network)) {
      results.push(await runNetworkProbe(ses, target, timeoutMs, credentials));
    }

    return {
      success: results.length > 0 && results.every(result => result.success),
      testedAt,
      effectiveProxy,
      error: null,
      results,
    };
  } catch (error) {
    return {
      success: false,
      testedAt,
      effectiveProxy,
      error: getErrorMessage(error),
      results: [],
    };
  } finally {
    try {
      await ses.setProxy({ mode: 'direct' });
    } catch {
      // Ignore cleanup failures for the ephemeral diagnostics session.
    }
  }
};
