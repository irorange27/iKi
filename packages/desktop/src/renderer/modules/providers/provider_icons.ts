import { BUILTIN_PROVIDERS } from '@iki/core/constants/ProvidersSettings';
import type { Provider } from '@iki/core/types/provider';
import { getCanonicalBuiltInProviderName, getProviderFallbackText } from './provider_display';

export type ProviderIconProps = {
  name: string;
  useCdn?: boolean;
  cdnPrefix?: string;
  fallbackText: string;
};

type ProviderWithOptionalIcon = Pick<Provider, 'name' | 'type'> & {
  icon?: string | null;
};

const CUSTOM_PROVIDER_ICON_CDN = 'https://unpkg.com/lucide-static@latest/icons';
const BUILTIN_PROVIDER_NAME_BY_ID = new Map(
  BUILTIN_PROVIDERS.map(provider => [provider.id, provider.name])
);

const normalizeProviderField = (value?: string | null) => value?.trim() || '';

export const getProviderIconName = (providerId: string): string => {
  const normalizedId = providerId.trim().toLowerCase();

  const iconMap: Record<string, string> = {
    openai: 'openai',
    'openai-compatible': 'openai',
    anthropic: 'anthropic',
    'anthropic-compatible': 'anthropic',
    claude: 'claude',
    google: 'google',
    gemini: 'gemini',
    deepseek: 'deepseek',
    kimi: 'kimi',
    ollama: 'ollama',
    acp: 'bot',
    openrouter: 'openrouter',
    azure: 'azure',
    qwen: 'qwen',
    mistral: 'mistral',
  };

  return iconMap[normalizedId] || normalizedId;
};

export const isCanonicalBuiltInProvider = (provider: Pick<Provider, 'name' | 'type'>): boolean => {
  const normalizedType = normalizeProviderField(provider.type).toLowerCase();
  if (!BUILTIN_PROVIDER_NAME_BY_ID.has(normalizedType)) {
    return false;
  }

  return getCanonicalBuiltInProviderName(provider) !== null;
};

export const getCustomProviderIconProps = (
  icon?: string | null,
  fallbackText = '?'
): ProviderIconProps => {
  const normalizedIcon = normalizeProviderField(icon);

  return {
    name: normalizedIcon && normalizedIcon !== 'custom' ? normalizedIcon : 'grid-2x2',
    useCdn: true,
    cdnPrefix: CUSTOM_PROVIDER_ICON_CDN,
    fallbackText,
  };
};

export const getProviderIconProps = (provider: ProviderWithOptionalIcon): ProviderIconProps => {
  const fallbackText = getProviderFallbackText(provider);

  if (isCanonicalBuiltInProvider(provider)) {
    return {
      name: getProviderIconName(provider.type),
      fallbackText,
    };
  }

  return getCustomProviderIconProps(provider.icon, fallbackText);
};
