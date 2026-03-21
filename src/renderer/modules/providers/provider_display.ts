import type { Provider } from '../../../shared/types/provider';

export const getProviderDisplayName = (provider: Pick<Provider, 'name' | 'type'>) =>
  provider.name?.trim() || provider.type?.trim() || 'Provider';

export const getProviderFallbackText = (provider?: Pick<Provider, 'name' | 'type'> | null) => {
  const source = provider ? getProviderDisplayName(provider) : 'AI';
  const normalized = source
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 2)
    .toUpperCase();
  return normalized || 'AI';
};
