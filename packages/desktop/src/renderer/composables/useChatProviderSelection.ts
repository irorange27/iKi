import { computed, ref } from 'vue';

import type { ElectronApi } from '@iki/backend/types/electron_api';
import type {
  ModelCapabilitySnapshot,
  Provider,
  ProviderModelDescriptor,
} from '@iki/backend/types/provider';
import { ACP_PROVIDER_TYPE } from '@iki/backend/constants/acp';
import { createLogger } from '../logger';
import {
  getProviderModelOptions,
  normalizeModelCapabilityLimits,
  parseModelList,
  parseProviderModelOptionsMap,
} from '@iki/backend/utils/provider_models';
import { translate } from '../i18n';
import { getProviderDisplayName } from '../modules/providers/provider_display';

const providerSelectionLogger = createLogger({ module: 'chat_provider_selection' });

export const resolveProviderSelection = (params: {
  providers: Provider[];
  currentProvider: Provider | null;
  currentModel: string;
  preferredModel?: string | null;
  preferredProviderId?: string | null;
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
  const preferredProviderId =
    typeof params.preferredProviderId === 'string' ? params.preferredProviderId.trim() : '';
  const currentModel = params.currentModel.trim();
  const previousProviderId = params.currentProvider?.id;
  const previousProvider =
    availableProviders.find(provider => provider.id === previousProviderId) || null;
  const preferredProvider =
    preferredProviderId.length > 0
      ? availableProviders.find(provider => provider.id === preferredProviderId) || null
      : null;
  const previousProviderModels = previousProvider ? parseModelList(previousProvider.models) : [];
  const findProviderForModel = (model: string): Provider | null => {
    if (!model) return null;
    return (
      availableProviders.find(provider => parseModelList(provider.models).includes(model)) || null
    );
  };
  const selectedProvider =
    (preferredProvider && parseModelList(preferredProvider.models).length > 0
      ? preferredProvider
      : null) ||
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
  const preferredProviderId = ref<string | null>(null);
  const providerModelCatalog = ref<Record<string, ProviderModelDescriptor[]>>({});
  const providerModelLoads = new Map<string, Promise<void>>();

  const toCapabilitySnapshot = (
    descriptor: ProviderModelDescriptor | null | undefined
  ): ModelCapabilitySnapshot => {
    const limits = normalizeModelCapabilityLimits(descriptor);

    return {
      contextWindow: limits.contextWindow,
      maxInputTokens: limits.maxInputTokens,
      ...(limits.maxOutputTokens !== null ? { maxOutputTokens: limits.maxOutputTokens } : {}),
      ...(descriptor?.supportsVision != null ? { supportsVision: descriptor.supportsVision } : {}),
    };
  };

  const getStoredModelDescriptor = (
    provider: Provider | null,
    modelId: string
  ): ProviderModelDescriptor | null => {
    if (!provider) return null;
    const trimmedModelId = modelId.trim();
    if (!trimmedModelId) return null;

    const options = getProviderModelOptions(
      parseProviderModelOptionsMap(provider.model_options),
      trimmedModelId
    );
    if (!options) return null;

    return {
      id: trimmedModelId,
      displayName: options.displayName ?? trimmedModelId,
      contextWindow: options.contextWindow ?? null,
      maxInputTokens: options.maxInputTokens ?? options.contextWindow ?? null,
      maxOutputTokens: options.maxOutputTokens ?? null,
      ...(options.supportsToolCalls !== undefined
        ? { supportsToolCalls: options.supportsToolCalls ?? null }
        : {}),
      ...(options.supportsReasoning !== undefined
        ? { supportsReasoning: options.supportsReasoning ?? null }
        : {}),
      ...(options.supportsVision !== undefined ? { supportsVision: options.supportsVision ?? null } : {}),
      source: 'provider',
    };
  };

  const loadProviderModels = async (provider: Provider | null) => {
    if (!provider) return;

    const existingLoad = providerModelLoads.get(provider.id);
    if (existingLoad) {
      await existingLoad;
      return;
    }

    const loadPromise = (async () => {
      try {
        const descriptors = await deps.electronAPI.chat.getModels(provider.type, provider.id);
        providerModelCatalog.value = {
          ...providerModelCatalog.value,
          [provider.id]: Array.isArray(descriptors) ? descriptors : [],
        };
      } catch (error) {
        providerSelectionLogger.event({
          level: 'warn',
          event: 'chat.models.load',
          outcome: 'failed',
          error,
          entity: {
            provider_id: provider.id,
            provider_type: provider.type,
          },
        });
      } finally {
        providerModelLoads.delete(provider.id);
      }
    })();

    providerModelLoads.set(provider.id, loadPromise);
    await loadPromise;
  };

  const applyResolvedSelection = (
    preferredModel?: string | null,
    nextPreferredProviderId?: string | null
  ) => {
    const resolved = resolveProviderSelection({
      providers: availableProviders.value,
      currentProvider: selectedProvider.value,
      currentModel: selectedModel.value,
      preferredModel,
      preferredProviderId: nextPreferredProviderId ?? preferredProviderId.value,
    });

    availableProviders.value = resolved.availableProviders;
    selectedProvider.value = resolved.selectedProvider;
    selectedModel.value = resolved.selectedModel;
  };

  const selectedModelDescriptor = computed<ProviderModelDescriptor | null>(() => {
    const provider = selectedProvider.value;
    const modelId = selectedModel.value.trim();
    if (!provider || !modelId) return null;

    const fetchedModels = providerModelCatalog.value[provider.id];
    const fetchedModel = Array.isArray(fetchedModels)
      ? fetchedModels.find(model => model.id === modelId) || null
      : null;

    return fetchedModel || getStoredModelDescriptor(provider, modelId);
  });

  const selectedModelCapability = computed<ModelCapabilitySnapshot | null>(() => {
    const provider = selectedProvider.value;
    const modelId = selectedModel.value.trim();
    if (!provider || !modelId) return null;
    return toCapabilitySnapshot(selectedModelDescriptor.value);
  });

  const loadAvailableProviders = async (
    preferredModel?: string | null,
    nextPreferredProviderId?: string | null
  ) => {
    try {
      const providers = await deps.electronAPI.providers.list();
      availableProviders.value = Array.isArray(providers)
        ? providers.filter(provider => provider?.enabled)
        : [];
      if (nextPreferredProviderId !== undefined) {
        preferredProviderId.value = nextPreferredProviderId;
      }
      applyResolvedSelection(preferredModel, preferredProviderId.value);
      void loadProviderModels(selectedProvider.value);
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
      preferredProviderId.value = null;
      providerModelCatalog.value = {};
    }
  };

  const syncPreferredModel = (
    preferredModel?: string | null,
    nextPreferredProviderId?: string | null
  ) => {
    if (availableProviders.value.length === 0) return;
    if (nextPreferredProviderId !== undefined) {
      preferredProviderId.value = nextPreferredProviderId;
    }
    applyResolvedSelection(preferredModel, preferredProviderId.value);
  };

  const selectProviderModel = (payload: { provider: Provider; model: string }) => {
    selectedProvider.value = payload.provider;
    selectedModel.value = payload.model;
    preferredProviderId.value = payload.provider.id;
    void loadProviderModels(payload.provider);
  };

  const ensureProviderReady = async (): Promise<
    | {
        ok: true;
        provider: Provider;
        model: string;
        modelCapability?: ModelCapabilitySnapshot | null;
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
      configured = await deps.electronAPI.chat.isProviderConfigured(
        selectedProvider.value.type,
        selectedProvider.value.id
      );
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
        message:
          selectedProvider.value.type === ACP_PROVIDER_TYPE
            ? translate('chat.provider.configureCommand', { provider: selectedProviderName })
            : translate('chat.provider.configureApiKey', { provider: selectedProviderName }),
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
      modelCapability: selectedModelCapability.value,
    };
  };

  return {
    selectedProvider,
    selectedModel,
    selectedModelCapability,
    availableProviders,
    loadAvailableProviders,
    selectProviderModel,
    syncPreferredModel,
    ensureProviderReady,
  };
};
