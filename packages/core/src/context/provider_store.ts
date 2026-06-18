import type { Provider } from '../types/provider';

let _getProviders: (() => Provider[]) | null = null;
let _getProvider: ((id: string) => Provider | null) | null = null;

export function injectProviderStore(fns: {
  getProviders: () => Provider[];
  getProvider: (id: string) => Provider | null;
}) {
  _getProviders = fns.getProviders;
  _getProvider = fns.getProvider;
}

export function getProviders(): Provider[] {
  if (!_getProviders) throw new Error('Provider store not injected');
  return _getProviders();
}

export function getProvider(id: string): Provider | null {
  if (!_getProvider) throw new Error('Provider store not injected');
  return _getProvider(id);
}
