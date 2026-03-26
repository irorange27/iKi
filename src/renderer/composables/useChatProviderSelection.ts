import { ref } from 'vue';

import type { ElectronApi } from '../../shared/types/electron_api';
import type { Provider } from '../../shared/types/provider';
import { createLogger } from '../logger';
import { parseModelList } from '../../shared/utils/provider_models';
import { translate } from '../i18n';
import { getProviderDisplayName } from '../modules/providers/provider_display';

const providerSelectionLogger = createLogger({ module: 'chat_provider_selection' });

export const resolveProviderSelection = (params: {
  providers: Provider[];
  currentProvider: Provider | null;
  currentModel: string;
  preferredModel?: string | null;
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

  const preferredModel =
    typeof params.preferredModel === 'string' ? params.preferredModel.trim() : '';
  const currentModel = params.currentModel.trim();
  const previousProviderId = params.currentProvider?.id;
  const previousProvider =
    availableProviders.find(provider => provider.id === previousProviderId) || null;
  const previousProviderModels = previousProvider ? parseModelList(previousProvider.models) : [];
  const findProviderForModel = (model: string): Provider | null => {
    if (!model) return null;
    return (
      availableProviders.find(provider => parseModelList(provider.models).includes(model)) || null
    );
  };
  const selectedProvider =
    (preferredModel && previousProviderModels.includes(preferredModel) ? previousProvider : null) ||
    findProviderForModel(preferredModel) ||
    (previousProvider && previousProviderModels.length > 0 ? previousProvider : null) ||
    availableProviders.find(provider => parseModelList(provider.models).length > 0) ||
    previousProvider ||
    availableProviders[0] ||
    null;
  const availableModels = selectedProvider ? parseModelList(selectedProvider.models) : [];
  const selectedModel =
    (preferredModel && availableModels.includes(preferredModel) ? preferredModel : '') ||
    (currentModel && availableModels.includes(currentModel) ? currentModel : '') ||
    availableModels[0] ||
    '';

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

  const applyResolvedSelection = (preferredModel?: string | null) => {
    const resolved = resolveProviderSelection({
      providers: availableProviders.value,
      currentProvider: selectedProvider.value,
      currentModel: selectedModel.value,
      preferredModel,
    });

    availableProviders.value = resolved.availableProviders;
    selectedProvider.value = resolved.selectedProvider;
    selectedModel.value = resolved.selectedModel;
  };

  const loadAvailableProviders = async (preferredModel?: string | null) => {
    try {
      const providers = await deps.electronAPI.providers.list();
      availableProviders.value = Array.isArray(providers)
        ? providers.filter(provider => provider?.enabled)
        : [];
      applyResolvedSelection(preferredModel);
    } catch (error) {
      providerSelectionLogger.event({
        level: 'error',
        event: 'chat.providers.load',
        outcome: 'failed',
        error,
      });
      availableProviders.value = [];
      selectedProvider.value = null;
      selectedModel.value = '';
    }
  };

  const syncPreferredModel = (preferredModel?: string | null) => {
    if (availableProviders.value.length === 0) return;
    applyResolvedSelection(preferredModel);
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
        message: translate('chat.provider.configureFirst'),
      };
    }

    const selectedProviderName = getProviderDisplayName(selectedProvider.value);
    let configured = false;
    try {
      configured = await deps.electronAPI.chat.isProviderConfigured(selectedProvider.value.type);
    } catch (error) {
      providerSelectionLogger.event({
        level: 'error',
        event: 'chat.provider.verify',
        outcome: 'failed',
        error,
        entity: {
          provider_type: selectedProvider.value.type,
          provider_id: selectedProvider.value.id,
        },
      });
      return {
        ok: false,
        message: translate('chat.provider.verifyFailed', { provider: selectedProviderName }),
      };
    }
    if (!configured) {
      return {
        ok: false,
        message: translate('chat.provider.configureApiKey', { provider: selectedProviderName }),
      };
    }

    if (!selectedModel.value.trim()) {
      return {
        ok: false,
        message: translate('chat.provider.modelRequired', { provider: selectedProviderName }),
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
    syncPreferredModel,
    ensureProviderReady,
  };
};
