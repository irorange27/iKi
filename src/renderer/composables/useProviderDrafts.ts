import { computed, ref, type Ref } from 'vue';

import type { Provider, ProviderModelOptionsMap } from '../../shared/types/provider';
import type { BuiltInProvider } from '../../shared/types/settings';
import { parseModelList, parseProviderModelOptionsMap } from '../../shared/utils/provider_models';
import { isCanonicalBuiltInProvider } from '../modules/providers/provider_icons';

const safeClone = <T>(value: T): T => {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
};

export type ProviderRecord = Provider & {
  icon?: string | null;
};

export type ProviderDraft = {
  api_key: string;
  base_url: string;
  acp_command: string;
  acp_args: string;
  acp_mcp_server_ids: string[];
  acp_auth_method_id: string;
  acp_api_provider_id: string;
  enabled: boolean;
  showApiKey: boolean;
  model_options: ProviderModelOptionsMap;
};

export type PersistedProviderSnapshot = {
  api_key: string;
  base_url: string;
  acp_command: string;
  acp_args: string;
  acp_mcp_server_ids: string[];
  acp_auth_method_id: string;
  acp_api_provider_id: string;
  enabled: boolean;
  models: string[];
  availableModels: string[];
  modelOptions: ProviderModelOptionsMap;
};

export const useProviderDrafts = (params: {
  providers: Ref<ProviderRecord[]>;
  selectedProviderId: Ref<string | null>;
  builtInProviders: BuiltInProvider[];
}) => {
  const providerDrafts = ref<Record<string, ProviderDraft>>({});
  const dynamicModels = ref<Record<string, string[]>>({});
  const selectedModels = ref<Record<string, string[]>>({});

  const getBuiltInProvider = (providerId: string | null): BuiltInProvider | null => {
    if (!providerId) return null;
    return params.builtInProviders.find(provider => provider.id === providerId) || null;
  };

  const isCanonicalBuiltInConfig = (provider: ProviderRecord, providerId?: string) => {
    if (!isCanonicalBuiltInProvider(provider)) {
      return false;
    }

    return providerId ? provider.type === providerId : true;
  };

  const getProviderRecord = (providerId: string | null): ProviderRecord | null => {
    if (!providerId) return null;

    if (getBuiltInProvider(providerId)) {
      return (
        params.providers.value.find(provider => isCanonicalBuiltInConfig(provider, providerId)) ||
        null
      );
    }

    return params.providers.value.find(provider => provider.id === providerId) || null;
  };

  const normalizeBaseUrlForDraft = (providerId: string, baseUrl?: string) => {
    const trimmed = typeof baseUrl === 'string' ? baseUrl.trim() : '';
    const builtIn = getBuiltInProvider(providerId);
    if (builtIn?.defaultBaseUrl && trimmed === builtIn.defaultBaseUrl) {
      return '';
    }
    return trimmed;
  };

  const normalizeSelectedIds = (value: unknown): string[] => {
    const seen = new Set<string>();

    return parseModelList(value).filter(entry => {
      if (seen.has(entry)) {
        return false;
      }
      seen.add(entry);
      return true;
    });
  };

  const getPersistedProviderSnapshot = (providerId: string): PersistedProviderSnapshot => {
    const record = getProviderRecord(providerId);

    return {
      api_key: record?.api_key ?? '',
      base_url: normalizeBaseUrlForDraft(providerId, record?.base_url),
      acp_command: record?.acp_command ?? '',
      acp_args: record?.acp_args ?? '',
      acp_mcp_server_ids: normalizeSelectedIds(record?.acp_mcp_server_ids),
      acp_auth_method_id: record?.acp_auth_method_id ?? '',
      acp_api_provider_id: record?.acp_api_provider_id ?? '',
      enabled: record?.enabled === true,
      models: parseModelList(record?.models),
      availableModels: parseModelList(record?.available_models),
      modelOptions: parseProviderModelOptionsMap(record?.model_options),
    };
  };

  const isProviderPersistedEnabled = (providerId: string) => {
    return getProviderRecord(providerId)?.enabled === true;
  };

  const syncProviderDraft = (providerId: string) => {
    const snapshot = getPersistedProviderSnapshot(providerId);

    providerDrafts.value[providerId] = {
      api_key: snapshot.api_key,
      base_url: snapshot.base_url,
      acp_command: snapshot.acp_command,
      acp_args: snapshot.acp_args,
      acp_mcp_server_ids: [...snapshot.acp_mcp_server_ids],
      acp_auth_method_id: snapshot.acp_auth_method_id,
      acp_api_provider_id: snapshot.acp_api_provider_id,
      enabled: snapshot.enabled,
      showApiKey: false,
      model_options: safeClone(snapshot.modelOptions),
    };
    selectedModels.value[providerId] = [...snapshot.models];

    if (snapshot.availableModels.length > 0) {
      dynamicModels.value[providerId] = [...snapshot.availableModels];
    } else {
      delete dynamicModels.value[providerId];
    }
  };

  const ensureProviderDraft = (providerId: string) => {
    if (!providerDrafts.value[providerId]) {
      syncProviderDraft(providerId);
    }
  };

  const selectedProviderDraft = computed(() => {
    const providerId = params.selectedProviderId.value;
    if (!providerId) return null;
    return providerDrafts.value[providerId] || null;
  });

  const selectedProviderConfig = computed(() => {
    const providerId = params.selectedProviderId.value;
    if (!providerId) return null;
    return getProviderRecord(providerId);
  });

  const selectedProviderPersistedState = computed(() => {
    const providerId = params.selectedProviderId.value;
    if (!providerId) return null;
    return getPersistedProviderSnapshot(providerId);
  });

  const selectedDraftAvailableModels = computed(() => {
    const providerId = params.selectedProviderId.value;
    if (!providerId) return [];
    return dynamicModels.value[providerId] || [];
  });

  const selectedModelsList = computed(() => {
    const providerId = params.selectedProviderId.value;
    if (!providerId) return [];
    return selectedModels.value[providerId] || [];
  });

  const isProviderConfigured = (providerId: string) => {
    return params.providers.value.some(provider => isCanonicalBuiltInConfig(provider, providerId));
  };

  const isProviderEnabled = (providerId: string) => {
    const draft = providerDrafts.value[providerId];
    if (draft) {
      return draft.enabled;
    }
    return isProviderPersistedEnabled(providerId);
  };

  const setSelectedProviderEnabled = (enabled: boolean) => {
    if (!selectedProviderDraft.value) return;
    selectedProviderDraft.value.enabled = enabled;
  };

  const toggleSelectedProviderApiKeyVisibility = () => {
    if (!selectedProviderDraft.value) return;
    selectedProviderDraft.value.showApiKey = !selectedProviderDraft.value.showApiKey;
  };

  const resetSelectedProviderDraft = () => {
    const providerId = params.selectedProviderId.value;
    if (!providerId) return;
    syncProviderDraft(providerId);
  };

  const setFetchedModels = (models: string[]) => {
    const providerId = params.selectedProviderId.value;
    if (!providerId) return;

    dynamicModels.value[providerId] = [...models];
    const currentSelected = selectedModels.value[providerId] || [];
    selectedModels.value[providerId] = currentSelected.filter(model => models.includes(model));
  };

  const toggleModel = (model: string) => {
    const providerId = params.selectedProviderId.value;
    if (!providerId) return;

    if (!selectedModels.value[providerId]) {
      selectedModels.value[providerId] = [];
    }

    const index = selectedModels.value[providerId].indexOf(model);
    if (index > -1) {
      selectedModels.value[providerId].splice(index, 1);
    } else {
      selectedModels.value[providerId].push(model);
    }
  };

  const selectAllModels = (models: string[]) => {
    const providerId = params.selectedProviderId.value;
    if (!providerId) return;
    selectedModels.value[providerId] = [...models];
  };

  const deselectAllModels = () => {
    const providerId = params.selectedProviderId.value;
    if (!providerId) return;
    selectedModels.value[providerId] = [];
  };

  const addDynamicModel = (model: string) => {
    const providerId = params.selectedProviderId.value;
    const trimmedModel = model.trim();
    if (!providerId || !trimmedModel) return;

    if (!dynamicModels.value[providerId]) {
      dynamicModels.value[providerId] = [];
    }
    if (!dynamicModels.value[providerId].includes(trimmedModel)) {
      dynamicModels.value[providerId].push(trimmedModel);
    }
  };

  return {
    providerDrafts,
    dynamicModels,
    selectedModels,
    selectedProviderDraft,
    selectedProviderConfig,
    selectedProviderPersistedState,
    selectedDraftAvailableModels,
    selectedModelsList,
    getBuiltInProvider,
    getProviderRecord,
    getPersistedProviderSnapshot,
    ensureProviderDraft,
    syncProviderDraft,
    resetSelectedProviderDraft,
    isCanonicalBuiltInConfig,
    isProviderConfigured,
    isProviderEnabled,
    setSelectedProviderEnabled,
    toggleSelectedProviderApiKeyVisibility,
    setFetchedModels,
    toggleModel,
    selectAllModels,
    deselectAllModels,
    addDynamicModel,
  };
};
