import type { AppConfig } from '@iki/core/types/config';

type NetworkConfig = AppConfig['network'];

const isFinitePort = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const normalizeHost = (network: NetworkConfig | null | undefined): string => {
  const host = network?.proxy?.host;
  return typeof host === 'string' ? host.trim() : '';
};

const normalizePort = (network: NetworkConfig | null | undefined): number | null => {
  const port = network?.proxy?.port;
  return isFinitePort(port) ? Math.trunc(port) : null;
};

const normalizeUsername = (network: NetworkConfig | null | undefined): string => {
  const username = network?.proxy?.username;
  return typeof username === 'string' ? username : '';
};

const normalizePassword = (network: NetworkConfig | null | undefined): string => {
  const password = network?.proxy?.password;
  return typeof password === 'string' ? password : '';
};

export const hasEnabledProxy = (network: NetworkConfig | null | undefined): boolean =>
  Boolean(network?.proxy?.enable);

export const getProxyProtocol = (
  network: NetworkConfig | null | undefined
): AppConfig['network']['proxy']['type'] => network?.proxy?.type || 'http';

export const isProxyEndpointConfigured = (network: NetworkConfig | null | undefined): boolean =>
  hasEnabledProxy(network) && Boolean(normalizeHost(network)) && normalizePort(network) !== null;

export const buildProxyUrl = (
  network: NetworkConfig | null | undefined,
  options?: {
    includeAuth?: boolean;
    maskPassword?: boolean;
  }
): string | null => {
  if (!hasEnabledProxy(network)) return null;

  const host = normalizeHost(network);
  const port = normalizePort(network);
  if (!host || port === null) return null;

  const protocol = getProxyProtocol(network);
  const includeAuth = options?.includeAuth !== false;
  if (!includeAuth) {
    return `${protocol}://${host}:${port}`;
  }

  const username = normalizeUsername(network);
  const password = normalizePassword(network);
  const maskedPassword = options?.maskPassword && password ? '***' : password;
  const auth =
    username || password
      ? `${encodeURIComponent(username)}:${encodeURIComponent(maskedPassword)}@`
      : '';

  return `${protocol}://${auth}${host}:${port}`;
};

export const getProxyCredentials = (
  network: NetworkConfig | null | undefined
): { username: string; password: string } | null => {
  if (!hasEnabledProxy(network)) return null;

  const username = normalizeUsername(network);
  const password = normalizePassword(network);
  if (!username && !password) return null;

  return { username, password };
};
