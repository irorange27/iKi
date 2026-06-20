import { computed, onMounted, ref } from 'vue';

import { useI18n } from '../i18n';
import { ACP_PROVIDER_TYPE } from '@iki/backend/constants/acp';
import type { BuiltInProvider } from '@iki/backend/types/settings';
import type { ProviderModelDiscoveryOverride } from '@iki/backend/types/provider';
import type { McpServerSummary, McpTransport } from '@iki/backend/types/mcp';
import { BUILTIN_PROVIDERS } from '@iki/backend/constants/ProvidersSettings';
import { getErrorMessage } from '@iki/backend/utils/errors';
import {
  parseModelList,
  serializeProviderModelOptionsMap,
} from '@iki/backend/utils/provider_models';
import { createLogger } from '../logger';
import { getProviderDisplayName } from '../modules/providers/provider_display';
import { useProviderDrafts, type ProviderRecord } from './useProviderDrafts';
import { useProvidersSettingsEditor } from './useProvidersSettingsEditor';
import { useProviderModelOptionsEditor } from './useProviderModelOptionsEditor';
import { getElectronAPI, getElectronApiSliceMethod } from '../services/electron_api';
import type {
  AcpMcpServerEntry,
  ProviderSelectOption,
  ProviderSupportLink,
  SidebarProvider,
} from '../components/settings/providers/provider_settings_shared';
import {
  arrayEquals,
  arraySetEquals,
  normalizeSelectedAcpMcpServerIds,
} from '../components/settings/providers/provider_settings_shared';
import {
  buildProviderBaseUrlHelp,
  buildProviderSupportLink,
  buildSelectedProviderInfo,
  buildSidebarProviders,
} from '../components/settings/providers/provider_settings_derived';

export const useProvidersSettings = () => {
  const electronAPI = getElectronAPI();
  const listMcpServers = getElectronApiSliceMethod('mcp', 'list');
  const providersSettingsLogger = createLogger({ module: 'providers_settings' });
  const { t } = useI18n();

  const providers = ref<ProviderRecord[]>([]);
  const mcpServers = ref<McpServerSummary[]>([]);
  const mcpServersLoading = ref(false);
  const mcpServersError = ref('');
  const providerSearchQuery = ref('');
  const selectedProviderId = ref<string | null>(null);
  const isFetchingModels = ref(false);
  const isFetchingAcpAuthMethods = ref(false);
  const acpAuthMethods = ref<Array<{ id: string; name: string; description?: string | null; type: string; link?: string | null; vars?: Array<{ name: string; description?: string | null; secret?: boolean }> }>>([]);
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

  const buildSelectedAcpModelDiscoveryOverride = (): ProviderModelDiscoveryOverride | null => {
    const draft = selectedProviderDraft.value;
    if (!isSelectedAcpProvider.value || !draft) return null;

    const command = draft.acp_command.trim();
    if (!command) return null;

    const providerId = selectedProviderConfig.value?.id;

    return {
      ...(providerId ? { id: providerId } : {}),
      type: ACP_PROVIDER_TYPE,
      acp_command: command,
      acp_args: draft.acp_args.trim() || '',
      acp_mcp_server_ids:
        draft.acp_mcp_server_ids.length > 0 ? JSON.stringify(draft.acp_mcp_server_ids) : '',
      acp_auth_method_id: draft.acp_auth_method_id.trim() || '',
      acp_api_provider_id: draft.acp_api_provider_id.trim() || '',
    };
  };

  const fetchLatestModels = async () => {
    if (!selectedProviderId.value) return;

    isFetchingModels.value = true;
    try {
      const providerLookupKey = selectedProviderConfig.value?.type || selectedProviderId.value;
      const providerOverride = buildSelectedAcpModelDiscoveryOverride();
      const fetched = await electronAPI.chat.getModels(
        providerLookupKey,
        selectedProviderConfig.value?.id,
        providerOverride
      );
      if (fetched && fetched.length > 0) {
        const modelIds = fetched.map(model => model.id);
        setFetchedModels(modelIds);
        const config = selectedProviderConfig.value;
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

  const fetchAcpAuthMethods = async () => {
    if (!selectedProviderId.value) return;

    isFetchingAcpAuthMethods.value = true;
    try {
      const providerLookupKey = selectedProviderConfig.value?.type || selectedProviderId.value;
      const providerOverride = buildSelectedAcpModelDiscoveryOverride();
      const methods = await electronAPI.chat.getAcpAuthMethods(
        providerLookupKey,
        selectedProviderConfig.value?.id,
        providerOverride
      );
      acpAuthMethods.value = methods ?? [];
    } catch (error) {
      providersSettingsLogger.event({
        level: 'error',
        event: 'providers.acp.auth_methods.fetch',
        outcome: 'failed',
        error,
        entity: {
          provider_id: selectedProviderId.value,
        },
      });
      acpAuthMethods.value = [];
    } finally {
      isFetchingAcpAuthMethods.value = false;
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

  const formatMcpTransport = (transport: McpTransport): string =>
    transport === 'stdio'
      ? t('settings.mcp.transport.stdioShort')
      : transport === 'sse'
        ? 'SSE'
        : t('settings.mcp.transport.httpShort');

  const loadMcpServers = async () => {
    if (!listMcpServers) {
      mcpServers.value = [];
      mcpServersError.value = '';
      return;
    }

    mcpServersLoading.value = true;
    mcpServersError.value = '';
    try {
      const list = await listMcpServers();
      mcpServers.value = Array.isArray(list) ? list : [];
    } catch (error) {
      mcpServers.value = [];
      mcpServersError.value = t('settings.mcp.error.loadFailed', {
        error: getErrorMessage(error),
      });
    } finally {
      mcpServersLoading.value = false;
    }
  };

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

  const isSelectedAcpProvider = computed(() => selectedProviderInfo.value?.id === ACP_PROVIDER_TYPE);

  const acpCredentialProviderOptions = computed<ProviderSelectOption[]>(() => {
    const options: ProviderSelectOption[] = [
      {
        value: '',
        label: t('settings.providers.acp.apiProviderAuto'),
      },
    ];

    const currentProviderId = selectedProviderConfig.value?.id;
    for (const provider of providers.value) {
      if (!provider.enabled) continue;
      if (provider.type === ACP_PROVIDER_TYPE) continue;
      if (currentProviderId && provider.id === currentProviderId) continue;

      options.push({
        value: provider.id,
        label: `${getProviderDisplayName(provider)} (${provider.id})`,
      });
    }

    return options;
  });

  const acpMcpServerEntries = computed<AcpMcpServerEntry[]>(() => {
    const selectedIds = normalizeSelectedAcpMcpServerIds(
      selectedProviderDraft.value?.acp_mcp_server_ids ?? []
    );
    const knownById = new Map(mcpServers.value.map(server => [server.id, server]));
    const entries: AcpMcpServerEntry[] = [...mcpServers.value]
      .sort((left, right) => {
        if (left.enabled !== right.enabled) {
          return left.enabled ? -1 : 1;
        }
        return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
      })
      .map(server => ({
        id: server.id,
        name: server.name,
        meta: `${formatMcpTransport(server.transport)} · ${
          server.enabled
            ? t('settings.providers.acp.mcpServersEnabled')
            : t('settings.providers.acp.mcpServersDisabled')
        }`,
        enabled: server.enabled,
        missing: false,
      }));

    for (const serverId of selectedIds) {
      if (knownById.has(serverId)) continue;
      entries.push({
        id: serverId,
        name: t('settings.providers.acp.mcpServersMissingName', { id: serverId }),
        meta: t('settings.providers.acp.mcpServersMissing'),
        enabled: false,
        missing: true,
      });
    }

    return entries;
  });

  const selectedProviderSupportLink = computed<ProviderSupportLink | null>(() => {
    return buildProviderSupportLink(selectedProviderInfo.value, t);
  });

  const selectedProviderBaseUrlHelp = computed(() => {
    return buildProviderBaseUrlHelp(selectedProviderInfo.value, ACP_PROVIDER_TYPE, t);
  });

  const updateSelectedAcpApiProviderId = (providerId: string) => {
    if (!selectedProviderDraft.value) return;
    selectedProviderDraft.value.acp_api_provider_id = providerId;
  };

  const updateSelectedAcpAuthMethodId = (methodId: string) => {
    if (!selectedProviderDraft.value) return;
    selectedProviderDraft.value.acp_auth_method_id = methodId;
  };

  const toggleSelectedAcpMcpServer = (serverId: string, checked: boolean) => {
    if (!selectedProviderDraft.value) return;

    const next = new Set(selectedProviderDraft.value.acp_mcp_server_ids);
    if (checked) {
      next.add(serverId);
    } else {
      next.delete(serverId);
    }
    selectedProviderDraft.value.acp_mcp_server_ids = normalizeSelectedAcpMcpServerIds([...next]);
  };

  const isSelectedProviderDirty = computed(() => {
    const draft = selectedProviderDraft.value;
    const snapshot = selectedProviderPersistedState.value;
    if (!draft || !snapshot) return false;

    return (
      draft.api_key !== snapshot.api_key ||
      draft.base_url.trim() !== snapshot.base_url ||
      draft.acp_command.trim() !== snapshot.acp_command ||
      draft.acp_args.trim() !== snapshot.acp_args ||
      !arraySetEquals(draft.acp_mcp_server_ids, snapshot.acp_mcp_server_ids) ||
      draft.acp_auth_method_id.trim() !== snapshot.acp_auth_method_id ||
      draft.acp_api_provider_id.trim() !== snapshot.acp_api_provider_id ||
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

    if (draft.enabled && isSelectedAcpProvider.value && draft.acp_command.trim().length === 0) {
      return false;
    }

    return true;
  });

  const selectProvider = (providerId: string) => {
    selectedProviderId.value = providerId;
    modelsPanelOpen.value = false;
    closeModelOptionsEditor();
    ensureProviderDraft(providerId);

    if (providerId === ACP_PROVIDER_TYPE) {
      void loadMcpServers();
    }
  };

  const toggleModelsPanel = () => {
    modelsPanelOpen.value = !modelsPanelOpen.value;

    if (
      modelsPanelOpen.value &&
      isSelectedAcpProvider.value &&
      !isFetchingModels.value &&
      availableModelsList.value.length === 0 &&
      selectedProviderDraft.value?.acp_command.trim()
    ) {
      void fetchLatestModels();
    }
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
    const normalizedAcpMcpServerIds = normalizeSelectedAcpMcpServerIds(draft.acp_mcp_server_ids);
    const acpConfigPatch = isSelectedAcpProvider.value
      ? {
          acp_command: draft.acp_command.trim(),
          acp_args: draft.acp_args.trim() || null,
          acp_mcp_server_ids:
            normalizedAcpMcpServerIds.length > 0 ? JSON.stringify(normalizedAcpMcpServerIds) : null,
          acp_auth_method_id: draft.acp_auth_method_id.trim() || null,
          acp_api_provider_id: draft.acp_api_provider_id.trim() || null,
        }
      : {};

    try {
      if (existingConfig) {
        await electronAPI.providers.update(existingConfig.id, {
          ...(selectedProviderId.value === existingConfig.id && existingConfig.type === 'anthropic'
            ? { type: 'anthropic-compatible' }
            : {}),
          api_key: draft.api_key.trim(),
          base_url: normalizedBaseUrl,
          ...acpConfigPatch,
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
          draft.acp_command.trim().length > 0 ||
          draft.acp_args.trim().length > 0 ||
          normalizedAcpMcpServerIds.length > 0 ||
          draft.acp_auth_method_id.trim().length > 0 ||
          draft.acp_api_provider_id.trim().length > 0 ||
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
          ...acpConfigPatch,
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

    if (confirm(t('settings.providers.confirmRemove'))) {
      await electronAPI.providers.delete(config.id);
      await loadProviders();
      resetSelectedProviderDraft();
    }
  };

  onMounted(() => {
    void loadProviders();
    void loadMcpServers();
  });

  return {
    acpAuthMethods,
    acpCredentialProviderOptions,
    acpMcpServerEntries,
    addCustomProvider,
    addModel,
    availableModelsList,
    canSaveSelectedProvider,
    closeModelOptionsEditor,
    fetchAcpAuthMethods,
    editingProvider,
    editingProviderApiFormat,
    fetchLatestModels,
    hasDynamicModels,
    isFetchingAcpAuthMethods,
    isFetchingModels,
    isProviderConfigured,
    isSelectedAcpProvider,
    isSelectedProviderDirty,
    mcpServersError,
    mcpServersLoading,
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
    toggleSelectedAcpMcpServer,
    toggleSelectedProviderApiKeyVisibility,
    updateEditingProviderApiFormatSelection,
    updateEditingProviderTypeSelection,
    updateSelectedAcpApiProviderId,
    updateSelectedAcpAuthMethodId,
  };
};
