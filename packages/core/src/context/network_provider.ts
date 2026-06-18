let _fetchWithTimeout: ((url: string, init?: RequestInit, options?: { timeoutMs?: number; retries?: number }) => Promise<Response>) | null = null;

export function injectFetchWithTimeout(fn: typeof _fetchWithTimeout extends null ? never : typeof _fetchWithTimeout) {
  _fetchWithTimeout = fn;
}

export async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  options?: { timeoutMs?: number; retries?: number }
): Promise<Response> {
  if (!_fetchWithTimeout) throw new Error('fetchWithTimeout not injected');
  return _fetchWithTimeout(url, init, options);
}
