import type { Session } from 'electron';

import { getAppConfig } from '@iki/core/config';
import { buildProxyUrl, getProxyCredentials } from './proxy';
import type { AppConfig } from '@iki/core/types/config';
import { getErrorMessage } from '@iki/core/utils/errors';

const ELECTRON_NETWORK_PARTITION = 'iki-runtime-network';
const MAX_REDIRECTS = 8;

type ElectronModule = typeof import('electron');

let electronModulePromise: Promise<ElectronModule | null> | null = null;
let appliedProxySignature: string | null | undefined;

const isRedirectStatus = (status: number): boolean =>
  status === 301 || status === 302 || status === 303 || status === 307 || status === 308;

const canUseElectronRuntime = (): boolean => Boolean(process.versions?.electron);

const loadElectronModule = async (): Promise<ElectronModule | null> => {
  if (!canUseElectronRuntime()) return null;
  if (electronModulePromise) return electronModulePromise;

  electronModulePromise = (async () => {
    try {
      return (await import('electron')) as ElectronModule;
    } catch {
      return null;
    }
  })();

  return electronModulePromise;
};

const normalizeHeaders = (headers?: HeadersInit): Headers => new Headers(headers ?? undefined);

const toElectronHeaders = (headers: Headers): Record<string, string | string[]> => {
  const normalized: Record<string, string | string[]> = {};

  headers.forEach((value, key) => {
    const existing = normalized[key];
    if (existing === undefined) {
      normalized[key] = value;
      return;
    }

    if (Array.isArray(existing)) {
      existing.push(value);
      return;
    }

    normalized[key] = [existing, value];
  });

  return normalized;
};

const toResponseHeaders = (headers: Record<string, string | string[]>): Headers => {
  const normalized = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        normalized.append(key, entry);
      }
      continue;
    }

    normalized.append(key, value);
  }

  return normalized;
};

const toRequestBodyBuffer = async (body: BodyInit | null | undefined): Promise<Buffer | null> => {
  if (body === null || body === undefined) return null;
  if (typeof body === 'string') return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return Buffer.from(await body.arrayBuffer());
  }

  throw new Error('Unsupported request body for Electron-backed fetch');
};

const getNetworkConfig = (): AppConfig['network'] => getAppConfig().network;

const getSession = async (electronModule: ElectronModule): Promise<Session> => {
  await electronModule.app.whenReady();
  return electronModule.session.fromPartition(ELECTRON_NETWORK_PARTITION, {
    cache: false,
  });
};

const syncSessionProxy = async (
  ses: Session,
  network: AppConfig['network']
): Promise<{ username: string; password: string } | null> => {
  const proxyRules = buildProxyUrl(network, { includeAuth: false });
  const signature = proxyRules ?? '__direct__';

  if (appliedProxySignature !== signature) {
    if (proxyRules) {
      await ses.setProxy({
        mode: 'fixed_servers',
        proxyRules,
      });
    } else {
      await ses.setProxy({ mode: 'direct' });
    }

    await ses.forceReloadProxyConfig();
    appliedProxySignature = signature;
  }

  return getProxyCredentials(network);
};

const normalizeRedirectMode = (value?: RequestRedirect): RequestRedirect => value ?? 'follow';

const buildRedirectInit = (
  init: RequestInit | undefined,
  status: number
): RequestInit | undefined => {
  const normalizedMethod = (init?.method ?? 'GET').toUpperCase();
  if (status === 303 || ((status === 301 || status === 302) && normalizedMethod === 'POST')) {
    const headers = normalizeHeaders(init?.headers);
    headers.delete('content-length');
    headers.delete('content-type');
    return {
      ...init,
      method: 'GET',
      body: undefined,
      headers,
    };
  }

  return init;
};

const performElectronRequest = async (
  electronModule: ElectronModule,
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
  redirectCount = 0
): Promise<Response> => {
  const ses = await getSession(electronModule);
  const credentials = await syncSessionProxy(ses, getNetworkConfig());
  const headers = normalizeHeaders(init?.headers);
  const bodyBuffer = await toRequestBodyBuffer(init?.body);
  const method = (init?.method ?? 'GET').toUpperCase();
  const redirectMode = normalizeRedirectMode(init?.redirect);

  return await new Promise<Response>((resolve, reject) => {
    let settled = false;
    let loginAttempted = false;

    const finish = (result: { response?: Response; error?: unknown }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (result.error !== undefined) {
        reject(result.error);
        return;
      }
      resolve(result.response as Response);
    };

    const request = electronModule.net.request({
      method,
      redirect: 'manual',
      session: ses,
      url,
      headers: toElectronHeaders(headers),
    });

    const timer = setTimeout(() => {
      request.abort();
    }, timeoutMs);

    request.on('login', (authInfo, callback) => {
      if (!authInfo.isProxy || loginAttempted || !credentials) {
        callback();
        return;
      }

      loginAttempted = true;
      callback(credentials.username, credentials.password);
    });

    request.on('response', response => {
      const status = typeof response.statusCode === 'number' ? response.statusCode : 0;
      const responseHeaders = toResponseHeaders(response.headers);
      const location = responseHeaders.get('location');

      if (isRedirectStatus(status) && location) {
        if (redirectMode === 'error') {
          finish({
            error: new Error(`Request redirected to ${location} but redirect mode is "error"`),
          });
          return;
        }

        if (redirectMode === 'follow') {
          if (redirectCount >= MAX_REDIRECTS) {
            finish({
              error: new Error(`Request exceeded ${MAX_REDIRECTS} redirects`),
            });
            return;
          }

          const readable = response as unknown as NodeJS.ReadableStream & {
            resume?: () => void;
          };
          readable.resume?.();
          const nextUrl = new URL(location, url).toString();
          void performElectronRequest(
            electronModule,
            nextUrl,
            buildRedirectInit(init, status),
            timeoutMs,
            redirectCount + 1
          )
            .then(redirectedResponse => finish({ response: redirectedResponse }))
            .catch(error => finish({ error }));
          return;
        }
      }

      const chunks: Buffer[] = [];

      response.on('data', chunk => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on('aborted', () => {
        finish({
          error: new Error('Electron network response aborted before completion'),
        });
      });
      response.on('end', () => {
        const finalUrl = url;
        const body = Buffer.concat(chunks);
        const fetchResponse = new Response(body, {
          status,
          statusText: response.statusMessage ?? '',
          headers: responseHeaders,
        });

        Object.defineProperty(fetchResponse, 'url', {
          value: finalUrl,
          configurable: true,
        });
        Object.defineProperty(fetchResponse, 'redirected', {
          value: redirectCount > 0,
          configurable: true,
        });

        finish({
          response: fetchResponse,
        });
      });
    });

    request.on('abort', () => {
      finish({
        error: new Error(`Network request timed out after ${timeoutMs} ms`),
      });
    });

    request.on('error', error => {
      finish({
        error: new Error(getErrorMessage(error)),
      });
    });

    request.end(bodyBuffer ?? undefined);
  });
};

export const canUseElectronNetworkStack = async (): Promise<boolean> => {
  return (await loadElectronModule()) !== null;
};

export const electronFetchWithTimeout = async (
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number
): Promise<Response | null> => {
  const electronModule = await loadElectronModule();
  if (!electronModule) return null;
  return await performElectronRequest(electronModule, url, init, timeoutMs);
};
