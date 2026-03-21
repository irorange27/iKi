import { ref } from 'vue';

import type { ElectronApi } from '../../shared/types/electron_api';
import type { Provider } from '../../shared/types/provider';
import { parseModelList } from '../../shared/utils/provider_models';
import { getProviderDisplayName } from '../modules/providers/provider_display';

export const resolveProviderSelection = (params: {
  providers: Provider[];
  currentProvider: Provider | null;
  currentModel: string;
}): {
  availableProviders: Provider[];
  selectedProvider: Provider | null;
  selectedModel: string;
} => {
  const availableProviders = params.providers.filter(provider => provider?.enabled);
  if (availableProviders.length === 0) {
    return {
      availableProviders: [],
      selectedProvider: null,
      selectedModel: '',
    };
  }

  const previousProviderId = params.currentProvider?.id;
  const previousProvider =
    availableProviders.find(provider => provider.id === previousProviderId) || null;
  const previousProviderModels = previousProvider ? parseModelList(previousProvider.models) : [];
  const selectedProvider =
    (previousProvider && previousProviderModels.length > 0 ? previousProvider : null) ||
    availableProviders.find(provider => parseModelList(provider.models).length > 0) ||
    previousProvider ||
    availableProviders[0] ||
    null;
  const availableModels = selectedProvider ? parseModelList(selectedProvider.models) : [];
  const selectedModel = availableModels.includes(params.currentModel)
    ? params.currentModel
    : availableModels[0] || '';

  return {
    availableProviders,
    selectedProvider,
    selectedModel,
  };
};

export const useChatProviderSelection = (deps: {
  electronAPI: Pick<ElectronApi, 'chat' | 'providers'>;
}) => {
  const selectedProvider = ref<Provider | null>(null);
  const selectedModel = ref('');
  const availableProviders = ref<Provider[]>([]);

  const loadAvailableProviders = async () => {
    try {
      const providers = await deps.electronAPI.providers.list();
      const resolved = resolveProviderSelection({
        providers: Array.isArray(providers) ? providers : [],
        currentProvider: selectedProvider.value,
        currentModel: selectedModel.value,
      });

      availableProviders.value = resolved.availableProviders;
      selectedProvider.value = resolved.selectedProvider;
      selectedModel.value = resolved.selectedModel;
    } catch (error) {
      console.error('Failed to load providers:', error);
      availableProviders.value = [];
      selectedProvider.value = null;
      selectedModel.value = '';
    }
  };

  const selectProviderModel = (payload: { provider: Provider; model: string }) => {
    selectedProvider.value = payload.provider;
    selectedModel.value = payload.model;
  };

  const ensureProviderReady = async (): Promise<
    | {
        ok: true;
        provider: Provider;
        model: string;
      }
    | {
        ok: false;
        message: string;
      }
  > => {
    if (!selectedProvider.value) {
      return {
        ok: false,
        message: 'Please configure a provider in Settings first.',
      };
    }

    const selectedProviderName = getProviderDisplayName(selectedProvider.value);
    const configured = await deps.electronAPI.chat.isProviderConfigured(selectedProvider.value.type);
    if (!configured) {
      return {
        ok: false,
        message: `Please configure the ${selectedProviderName} API key in Settings.`,
      };
    }

    if (!selectedModel.value.trim()) {
      return {
        ok: false,
        message: `Please add at least one model for ${selectedProviderName} in Settings.`,
      };
    }

    return {
      ok: true,
      provider: selectedProvider.value,
      model: selectedModel.value,
    };
  };

  return {
    selectedProvider,
    selectedModel,
    availableProviders,
    loadAvailableProviders,
    selectProviderModel,
    ensureProviderReady,
  };
};
