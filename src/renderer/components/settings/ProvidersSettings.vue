<template>
  <!-- Providers -->
  <section class="config-section providers-section">
    <div class="providers-toolbar">
      <div class="providers-search">
        <input
          type="text"
          v-model="providerSearchQuery"
          :placeholder="t('settings.providers.searchPlaceholder')"
          class="search-input"
        />
      </div>

      <div class="providers-actions">
        <button class="action-btn secondary-btn" @click="addCustomProvider">
          <span>+</span> {{ t('settings.providers.addCustom') }}
        </button>
      </div>
    </div>

    <div class="providers-layout">
      <!-- Left Panel: Provider List -->
      <div class="providers-sidebar">
        <div class="providers-scroll-list">
          <div class="providers-scroll-list-inner">
            <div
              v-for="provider in sidebarProviders"
              :key="provider.id"
              class="provider-list-item"
              :class="{
                active: selectedProviderId === provider.id,
                configured: !provider.isCustom && isProviderConfigured(provider.id),
                custom: provider.isCustom,
              }"
              @click="selectProvider(provider.id)"
            >
              <span class="provider-icon">
                <LobeIcon
                  v-if="!provider.isCustom"
                  :name="getProviderIconName(provider.id)"
                  :size="24"
                />
                <LobeIcon v-else v-bind="getCustomProviderIconProps(provider.icon)" :size="20" />
              </span>
              <div class="provider-item-main">
                <span class="provider-item-name">{{ provider.name }}</span>
                <span v-if="provider.isCustom" class="provider-item-badge">
                  {{ t('settings.providers.customBadge') }}
                </span>
              </div>
              <span
                class="provider-status-dot"
                :class="{ enabled: isProviderEnabled(provider.id) }"
              ></span>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Panel: Provider Details -->
      <div class="provider-details-panel">
        <template v-if="selectedProviderInfo && selectedProviderDraft">
          <div class="provider-header provider-card-header">
            <div class="provider-heading">
              <div class="provider-title-row">
                <h3>{{ selectedProviderInfo.name }}</h3>
                <span class="status-badge" :class="{ enabled: selectedProviderDraft.enabled }">
                  {{ selectedProviderDraft.enabled ? t('common.active') : t('common.inactive') }}
                </span>
              </div>
              <p class="provider-description">
                {{ selectedProviderInfo.description }}
              </p>
            </div>

            <div class="provider-header-actions">
              <a
                v-if="selectedProviderInfo.docsUrl"
                :href="selectedProviderInfo.docsUrl"
                target="_blank"
                rel="noreferrer"
                class="provider-icon-button"
                :aria-label="t('settings.providers.docsAria')"
              >
                <BookOpen :size="16" />
              </a>

              <label class="provider-switch" :aria-label="t('settings.providers.enableAria')">
                <input
                  type="checkbox"
                  :checked="selectedProviderDraft.enabled"
                  @change="setSelectedProviderEnabled(($event.target as HTMLInputElement).checked)"
                />
                <span class="provider-switch-track">
                  <span class="provider-switch-thumb"></span>
                </span>
              </label>
            </div>
          </div>

          <div class="provider-config-form">
            <div class="provider-config-group provider-form-stack">
              <div class="provider-field">
                <label class="input-label provider-field-label">
                  <span class="provider-field-title">{{ t('settings.providers.apiKey') }}</span>
                  <div class="provider-secret-input">
                    <input
                      :type="selectedProviderDraft.showApiKey ? 'text' : 'password'"
                      v-model="selectedProviderDraft.api_key"
                      :placeholder="t('settings.providers.apiKeyPlaceholder')"
                    />
                    <button
                      type="button"
                      class="provider-secret-toggle"
                      @click="toggleSelectedProviderApiKeyVisibility"
                    >
                      <EyeOff v-if="selectedProviderDraft.showApiKey" :size="18" />
                      <Eye v-else :size="18" />
                    </button>
                  </div>
                </label>
                <p v-if="selectedProviderSupportLink" class="provider-field-help">
                  {{ selectedProviderSupportLink.prefix }}
                  <a
                    :href="selectedProviderSupportLink.url"
                    target="_blank"
                    rel="noreferrer"
                    class="provider-inline-link"
                  >
                    {{ selectedProviderSupportLink.label }}
                    <ExternalLink :size="14" />
                  </a>
                </p>
                <p v-else-if="!selectedProviderRequiresApiKey" class="provider-field-help">
                  {{ t('settings.providers.noApiKeyRequired') }}
                </p>
              </div>

              <div class="provider-field">
                <label class="input-label provider-field-label">
                  <span class="provider-field-title">{{
                    t('settings.providers.baseUrlOptional')
                  }}</span>
                  <input
                    type="text"
                    v-model="selectedProviderDraft.base_url"
                    :placeholder="
                      selectedProviderInfo.defaultBaseUrl || 'https://api.example.com/v1'
                    "
                  />
                </label>
                <p class="provider-field-help">
                  {{ selectedProviderBaseUrlHelp }}
                </p>
              </div>

              <ProviderModelsPanel
                :open="modelsPanelOpen"
                :is-fetching-models="isFetchingModels"
                :available-models="availableModelsList"
                :selected-models="selectedModelsList"
                :fallback-models="selectedProviderInfo.models"
                :model-options="selectedProviderDraft.model_options"
                :has-dynamic-models="Boolean(dynamicModels[selectedProviderId!])"
                @toggle-open="modelsPanelOpen = !modelsPanelOpen"
                @fetch-models="fetchLatestModels"
                @toggle-model="toggleModel"
                @select-all="selectAllModels(availableModelsList)"
                @deselect-all="deselectAllModels"
                @edit-model-options="openModelOptionsEditor"
                @add-model="addModel"
              />
            </div>

            <div class="provider-card-actions">
              <button
                v-if="selectedProviderConfig"
                class="danger-btn"
                @click="removeProviderConfig"
              >
                {{ t('common.delete') }}
              </button>
              <button
                class="secondary-btn"
                @click="resetSelectedProviderDraft"
                :disabled="!isSelectedProviderDirty"
              >
                {{ t('common.cancel') }}
              </button>
              <button
                class="primary-btn"
                @click="saveProviderConfig"
                :disabled="!canSaveSelectedProvider"
              >
                {{ t('common.save') }}
              </button>
            </div>
          </div>
        </template>

        <div v-else class="no-selection">
          <p>{{ t('settings.providers.noSelection') }}</p>
        </div>
      </div>
    </div>

    <!-- Custom Provider Editor Modal -->
    <div v-if="showProviderEditor" class="modal-overlay">
      <div class="modal-content provider-editor">
        <div class="provider-editor-header">
          <h3>
            {{
              editingProvider?.id?.startsWith('custom_')
                ? t('settings.providers.modal.edit')
                : t('settings.providers.modal.add')
            }}
            {{ t('settings.providers.modal.titleSuffix') }}
          </h3>
        </div>

        <div class="provider-editor-scroll">
          <div class="provider-config-group">
            <label class="input-label"
              >{{ t('common.name') }}
              <input
                type="text"
                v-model="editingProvider.name"
                :placeholder="t('settings.providers.modal.namePlaceholder')"
              />
            </label>

            <label class="input-label"
              >{{ t('common.type') }}
              <SettingsSelect
                :model-value="editingProvider.type"
                :options="providerTypeOptions"
                :aria-label="t('settings.providers.modal.typeAria')"
                @update:model-value="updateEditingProviderTypeSelection"
              />
            </label>

            <div v-if="editingProviderApiFormat" class="provider-field provider-format-section">
              <span class="provider-field-title">
                {{ t('settings.providers.modal.apiFormat') }}
              </span>
              <SettingsSelect
                class="provider-format-select"
                :model-value="editingProviderApiFormat.value"
                :options="editingProviderApiFormat.options"
                :disabled="editingProviderApiFormat.locked"
                :aria-label="t('settings.providers.modal.apiFormatAria')"
                @update:model-value="updateEditingProviderApiFormatSelection"
              />
              <div class="provider-format-card">
                <span class="provider-format-endpoint">{{
                  editingProviderApiFormat.endpoint
                }}</span>
                <p class="provider-field-help">
                  {{ editingProviderApiFormat.description }}
                </p>
                <p class="provider-field-help provider-format-note">
                  {{ editingProviderApiFormat.note }}
                </p>
              </div>
            </div>

            <label class="input-label"
              >{{ t('settings.providers.apiKey') }}
              <input
                type="password"
                v-model="editingProvider.api_key"
                :placeholder="t('settings.providers.modal.apiKeyPlaceholder')"
              />
            </label>

            <label class="input-label"
              >{{ t('settings.providers.modal.baseUrl') }}
              <input
                type="text"
                v-model="editingProvider.base_url"
                :placeholder="t('settings.providers.modal.baseUrlPlaceholder')"
              />
            </label>

            <label class="input-label"
              >{{ t('settings.providers.modal.models') }}
              <input
                type="text"
                v-model="editingProvider.models"
                :placeholder="t('settings.providers.modal.modelsPlaceholder')"
              />
            </label>
          </div>
        </div>

        <div class="modal-footer provider-editor-footer">
          <button class="secondary-btn" @click="showProviderEditor = false">
            {{ t('common.cancel') }}
          </button>
          <button class="primary-btn" @click="saveProvider">
            {{ t('settings.providers.modal.save') }}
          </button>
        </div>
      </div>
    </div>

    <ProviderModelOptionsModal
      v-if="modelOptionsEditor && selectedProviderDraft"
      :provider-id="modelOptionsEditor.providerId"
      :model-id="modelOptionsEditor.modelId"
      :model-options="selectedProviderDraft.model_options[modelOptionsEditor.modelId] || null"
      @cancel="closeModelOptionsEditor"
      @save="saveModelOptions"
    />
  </section>
</template>

<script setup lang="ts">
// Provider Management Logic
import { ref, computed, onMounted } from 'vue';
import LobeIcon from '../../components/Icon/LobeIcon.vue';
import { BookOpen, ExternalLink, Eye, EyeOff } from 'lucide-vue-next';
import SettingsSelect from './SettingsSelect.vue';
import ProviderModelOptionsModal from './providers/ProviderModelOptionsModal.vue';
import ProviderModelsPanel from './providers/ProviderModelsPanel.vue';
import { useI18n } from '../../i18n';
import type { BuiltInProvider } from '../../../shared/types/settings';
import type { ProviderModelOptions } from '../../../shared/types/provider';
import { BUILTIN_PROVIDERS } from '../../../shared/constants/ProvidersSettings';
import { getErrorMessage } from '../../../shared/utils/errors';
import {
  parseModelList,
  serializeProviderModelOptionsMap,
} from '../../../shared/utils/provider_models';
import { createLogger } from '../../logger';
import {
  getCustomProviderIconProps,
  getProviderIconName,
} from '../../modules/providers/provider_icons';
import { useProviderDrafts, type ProviderRecord } from '../../composables/useProviderDrafts';
import { getElectronAPI } from '../../services/electron_api';

type EditableProvider = Pick<
  ProviderRecord,
  'id' | 'name' | 'type' | 'api_key' | 'base_url' | 'enabled' | 'icon' | 'is_response_api'
> & {
  models: string;
  available_models: string;
};

type EditableProviderApiFormat = {
  value: 'chat-completions' | 'responses' | 'messages';
  options: Array<{ value: 'chat-completions' | 'responses' | 'messages'; label: string }>;
  endpoint: string;
  description: string;
  note: string;
  locked: boolean;
};

type SidebarProvider = {
  id: string;
  name: string;
  isCustom: boolean;
  icon?: string | null;
  enabled: boolean;
  searchText: string;
};

type ActiveModelOptionsEditor = {
  providerId: string;
  modelId: string;
};

const electronAPI = getElectronAPI();
const providersSettingsLogger = createLogger({ module: 'providers_settings' });
const { t } = useI18n();

const providers = ref<ProviderRecord[]>([]);
const editingProvider = ref<EditableProvider | null>(null);
const showProviderEditor = ref(false);

const providerSearchQuery = ref('');
const selectedProviderId = ref<string | null>(null);
const isFetchingModels = ref(false);
const modelsPanelOpen = ref(false);
const modelOptionsEditor = ref<ActiveModelOptionsEditor | null>(null);

const providerTypeOptions = computed(() => [
  { value: 'openai-compatible', label: t('settings.providers.type.openaiCompatible') },
  { value: 'anthropic-compatible', label: t('settings.providers.type.anthropicCompatible') },
  { value: 'google', label: t('settings.providers.type.googleGemini') },
  { value: 'ollama', label: 'Ollama' },
  { value: 'custom', label: t('common.custom') },
]);

const editingProviderApiFormat = computed<EditableProviderApiFormat | null>(() => {
  const providerType = editingProvider.value?.type?.trim();
  if (!providerType) return null;

  if (providerType === 'anthropic-compatible') {
    return {
      value: 'messages',
      options: [
        {
          value: 'messages',
          label: t('settings.providers.modal.apiFormat.messages'),
        },
      ],
      endpoint: t('settings.providers.modal.apiFormat.messages'),
      description: t('settings.providers.modal.apiFormat.anthropicDescription'),
      note: t('settings.providers.modal.apiFormat.anthropicAdapter'),
      locked: true,
    };
  }

  const isResponseApi = editingProvider.value?.is_response_api === true;
  const usesOpenAICompatibleType = providerType === 'openai-compatible';
  const value = isResponseApi ? 'responses' : 'chat-completions';
  const options = [
    {
      value: 'chat-completions' as const,
      label: t('settings.providers.modal.apiFormat.chatCompletions'),
    },
    {
      value: 'responses' as const,
      label: t('settings.providers.modal.apiFormat.responses'),
    },
  ];

  if (isResponseApi) {
    return {
      value,
      options,
      endpoint: t('settings.providers.modal.apiFormat.responses'),
      description: t('settings.providers.modal.apiFormat.responsesDescription'),
      note: t('settings.providers.modal.apiFormat.responsesAdapter'),
      locked: false,
    };
  }

  return {
    value,
    options,
    endpoint: t('settings.providers.modal.apiFormat.chatCompletions'),
    description: usesOpenAICompatibleType
      ? t('settings.providers.modal.apiFormat.openaiDescription')
      : t('settings.providers.modal.apiFormat.defaultDescription'),
    note: usesOpenAICompatibleType
      ? t('settings.providers.modal.apiFormat.chatCompletionsAdapter')
      : t('settings.providers.modal.apiFormat.defaultAdapter'),
    locked: false,
  };
});

const BUILTIN_PROVIDER_ORDER = new Map(
  BUILTIN_PROVIDERS.map((provider, index) => [provider.id, index])
);

const arrayEquals = (left: string[], right: string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

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
  selectAllModels,
  deselectAllModels,
  addDynamicModel,
} = useProviderDrafts({
  providers,
  selectedProviderId,
  builtInProviders: BUILTIN_PROVIDERS,
});

const openModelOptionsEditor = (modelId: string) => {
  if (!selectedProviderId.value || !selectedProviderDraft.value) return;

  modelOptionsEditor.value = {
    providerId: selectedProviderId.value,
    modelId,
  };
};

const closeModelOptionsEditor = () => {
  modelOptionsEditor.value = null;
};

const saveModelOptions = (payload: {
  providerId: string;
  modelId: string;
  options: ProviderModelOptions | null;
}) => {
  if (!selectedProviderDraft.value || selectedProviderId.value !== payload.providerId) return;

  const nextModelOptions = {
    ...selectedProviderDraft.value.model_options,
  };

  if (payload.options) {
    nextModelOptions[payload.modelId] = payload.options;
  } else {
    delete nextModelOptions[payload.modelId];
  }

  selectedProviderDraft.value.model_options = nextModelOptions;
  closeModelOptionsEditor();
};

const fetchLatestModels = async () => {
  if (!selectedProviderId.value) return;

  isFetchingModels.value = true;
  try {
    const providerLookupKey = selectedProviderConfig.value?.type || selectedProviderId.value;
    const fetched = await electronAPI.chat.getModels(providerLookupKey);
    if (fetched && fetched.length > 0) {
      setFetchedModels(fetched);
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

  const builtIn = BUILTIN_PROVIDERS.find(p => p.id === selectedProviderId.value);
  return builtIn?.models || [];
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

const addModel = () => {
  const model = prompt(t('settings.providers.promptModelName'));
  if (model) {
    addDynamicModel(model);
  }
};

const sidebarProviders = computed<SidebarProvider[]>(() => {
  const query = providerSearchQuery.value.trim().toLowerCase();
  const builtInItems: SidebarProvider[] = BUILTIN_PROVIDERS.map(provider => ({
    id: provider.id,
    name: provider.name,
    isCustom: false,
    enabled: isProviderEnabled(provider.id),
    searchText: `${provider.name} ${provider.id}`.toLowerCase(),
  }));
  const customItems: SidebarProvider[] = providers.value
    .filter(provider => !isCanonicalBuiltInConfig(provider))
    .map(provider => ({
      id: provider.id,
      name: provider.name,
      isCustom: true,
      icon: provider.icon,
      enabled: isProviderEnabled(provider.id),
      searchText: `${provider.name} ${provider.type} ${provider.id}`.toLowerCase(),
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
});

const selectedProviderInfo = computed((): BuiltInProvider | null => {
  if (!selectedProviderId.value) return null;

  const builtIn = BUILTIN_PROVIDERS.find(p => p.id === selectedProviderId.value);
  if (builtIn) {
    const selected =
      selectedModels.value[builtIn.id] || getPersistedProviderSnapshot(builtIn.id).models;
    const descriptionByProviderId: Record<string, string> = {
      openai: t('settings.providers.description.openai'),
      anthropic: t('settings.providers.description.anthropic'),
      deepseek: t('settings.providers.description.deepseek'),
      kimi: t('settings.providers.description.kimi'),
      minimax: t('settings.providers.description.minimax'),
      ollama: t('settings.providers.description.ollama'),
    };
    return {
      ...builtIn,
      description: descriptionByProviderId[builtIn.id] || builtIn.description,
      models: selected,
    };
  }

  const custom = providers.value.find(p => p.id === selectedProviderId.value);
  if (custom) {
    const selected = selectedModels.value[custom.id] || parseModelList(custom.models);
    return {
      id: custom.id,
      name: custom.name,
      description: t('settings.providers.customDescription'),
      models: selected,
      defaultBaseUrl: custom.base_url,
    };
  }

  return null;
});

const selectedProviderRequiresApiKey = computed(() => {
  return selectedProviderInfo.value?.requiresApiKey !== false;
});

const selectedProviderSupportLink = computed(() => {
  const info = selectedProviderInfo.value;
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
});

const selectedProviderBaseUrlHelp = computed(() => {
  const info = selectedProviderInfo.value;
  if (!info?.defaultBaseUrl) {
    return t('settings.providers.baseUrlHelp.optionalOverride');
  }
  return t('settings.providers.baseUrlHelp.useDefault', { name: info.name });
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

  if (confirm(t('settings.providers.confirmRemove'))) {
    await electronAPI.providers.delete(config.id);
    await loadProviders();
    resetSelectedProviderDraft();
  }
};

const addCustomProvider = () => {
  editingProvider.value = {
    id: `custom_${Date.now()}`,
    name: '',
    type: 'custom',
    api_key: '',
    models: '',
    base_url: '',
    enabled: true,
    is_response_api: false,
    available_models: '[]',
  };
  showProviderEditor.value = true;
};

const updateEditingProviderTypeSelection = (value: string) => {
  if (!editingProvider.value) return;
  editingProvider.value.type = value;
  if (value === 'anthropic-compatible') {
    editingProvider.value.is_response_api = false;
  }
};

const updateEditingProviderApiFormatSelection = (value: string) => {
  if (!editingProvider.value) return;
  editingProvider.value.is_response_api = value === 'responses';
};

const saveProvider = async () => {
  if (!editingProvider.value) return;

  // Convert comma-separated models to JSON array
  const modelsInput = editingProvider.value.models;
  const modelsArray =
    typeof modelsInput === 'string' && modelsInput.includes(',')
      ? modelsInput
          .split(',')
          .map((m: string) => m.trim())
          .filter(Boolean)
      : modelsInput
        ? [modelsInput]
        : [];

  const providerData = {
    ...editingProvider.value,
    models: JSON.stringify(modelsArray),
    available_models: JSON.stringify(modelsArray),
    is_response_api:
      editingProvider.value.type === 'anthropic-compatible'
        ? false
        : editingProvider.value.is_response_api === true,
  };

  if (providers.value.some(p => p.id === editingProvider.value.id)) {
    await electronAPI.providers.update(editingProvider.value.id, providerData);
  } else {
    await electronAPI.providers.add(providerData);
  }

  showProviderEditor.value = false;
  editingProvider.value = null;
  await loadProviders();
};

onMounted(() => {
  void loadProviders();
});
</script>

<style scoped src="./settings_shared.css"></style>

<style scoped>
.action-btn {
  padding: 10px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.2s;
}

.config-section {
  max-width: 600px;
}

.provider-config-group {
  margin-bottom: 32px;
}

.providers-section {
  max-width: none !important;
}

.providers-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.providers-layout {
  display: flex;
  gap: 16px;
  min-height: 460px;
}

.providers-sidebar {
  width: 240px;
  flex-shrink: 0;
}

.providers-search {
  flex: 1;
  max-width: 400px;
}

.providers-search .search-input {
  width: 100%;
  padding: 9px 13px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 14px;
  min-height: 46px;
}

.providers-search .search-input:focus {
  outline: none;
  border-color: var(--accent-color);
}

.providers-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.providers-scroll-list {
  height: 100%;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-radius: var(--surface-radius);
  background: color-mix(in srgb, var(--bg-tertiary) 88%, var(--bg-secondary));
  padding: 12px;
  box-shadow: var(--surface-inset-highlight);
}

.providers-scroll-list-inner {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 100%;
}

.provider-list-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: 12px;
  cursor: pointer;
  transition:
    background 0.2s,
    border-color 0.2s,
    box-shadow 0.2s,
    transform 0.2s;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
}

.provider-list-item:hover {
  background: var(--bg-hover);
  border-color: color-mix(in srgb, var(--accent-color) 30%, var(--border-color));
}

.provider-list-item.active {
  background: color-mix(in srgb, var(--accent-color) 12%, var(--bg-tertiary));
  border-color: var(--accent-color);
  box-shadow: 0 0 0 1px var(--accent-color);
}

.provider-list-item.configured {
  opacity: 1;
}

.provider-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  flex-shrink: 0;
  transition:
    border-color 0.2s ease,
    background 0.2s ease;
}

.provider-icon :deep(.lobe-icon) {
  filter: grayscale(1) brightness(1.4);
  opacity: 0.75;
}

.provider-item-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.provider-item-name {
  font-weight: 500;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-item-badge {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 999px;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--border-color) 30%, var(--bg-tertiary));
  border: 1px solid var(--border-color);
  flex-shrink: 0;
}

.provider-status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--border-color) 82%, var(--bg-secondary));
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.provider-status-dot.enabled {
  background: var(--status-success-color);
}

.providers-divider {
  padding: 8px 6px 2px;
  font-size: 12px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Provider Details Panel */
.provider-details-panel {
  flex: 1;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: var(--surface-radius);
  padding: 20px 22px;
  box-shadow: var(--surface-shadow-md);
}

.provider-header {
  margin-bottom: 16px;
}

.provider-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.provider-heading {
  min-width: 0;
}

.provider-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.provider-title-row h3 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.provider-description {
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.4;
}

.provider-header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.provider-icon-button {
  width: 42px;
  height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  text-decoration: none;
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    color 0.2s ease;
}

.provider-icon-button:hover {
  border-color: var(--accent-color);
  color: var(--accent-color);
  background: var(--bg-hover);
}

.provider-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
}

.provider-switch input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.provider-switch-track {
  width: 56px;
  height: 32px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--border-color) 70%, var(--bg-secondary));
  border: 1px solid var(--border-color);
  display: inline-flex;
  align-items: center;
  padding: 3px;
  transition:
    background 0.2s ease,
    border-color 0.2s ease;
}

.provider-switch-thumb {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--bg-primary);
  box-shadow: var(--surface-shadow-sm);
  transition: transform 0.2s ease;
}

.provider-switch input:checked + .provider-switch-track {
  background: color-mix(in srgb, var(--accent-color) 44%, var(--bg-secondary));
  border-color: color-mix(in srgb, var(--accent-color) 60%, transparent);
}

.provider-switch input:checked + .provider-switch-track .provider-switch-thumb {
  transform: translateX(24px);
}

.provider-config-form {
  margin-top: 16px;
}

.provider-card-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 18px;
}

.provider-form-stack {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.provider-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.provider-field-label {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.provider-field-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
}

.provider-secret-input {
  display: flex;
  align-items: center;
  gap: 8px;
}

.provider-secret-input input {
  flex: 1;
}

.provider-secret-toggle {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    color 0.2s ease,
    background 0.2s ease;
}

.provider-secret-toggle:hover {
  border-color: var(--accent-color);
  color: var(--accent-color);
  background: var(--bg-hover);
}

.provider-field-help {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.provider-format-section {
  gap: 10px;
}

.provider-format-select {
  width: 100%;
}

.provider-format-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, rgba(var(--accent-rgb), 0.34) 40%, var(--border-color));
  background: linear-gradient(
    180deg,
    rgba(var(--accent-rgb), 0.08) 0%,
    color-mix(in srgb, var(--bg-secondary) 92%, transparent) 100%
  );
}

.provider-format-endpoint {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(var(--accent-rgb), 0.14);
  border: 1px solid rgba(var(--accent-rgb), 0.28);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.provider-format-note {
  color: var(--text-secondary);
}

.provider-inline-link {
  display: flex;
  width: fit-content;
  align-items: center;
  gap: 6px;
  color: var(--accent-color);
  text-decoration: none;
  margin-top: 6px;
}

.provider-inline-link:hover {
  text-decoration: none;
  color: color-mix(in srgb, var(--accent-color) 82%, white);
}

.no-selection {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
}

.provider-main {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 4px;
}

.provider-name {
  font-weight: 600;
  font-size: 1.1em;
}

.provider-type {
  background: var(--bg-active);
  color: var(--accent-color);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.8em;
  text-transform: uppercase;
}

.provider-url {
  font-size: 0.85em;
  color: var(--text-muted);
}

/* Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  overflow-y: auto;
  padding: 24px;
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.modal-content {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 32px;
  width: 100%;
  max-width: 500px;
  max-height: calc(100vh - 48px);
  overflow: hidden;
  box-sizing: border-box;
  box-shadow: var(--surface-shadow-lg);
  display: flex;
  flex-direction: column;
}

.provider-editor-header {
  flex-shrink: 0;
  padding-bottom: 24px;
}

.provider-editor h3 {
  margin: 0;
}

.provider-editor-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 10px;
  margin-right: -10px;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--border-color) 88%, transparent) transparent;
}

.provider-editor-scroll::-webkit-scrollbar {
  width: 8px;
}

.provider-editor-scroll::-webkit-scrollbar-track {
  background: transparent;
  margin: 6px 0;
}

.provider-editor-scroll::-webkit-scrollbar-thumb {
  background-color: color-mix(in srgb, var(--border-color) 88%, transparent);
  border-radius: 999px;
}

.provider-editor-scroll::-webkit-scrollbar-thumb:hover {
  background-color: var(--text-muted);
}

.modal-footer {
  margin-top: 32px;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.provider-editor-footer {
  flex-shrink: 0;
  padding-top: 20px;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 72%, transparent);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--bg-primary) 0%, transparent),
    var(--bg-primary)
  );
}

.status-badge {
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
  transition:
    background 0.2s ease,
    color 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.status-badge.enabled {
  background: color-mix(in srgb, var(--status-success-color) 16%, var(--bg-secondary));
  color: var(--status-success-color);
}
</style>
