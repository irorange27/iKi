export const DEFAULT_DAEMON_HOST = '0.0.0.0';
export const DEFAULT_DAEMON_PORT = 6127;
export const NAPCAT_REVERSE_WS_PATH = '/onebot/v11/ws';

export const buildNapCatWsUrl = (host: string, port: number, accessToken = ''): string => {
  const baseUrl = `ws://${host}:${port}${NAPCAT_REVERSE_WS_PATH}`;
  const token = accessToken.trim();
  if (!token) return baseUrl;
  return `${baseUrl}?access_token=${encodeURIComponent(token)}`;
};
