import { BUILTIN_PROVIDERS } from '@iki/backend/constants/ProvidersSettings';
import type { Provider } from '@iki/backend/types/provider';

const BUILTIN_PROVIDER_NAME_BY_ID = new Map(
  BUILTIN_PROVIDERS.map(provider => [provider.id, provider.name])
);

const BUILTIN_PROVIDER_LEGACY_NAMES_BY_ID = new Map<string, Set<string>>([
  ['acp', new Set(['ACP Agent'])],
]);

const normalizeProviderField = (value?: string | null) => value?.trim() || '';

export const getCanonicalBuiltInProviderName = (
  provider: Pick<Provider, 'name' | 'type'>
): string | null => {
  const normalizedType = normalizeProviderField(provider.type).toLowerCase();
  const canonicalName = BUILTIN_PROVIDER_NAME_BY_ID.get(normalizedType);
  if (!canonicalName) return null;

  const normalizedName = normalizeProviderField(provider.name);
  const legacyNames = BUILTIN_PROVIDER_LEGACY_NAMES_BY_ID.get(normalizedType);
  if (
    normalizedName === canonicalName ||
    (legacyNames && legacyNames.has(normalizedName))
  ) {
    return canonicalName;
  }

  return null;
};

export const getProviderDisplayName = (provider: Pick<Provider, 'name' | 'type'>) =>
  getCanonicalBuiltInProviderName(provider) ||
  normalizeProviderField(provider.name) ||
  normalizeProviderField(provider.type) ||
  'Provider';

export const getProviderFallbackText = (provider?: Pick<Provider, 'name' | 'type'> | null) => {
  const source = provider ? getProviderDisplayName(provider) : 'AI';
  const normalized = source
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 2)
    .toUpperCase();
  return normalized || 'AI';
};
