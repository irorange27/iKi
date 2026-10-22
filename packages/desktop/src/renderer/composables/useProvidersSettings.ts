import { computed, onMounted, ref } from 'vue';

import { useI18n } from '../i18n';
import type { BuiltInProvider } from '@iki/backend/types/settings';
import { BUILTIN_PROVIDERS } from '@iki/backend/constants/ProvidersSettings';
import { getErrorMessage } from '@iki/backend/utils/errors';
import {
  parseModelList,
  serializeProviderModelOptionsMap,
} from '@iki/backend/utils/provider_models';
import { createLogger } from '../logger';
import { useProviderDrafts, type ProviderRecord } from './useProviderDrafts';
import { useProvidersSettingsEditor } from './useProvidersSettingsEditor';
import { useProviderModelOptionsEditor } from './useProviderModelOptionsEditor';
import { confirmAction } from './useConfirm';
import { getElectronAPI } from '../services/electron_api';
import type {
  ProviderSupportLink,
  SidebarProvider,
} from '../components/settings/providers/provider_settings_shared';
import { arrayEquals } from '../components/settings/providers/provider_settings_shared';
import {
  buildProviderBaseUrlHelp,
  buildProviderSupportLink,
  buildSelectedProviderInfo,
  buildSidebarProviders,
} from '../components/settings/providers/provider_settings_derived';

export const useProvidersSettings = () => {
  const electronAPI = getElectronAPI();
  const providersSettingsLogger = createLogger({ module: 'providers_settings' });
  const { t } = useI18n();

  const providers = ref<ProviderRecord[]>([]);
  const providerSearchQuery = ref('');
  const selectedProviderId = ref<string | null>(null);
  const isFetchingModels = ref(false);
  const modelsPanelOpen = ref(false);

  const {
    dynamicModels,
    selectedModels,
    selectedProviderDraft,
    selectedProviderConfig,
    selectedProviderPersistedState,
    selectedDraftAvailableModels,
    selectedModelsList,
    getBuiltInProvider,
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
    addDynamicModel,
  } = useProviderDrafts({
    providers,
    selectedProviderId,
    builtInProviders: BUILTIN_PROVIDERS,
  });

  const loadProviders = async () => {
    providers.value = await electronAPI.providers.list();

    const selectionIsValid =
      selectedProviderId.value !== null &&
      (getBuiltInProvider(selectedProviderId.value) !== null ||
        providers.value.some(provider => provider.id === selectedProviderId.value));

    if (!selectionIsValid) {
      selectedProviderId.value = BUILTIN_PROVIDERS[0]?.id ?? providers.value[0]?.id ?? null;
    }

    if (selectedProviderId.value) {
      ensureProviderDraft(selectedProviderId.value);
    }
  };

  const {
    addCustomProvider,
    editingProvider,
    editingProviderApiFormat,
    providerTypeOptions,
    saveProvider,
    showProviderEditor,
    updateEditingProviderApiFormatSelection,
    updateEditingProviderTypeSelection,
  } = useProvidersSettingsEditor({
    providers,
    loadProviders,
  });

  const {
    closeModelOptionsEditor,
    modelOptionsEditor,
    openModelOptionsEditor,
    saveModelOptions,
  } = useProviderModelOptionsEditor({
    selectedProviderDraft,
    selectedProviderId,
  });

  const fetchLatestModels = async () => {
    if (!selectedProviderId.value) return;

    isFetchingModels.value = true;
    try {
      const draft = selectedProviderDraft.value;
      const config = selectedProviderConfig.value;
      const providerLookupKey = config?.type || selectedProviderId.value;

      const baseUrl = draft?.base_url.trim() || selectedProviderInfo.value?.defaultBaseUrl || '';
      const apiKey = draft?.api_key.trim() || '';
      const providerOverride =
        baseUrl || apiKey ? { base_url: baseUrl, ...(apiKey ? { api_key: apiKey } : {}) } : null;

      const fetched = await electronAPI.chat.getModels(
        providerLookupKey,
        config?.id,
        providerOverride
      );
      if (fetched && fetched.length > 0) {
        const modelIds = fetched.map(model => model.id);
        setFetchedModels(modelIds);
        if (config) {
          await electronAPI.providers.update(config.id, {
            available_models: JSON.stringify(modelIds),
          });
        }
      }
    } catch (error) {
      providersSettingsLogger.event({
        level: 'error',
        event: 'providers.models.fetch',
        outcome: 'failed',
        error,
        entity: {
          provider_id: selectedProviderId.value,
        },
      });
    } finally {
      isFetchingModels.value = false;
    }
  };

  const availableModelsList = computed(() => {
    if (!selectedProviderId.value) return [];

    const dynamic = dynamicModels.value[selectedProviderId.value];
    if (dynamic && dynamic.length > 0) return dynamic;

    const config = selectedProviderConfig.value;
    if (config?.available_models) {
      const available = parseModelList(config.available_models);
      if (available.length > 0) return available;
    }

    if (config?.models) {
      const models = parseModelList(config.models);
      if (models.length > 0) return models;
    }

    const builtIn = BUILTIN_PROVIDERS.find(provider => provider.id === selectedProviderId.value);
    return builtIn?.models || [];
  });

  const hasDynamicModels = computed(() => {
    if (!selectedProviderId.value) return false;
    return Boolean(dynamicModels.value[selectedProviderId.value]);
  });

  const addModel = (payload: { modelId: string; displayName: string }) => {
    const modelId = payload.modelId.trim();
    if (!modelId) return;

    addDynamicModel(modelId);

    const displayName = payload.displayName.trim();
    if (!displayName || !selectedProviderDraft.value) return;

    selectedProviderDraft.value.model_options = {
      ...selectedProviderDraft.value.model_options,
      [modelId]: {
        ...selectedProviderDraft.value.model_options[modelId],
        displayName,
      },
    };
  };

  const sidebarProviders = computed<SidebarProvider[]>(() => {
    return buildSidebarProviders({
      builtInProviders: BUILTIN_PROVIDERS,
      isCanonicalBuiltInConfig,
      isProviderEnabled,
      providers: providers.value,
      query: providerSearchQuery.value,
    });
  });

  const selectedProviderInfo = computed((): BuiltInProvider | null => {
    return buildSelectedProviderInfo({
      builtInProviders: BUILTIN_PROVIDERS,
      getPersistedProviderSnapshot,
      providerId: selectedProviderId.value,
      providers: providers.value,
      selectedModels: selectedModels.value,
      t,
    });
  });

  const selectedProviderRequiresApiKey = computed(() => {
    return selectedProviderInfo.value?.requiresApiKey !== false;
  });

  const selectedProviderSupportLink = computed<ProviderSupportLink | null>(() => {
    return buildProviderSupportLink(selectedProviderInfo.value, t);
  });

  const selectedProviderBaseUrlHelp = computed(() => {
    return buildProviderBaseUrlHelp(selectedProviderInfo.value, t);
  });

  const isSelectedProviderDirty = computed(() => {
    const draft = selectedProviderDraft.value;
    const snapshot = selectedProviderPersistedState.value;
    if (!draft || !snapshot) return false;

    return (
      draft.api_key !== snapshot.api_key ||
      draft.base_url.trim() !== snapshot.base_url ||
      draft.enabled !== snapshot.enabled ||
      !arrayEquals(selectedModelsList.value, snapshot.models) ||
      !arrayEquals(selectedDraftAvailableModels.value, snapshot.availableModels) ||
      serializeProviderModelOptionsMap(draft.model_options) !==
        serializeProviderModelOptionsMap(snapshot.modelOptions)
    );
  });

  const canSaveSelectedProvider = computed(() => {
    const draft = selectedProviderDraft.value;
    if (!draft || !selectedProviderInfo.value || !isSelectedProviderDirty.value) {
      return false;
    }

    if (draft.enabled && selectedProviderRequiresApiKey.value && draft.api_key.trim().length === 0) {
      return false;
    }

    return true;
  });

  const selectProvider = (providerId: string) => {
    selectedProviderId.value = providerId;
    modelsPanelOpen.value = false;
    closeModelOptionsEditor();
    ensureProviderDraft(providerId);
  };

  const toggleModelsPanel = () => {
    modelsPanelOpen.value = !modelsPanelOpen.value;

    if (
      modelsPanelOpen.value &&
      !isFetchingModels.value &&
      availableModelsList.value.length === 0
    ) {
      void fetchLatestModels();
    }
  };

  
  const flushPendingProviderDraft = async (): Promise<boolean> => {
    if (!isSelectedProviderDirty.value || !canSaveSelectedProvider.value) {
      return false;
    }

    await saveProviderConfig();
    return true;
  };

  const saveProviderConfig = async () => {
    if (!selectedProviderId.value || !selectedProviderInfo.value || !selectedProviderDraft.value) {
      return;
    }

    const activeProviderId = selectedProviderId.value;
    const existingConfig = selectedProviderConfig.value;
    const draft = selectedProviderDraft.value;
    const modelsToSave = selectedModels.value[activeProviderId] || [];
    const availableToSave = dynamicModels.value[activeProviderId] || [];
    const modelOptionModelIds = Array.from(new Set([...modelsToSave, ...availableToSave]));
    const modelOptionsToSave = serializeProviderModelOptionsMap(
      draft.model_options,
      modelOptionModelIds
    );
    const normalizedBaseUrl =
      draft.base_url.trim() || selectedProviderInfo.value.defaultBaseUrl || '';

    try {
      if (existingConfig) {
        await electronAPI.providers.update(existingConfig.id, {
          ...(selectedProviderId.value === existingConfig.id && existingConfig.type === 'anthropic'
            ? { type: 'anthropic-compatible' }
            : {}),
          api_key: draft.api_key.trim(),
          base_url: normalizedBaseUrl,
          enabled: draft.enabled,
          models: JSON.stringify(modelsToSave),
          model_options: modelOptionsToSave,
          available_models: JSON.stringify(availableToSave),
        });
      } else {
        const builtIn = selectedProviderInfo.value;
        const hasMeaningfulDraft =
          draft.api_key.trim().length > 0 ||
          draft.base_url.trim().length > 0 ||
          modelsToSave.length > 0 ||
          availableToSave.length > 0 ||
          draft.enabled;

        if (!hasMeaningfulDraft) {
          return;
        }

        const newProvider = {
          id: `${builtIn.id}_${Date.now()}`,
          name: builtIn.name,
          type: builtIn.id,
          api_key: draft.api_key.trim(),
          base_url: normalizedBaseUrl,
          models: JSON.stringify(modelsToSave),
          model_options: modelOptionsToSave,
          enabled: draft.enabled,
          available_models: JSON.stringify(availableToSave),
        };
        await electronAPI.providers.add(newProvider);
      }

      await loadProviders();
      syncProviderDraft(activeProviderId);
    } catch (error: unknown) {
      providersSettingsLogger.event({
        level: 'error',
        event: 'providers.config.save',
        outcome: 'failed',
        error,
        message: getErrorMessage(error),
        entity: {
          provider_id: activeProviderId,
        },
      });
    }
  };

  const removeProviderConfig = async () => {
    const config = selectedProviderConfig.value;
    if (!config) return;

    const confirmed = await confirmAction({
      message: t('settings.providers.confirmRemove'),
      danger: true,
    });
    if (!confirmed) return;

    await electronAPI.providers.delete(config.id);
    await loadProviders();
    resetSelectedProviderDraft();
  };

  onMounted(() => {
    void loadProviders();
  });

  return {
    addCustomProvider,
    addModel,
    availableModelsList,
    canSaveSelectedProvider,
    closeModelOptionsEditor,
    editingProvider,
    editingProviderApiFormat,
    fetchLatestModels,
    flushPendingProviderDraft,
    hasDynamicModels,
    isFetchingModels,
    isProviderConfigured,
    isSelectedProviderDirty,
    modelOptionsEditor,
    modelsPanelOpen,
    openModelOptionsEditor,
    providerSearchQuery,
    providerTypeOptions,
    removeProviderConfig,
    resetSelectedProviderDraft,
    saveModelOptions,
    saveProvider,
    saveProviderConfig,
    selectedModelsList,
    selectedProviderBaseUrlHelp,
    selectedProviderConfig,
    selectedProviderDraft,
    selectedProviderId,
    selectedProviderInfo,
    selectedProviderRequiresApiKey,
    selectedProviderSupportLink,
    selectProvider,
    setSelectedProviderEnabled,
    showProviderEditor,
    sidebarProviders,
    t,
    toggleModel,
    toggleModelsPanel,
    toggleSelectedProviderApiKeyVisibility,
    updateEditingProviderApiFormatSelection,
    updateEditingProviderTypeSelection,
  };
};
