import type { BuiltInProvider } from '@iki/backend/types/settings';
import type { SidebarProvider, ProviderSupportLink } from './provider_settings_shared';
import type { ProviderRecord } from '../../../composables/useProviderDrafts';
import { parseModelList } from '@iki/backend/utils/provider_models';
import { getProviderDisplayName } from '../../../modules/providers/provider_display';

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

const BUILTIN_PROVIDER_ORDER = new Map(
  [
    'openai',
    'anthropic',
    'deepseek',
    'kimi',
    'minimax',
    'ollama',
    'acp',
  ].map((providerId, index) => [providerId, index])
);

export const buildSidebarProviders = (params: {
  builtInProviders: BuiltInProvider[];
  isCanonicalBuiltInConfig: (provider: ProviderRecord, providerId?: string) => boolean;
  isProviderEnabled: (providerId: string) => boolean;
  providers: ProviderRecord[];
  query: string;
}): SidebarProvider[] => {
  const query = params.query.trim().toLowerCase();
  const builtInItems: SidebarProvider[] = params.builtInProviders.map(provider => ({
    id: provider.id,
    name: provider.name,
    isCustom: false,
    enabled: params.isProviderEnabled(provider.id),
    searchText: `${provider.name} ${provider.id}`.toLowerCase(),
  }));
  const customItems: SidebarProvider[] = params.providers
    .filter(provider => !params.isCanonicalBuiltInConfig(provider))
    .map(provider => ({
      id: provider.id,
      name: getProviderDisplayName(provider),
      isCustom: true,
      icon: provider.icon,
      enabled: params.isProviderEnabled(provider.id),
      searchText: `${getProviderDisplayName(provider)} ${provider.type} ${provider.id}`.toLowerCase(),
    }));

  const matchesQuery = (provider: SidebarProvider) =>
    query.length === 0 || provider.searchText.includes(query);

  return [...builtInItems, ...customItems].filter(matchesQuery).sort((left, right) => {
    if (left.enabled !== right.enabled) {
      return left.enabled ? -1 : 1;
    }

    if (left.isCustom !== right.isCustom) {
      return left.isCustom ? 1 : -1;
    }

    if (!left.isCustom && !right.isCustom) {
      return (
        (BUILTIN_PROVIDER_ORDER.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (BUILTIN_PROVIDER_ORDER.get(right.id) ?? Number.MAX_SAFE_INTEGER)
      );
    }

    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
};

export const buildSelectedProviderInfo = (params: {
  builtInProviders: BuiltInProvider[];
  getPersistedProviderSnapshot: (providerId: string) => { models: string[] };
  providerId: string | null;
  providers: ProviderRecord[];
  selectedModels: Record<string, string[]>;
  t: TranslateFn;
}): BuiltInProvider | null => {
  if (!params.providerId) return null;

  const builtIn = params.builtInProviders.find(provider => provider.id === params.providerId);
  if (builtIn) {
    const selected =
      params.selectedModels[builtIn.id] || params.getPersistedProviderSnapshot(builtIn.id).models;
    const descriptionByProviderId: Record<string, string> = {
      openai: params.t('settings.providers.description.openai'),
      anthropic: params.t('settings.providers.description.anthropic'),
      deepseek: params.t('settings.providers.description.deepseek'),
      kimi: params.t('settings.providers.description.kimi'),
      minimax: params.t('settings.providers.description.minimax'),
      ollama: params.t('settings.providers.description.ollama'),
      acp: params.t('settings.providers.description.acp'),
    };
    return {
      ...builtIn,
      description: descriptionByProviderId[builtIn.id] || builtIn.description,
      models: selected,
    };
  }

  const custom = params.providers.find(provider => provider.id === params.providerId);
  if (custom) {
    const selected = params.selectedModels[custom.id] || parseModelList(custom.models);
    return {
      id: custom.id,
      name: getProviderDisplayName(custom),
      description: params.t('settings.providers.customDescription'),
      models: selected,
      defaultBaseUrl: custom.base_url,
    };
  }

  return null;
};

export const buildProviderSupportLink = (
  info: BuiltInProvider | null,
  t: TranslateFn
): ProviderSupportLink | null => {
  if (!info) return null;

  if (info.credentialsUrl) {
    return {
      prefix: t('settings.providers.support.credentialsPrefix'),
      url: info.credentialsUrl,
      label: info.credentialsLabel || info.name,
    };
  }

  if (info.docsUrl) {
    return {
      prefix: t('settings.providers.support.docsPrefix'),
      url: info.docsUrl,
      label: t('settings.providers.support.docsLabel', { name: info.name }),
    };
  }

  return null;
};

export const buildProviderBaseUrlHelp = (
  info: BuiltInProvider | null,
  acpProviderType: string,
  t: TranslateFn
) => {
  if (info?.id === acpProviderType) {
    return t('settings.providers.acp.baseUrlHelp');
  }
  if (!info?.defaultBaseUrl) {
    return t('settings.providers.baseUrlHelp.optionalOverride');
  }
  return t('settings.providers.baseUrlHelp.useDefault', { name: info.name });
};
