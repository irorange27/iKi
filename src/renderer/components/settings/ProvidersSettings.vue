<template>
  <!-- Providers -->
  <section class="config-section providers-section">
    <div class="providers-layout">
      <!-- Left Panel: Provider List -->
      <div class="providers-sidebar">
        <div class="providers-search">
          <input
            type="text"
            v-model="providerSearchQuery"
            placeholder="Search providers..."
            class="search-input"
          />
        </div>

        <div class="providers-actions">
          <button class="action-btn secondary-btn" @click="addCustomProvider">
            <span>+</span> Add Custom Provider
          </button>
        </div>

        <div class="providers-scroll-list">
          <!-- Built-in Providers -->
          <div
            v-for="bp in filteredBuiltInProviders"
            :key="bp.id"
            class="provider-list-item"
            :class="{
              active: selectedProviderId === bp.id,
              configured: isProviderConfigured(bp.id),
            }"
            @click="selectProvider(bp.id)"
          >
            <span class="provider-icon">
              <LobeIcon :name="getProviderIconName(bp.id)" :size="24" />
            </span>
            <div class="provider-item-main">
              <span class="provider-item-name">{{ bp.name }}</span>
            </div>
            <span class="provider-status-dot" :class="{ active: isProviderEnabled(bp.id) }"></span>
          </div>

          <!-- Custom Providers -->
          <div v-if="customProviders.length > 0" class="providers-divider">
            <span>Custom Providers</span>
          </div>
          <div
            v-for="cp in customProviders"
            :key="cp.id"
            class="provider-list-item custom"
            :class="{ active: selectedProviderId === cp.id }"
            @click="selectProvider(cp.id)"
          >
            <span class="provider-icon">
              <LobeIcon v-bind="getCustomIconProps(cp.icon)" :size="20" />
            </span>
            <div class="provider-item-main">
              <span class="provider-item-name">{{ cp.name }}</span>
              <span class="provider-item-badge">CUSTOM</span>
            </div>
            <span class="provider-status-dot" :class="{ active: isProviderEnabled(cp.id) }"></span>
          </div>
        </div>
      </div>

      <!-- Right Panel: Provider Details -->
      <div class="provider-details-panel">
        <template v-if="selectedProviderInfo">
          <div class="provider-header">
            <div class="provider-title-row">
              <h3>{{ selectedProviderInfo.name }}</h3>
              <span class="status-badge" :class="{ active: isSelectedProviderActive }">
                {{ isSelectedProviderActive ? 'Active' : 'Inactive' }}
              </span>
            </div>
            <p class="provider-description">
              {{ selectedProviderInfo.description }}
            </p>
          </div>

          <div class="provider-config-form" v-if="selectedProviderConfig || showConfigForm">
            <div class="provider-config-group">
              <label class="input-label"
                >API Key
                <input
                  type="password"
                  v-model="providerFormData.api_key"
                  placeholder="Enter your API key"
                />
              </label>

              <label class="input-label"
                >Base URL
                <input
                  type="text"
                  v-model="providerFormData.base_url"
                  :placeholder="selectedProviderInfo.defaultBaseUrl || 'https://api.example.com/v1'"
                />
              </label>

              <label class="input-label">
                <div class="label-header">
                  <span>Available Models</span>
                  <button
                    class="fetch-models-btn"
                    @click="fetchLatestModels"
                    :disabled="isFetchingModels"
                  >
                    <RefreshCw :size="14" :class="{ 'animate-spin': isFetchingModels }" />
                    {{ isFetchingModels ? 'Fetching...' : 'Fetch from models.dev' }}
                  </button>
                </div>
                <div v-if="availableModelsList.length > 0" class="models-selection-container">
                  <div class="models-selection-header">
                    <span class="models-count"
                      >{{ selectedModelsList.length }} of
                      {{ availableModelsList.length }} selected</span
                    >
                    <div class="models-actions">
                      <button class="select-all-btn" @click="selectAllModels">Select All</button>
                      <button class="deselect-all-btn" @click="deselectAllModels">
                        Deselect All
                      </button>
                    </div>
                  </div>
                  <div class="models-checkbox-list">
                    <label
                      v-for="model in availableModelsList"
                      :key="model"
                      class="model-checkbox-item"
                    >
                      <input
                        type="checkbox"
                        :checked="isModelSelected(model)"
                        @change="toggleModel(model)"
                      />
                      <span class="model-name">{{ model }}</span>
                    </label>
                  </div>
                </div>
                <div v-else class="models-chips">
                  <button class="add-model-btn" @click="addModel">+</button>
                  <span
                    v-for="model in selectedProviderInfo.models"
                    :key="model"
                    class="model-chip"
                    :class="{ 'dynamic-chip': dynamicModels[selectedProviderId!] }"
                  >
                    {{ model }}
                  </span>
                </div>
              </label>
            </div>

            <div class="provider-form-actions">
              <button
                v-if="selectedProviderConfig"
                class="danger-btn"
                @click="removeProviderConfig"
              >
                Remove Configuration
              </button>
              <button
                v-if="showConfigForm && !selectedProviderConfig"
                class="secondary-btn"
                @click="showConfigForm = false"
              >
                Cancel
              </button>
              <button class="primary-btn save-btn" @click="saveProviderConfig">
                <Save :size="16" />
                <span>
                  {{ selectedProviderConfig ? 'Save Changes' : 'Save & Enable Provider' }}
                </span>
              </button>
            </div>
          </div>

          <div class="provider-enable-prompt" v-else>
            <p>This provider is not configured yet.</p>
            <button class="primary-btn enable-btn" @click="showConfigForm = true">
              <Cog :size="16" />
              Configure Provider
            </button>
            <a
              v-if="selectedProviderInfo.docsUrl"
              :href="selectedProviderInfo.docsUrl"
              target="_blank"
              class="docs-link"
            >
              <BookOpen :size="16" />
              View Documentation
            </a>
          </div>
        </template>

        <div v-else class="no-selection">
          <p>Select a provider from the list to configure it.</p>
        </div>
      </div>
    </div>

    <!-- Custom Provider Editor Modal -->
    <div v-if="showProviderEditor" class="modal-overlay">
      <div class="modal-content provider-editor">
        <h3>
          {{ editingProvider?.id?.startsWith('custom_') ? 'Edit' : 'Add' }}
          Custom Provider
        </h3>

        <div class="provider-config-group">
          <label class="input-label"
            >Name
            <input type="text" v-model="editingProvider.name" placeholder="e.g. My Local LLM" />
          </label>

          <label class="input-label"
            >Type
            <SettingsSelect
              :model-value="editingProvider.type"
              :options="providerTypeOptions"
              aria-label="Custom provider type"
              @update:model-value="updateEditingProviderTypeSelection"
            />
          </label>

          <label class="input-label"
            >API Key
            <input type="password" v-model="editingProvider.api_key" placeholder="Enter API Key" />
          </label>

          <label class="input-label"
            >Base URL
            <input
              type="text"
              v-model="editingProvider.base_url"
              placeholder="https://api.example.com/v1"
            />
          </label>

          <label class="input-label"
            >Models (comma separated)
            <input type="text" v-model="editingProvider.models" placeholder="model-1, model-2" />
          </label>
        </div>

        <div class="modal-footer">
          <button class="secondary-btn" @click="showProviderEditor = false">Cancel</button>
          <button class="primary-btn" @click="saveProvider">Save Provider</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
// Provider Management Logic
import { ref, computed, onMounted } from 'vue';
import LobeIcon from '../../components/Icon/LobeIcon.vue';
import { BookOpen, Cog, RefreshCw, Save } from 'lucide-vue-next';
import SettingsSelect from './SettingsSelect.vue';
import { BuiltInProvider } from '../../../shared/types/settings';
import type { Provider } from '../../../shared/types/provider';
import { BUILTIN_PROVIDERS } from '../../../shared/constants/ProvidersSettings';
import { getErrorMessage } from '../../../shared/utils/errors';
import { parseModelList } from '../../../shared/utils/provider_models';
import { createLogger } from '../../logger';
import { getProviderIconName } from '../../modules/providers/provider_icons';

type ProviderRecord = Provider & {
  icon?: string | null;
};

type EditableProvider = Pick<
  ProviderRecord,
  'id' | 'name' | 'type' | 'api_key' | 'base_url' | 'enabled' | 'icon'
> & {
  models: string;
  available_models: string;
};

const electronAPI = window.electronAPI as NonNullable<typeof window.electronAPI>;
const providersSettingsLogger = createLogger({ module: 'providers_settings' });

const providers = ref<ProviderRecord[]>([]);
const editingProvider = ref<EditableProvider | null>(null);
const showProviderEditor = ref(false);

// New state for two-panel design
const providerSearchQuery = ref('');
const selectedProviderId = ref<string | null>(null);
const showConfigForm = ref(false);
const providerFormData = ref({
  api_key: '',
  base_url: '',
});
const isFetchingModels = ref(false);
const dynamicModels = ref<Record<string, string[]>>({});
const selectedModels = ref<Record<string, string[]>>({});

const providerTypeOptions = [
  { value: 'openai', label: 'OpenAI Compatible' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google Gemini' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'custom', label: 'Custom' },
];

const CUSTOM_ICON_CDN = 'https://unpkg.com/lucide-static@latest/icons';

const getCustomIconProps = (icon?: string) => {
  if (!icon || icon === 'custom') {
    return { name: 'grid-2x2', cdnPrefix: CUSTOM_ICON_CDN, useCdn: true };
  }
  return { name: icon, useCdn: true };
};

const fetchLatestModels = async () => {
  if (!selectedProviderId.value) return;

  isFetchingModels.value = true;
  try {
    const fetched = await electronAPI.chat.getModels(selectedProviderId.value);
    if (fetched && fetched.length > 0) {
      dynamicModels.value[selectedProviderId.value] = fetched;
      // Preserve existing selected models that are still in the fetched list
      const currentSelected =
        selectedModels.value[selectedProviderId.value] || getSelectedModelsForProvider();
      // Keep only models that exist in the fetched list
      selectedModels.value[selectedProviderId.value] = currentSelected.filter(m =>
        fetched.includes(m)
      );
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

// Get selected models for current provider
const getSelectedModelsForProvider = (): string[] => {
  if (!selectedProviderId.value) return [];
  const config = selectedProviderConfig.value;
  if (config?.models) {
    return parseModelList(config.models);
  }
  return [];
};

// Computed: available models list (from fetch or database)
const availableModelsList = computed(() => {
  if (!selectedProviderId.value) return [];

  // Priority: 1. dynamicModels (just fetched), 2. available_models from config, 3. built-in default models
  const dynamic = dynamicModels.value[selectedProviderId.value];
  if (dynamic && dynamic.length > 0) return dynamic;

  const config = selectedProviderConfig.value;
  if (config?.available_models) {
    const available = parseModelList(config.available_models);
    if (available.length > 0) return available;
  }

  // Fallback to built-in provider's default models if configured
  if (config?.models) {
    const models = parseModelList(config.models);
    if (models.length > 0) return models;
  }

  // Last fallback: built-in provider's default models
  const builtIn = BUILTIN_PROVIDERS.find(p => p.id === selectedProviderId.value);
  return builtIn?.models || [];
});

// Computed: selected models list
const selectedModelsList = computed(() => {
  if (!selectedProviderId.value) return getSelectedModelsForProvider();
  return selectedModels.value[selectedProviderId.value] || getSelectedModelsForProvider();
});

// Check if a model is selected
const isModelSelected = (model: string): boolean => {
  return selectedModelsList.value.includes(model);
};

// Toggle model selection
const toggleModel = (model: string) => {
  if (!selectedProviderId.value) return;

  if (!selectedModels.value[selectedProviderId.value]) {
    selectedModels.value[selectedProviderId.value] = getSelectedModelsForProvider();
  }

  const index = selectedModels.value[selectedProviderId.value].indexOf(model);
  if (index > -1) {
    selectedModels.value[selectedProviderId.value].splice(index, 1);
  } else {
    selectedModels.value[selectedProviderId.value].push(model);
  }
};

// Select all models
const selectAllModels = () => {
  if (!selectedProviderId.value) return;
  selectedModels.value[selectedProviderId.value] = [...availableModelsList.value];
};

// Deselect all models
const deselectAllModels = () => {
  if (!selectedProviderId.value) return;
  selectedModels.value[selectedProviderId.value] = [];
};

const loadProviders = async () => {
  providers.value = await electronAPI.providers.list();
};

const addModel = () => {
  if (!selectedProviderId.value) return;

  const model = prompt('Enter model name:');
  if (model) {
    if (!dynamicModels.value[selectedProviderId.value]) {
      dynamicModels.value[selectedProviderId.value] = [];
    }
    if (!dynamicModels.value[selectedProviderId.value].includes(model)) {
      dynamicModels.value[selectedProviderId.value].push(model);
    }
    // Also add to selected models
    if (!selectedModels.value[selectedProviderId.value]) {
      selectedModels.value[selectedProviderId.value] = [];
    }
    if (!selectedModels.value[selectedProviderId.value].includes(model)) {
      selectedModels.value[selectedProviderId.value].push(model);
    }
  }
};

// Computed: filter built-in providers by search
const filteredBuiltInProviders = computed(() => {
  const query = providerSearchQuery.value.toLowerCase();
  const filtered = BUILTIN_PROVIDERS.filter(
    p => p.name.toLowerCase().includes(query) || p.id.toLowerCase().includes(query)
  );

  return [...filtered].sort((a, b) => {
    const aEnabled = isProviderEnabled(a.id);
    const bEnabled = isProviderEnabled(b.id);
    if (aEnabled && !bEnabled) return -1;
    if (!aEnabled && bEnabled) return 1;
    return 0;
  });
});

// Computed: custom providers (not built-in)
const customProviders = computed(() => {
  const custom = providers.value.filter(
    provider => !BUILTIN_PROVIDERS.some(builtInProvider => builtInProvider.id === provider.type)
  );

  return [...custom].sort((a, b) => {
    const aEnabled = a.enabled === true;
    const bEnabled = b.enabled === true;
    if (aEnabled && !bEnabled) return -1;
    if (!aEnabled && bEnabled) return 1;
    return 0;
  });
});

// Computed: get selected provider info (from built-in or custom)
const selectedProviderInfo = computed((): BuiltInProvider | null => {
  if (!selectedProviderId.value) return null;

  // Check built-in first
  const builtIn = BUILTIN_PROVIDERS.find(p => p.id === selectedProviderId.value);
  if (builtIn) {
    // For display purposes, use selected models
    const selected = selectedModels.value[builtIn.id] || getSelectedModelsForProvider();
    return {
      ...builtIn,
      models: selected,
    };
  }

  // Check custom providers
  const custom = providers.value.find(p => p.id === selectedProviderId.value);
  if (custom) {
    const selected = selectedModels.value[custom.id] || parseModelList(custom.models);
    return {
      id: custom.id,
      name: custom.name,
      description: 'Custom provider configuration',
      models: selected,
      defaultBaseUrl: custom.base_url,
    };
  }

  return null;
});

// Computed: get saved config for selected provider
const selectedProviderConfig = computed(() => {
  if (!selectedProviderId.value) return null;
  return providers.value.find(
    p => p.type === selectedProviderId.value || p.id === selectedProviderId.value
  );
});

// Computed: check if selected provider is active
const isSelectedProviderActive = computed(() => {
  const config = selectedProviderConfig.value;
  return config?.enabled === true;
});

// Check if a built-in provider has been configured
const isProviderConfigured = (providerId: string) => {
  return providers.value.some(p => p.type === providerId);
};

// Check if a provider is enabled
const isProviderEnabled = (providerId: string) => {
  const config = providers.value.find(p => p.type === providerId || p.id === providerId);
  return config?.enabled === true;
};

// Select a provider to show details
const selectProvider = (providerId: string) => {
  selectedProviderId.value = providerId;
  showConfigForm.value = false;

  // Pre-fill form if already configured
  const existing = providers.value.find(p => p.type === providerId || p.id === providerId);
  if (existing) {
    providerFormData.value = {
      api_key: existing.api_key || '',
      base_url: existing.base_url || '',
    };
    // Load selected models from config
    if (existing.models) {
      selectedModels.value[providerId] = parseModelList(existing.models);
    }
    // Load available models if they exist
    if (existing.available_models) {
      const available = parseModelList(existing.available_models);
      if (available.length > 0) {
        dynamicModels.value[providerId] = available;
      }
    }
  } else {
    const builtIn = BUILTIN_PROVIDERS.find(p => p.id === providerId);
    providerFormData.value = {
      api_key: '',
      base_url: builtIn?.defaultBaseUrl || '',
    };
    selectedModels.value[providerId] = [];
  }
};

// Save provider configuration
const saveProviderConfig = async () => {
  if (!selectedProviderId.value || !selectedProviderInfo.value) {
    return;
  }

  const activeProviderId = selectedProviderId.value;
  const existingConfig = selectedProviderConfig.value;

  try {
    if (existingConfig) {
      // Update existing
      const modelsToSave = selectedModels.value[activeProviderId] || getSelectedModelsForProvider();
      const availableToSave =
        dynamicModels.value[activeProviderId] || parseModelList(existingConfig.available_models);
      await electronAPI.providers.update(existingConfig.id, {
        api_key: providerFormData.value.api_key,
        base_url: providerFormData.value.base_url,
        enabled: true,
        models: JSON.stringify(modelsToSave),
        available_models: JSON.stringify(availableToSave),
      });
    } else {
      // Create new configuration for built-in provider
      const builtIn = selectedProviderInfo.value;
      const modelsToSave = selectedModels.value[builtIn.id] || [];
      const availableToSave = dynamicModels.value[builtIn.id] || [];
      const newProvider = {
        id: `${builtIn.id}_${Date.now()}`,
        name: builtIn.name,
        type: builtIn.id,
        api_key: providerFormData.value.api_key,
        base_url: providerFormData.value.base_url || builtIn.defaultBaseUrl || '',
        models: JSON.stringify(modelsToSave),
        enabled: true,
        available_models: JSON.stringify(availableToSave),
      };
      await electronAPI.providers.add(newProvider);
    }

    showConfigForm.value = false;
    await loadProviders();
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

// Remove provider configuration
const removeProviderConfig = async () => {
  const config = selectedProviderConfig.value;
  if (!config) return;

  if (confirm('Are you sure you want to remove this provider configuration?')) {
    await electronAPI.providers.delete(config.id);
    await loadProviders();
    showConfigForm.value = false;
  }
};

// Add custom provider
const addCustomProvider = () => {
  editingProvider.value = {
    id: `custom_${Date.now()}`,
    name: '',
    type: 'custom',
    api_key: '',
    models: '',
    base_url: '',
    enabled: true,
    available_models: '[]',
  };
  showProviderEditor.value = true;
};

const updateEditingProviderTypeSelection = (value: string) => {
  if (!editingProvider.value) return;
  editingProvider.value.type = value;
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
  loadProviders();
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

.models-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.model-chip {
  background: var(--bg-active);
  color: var(--text-primary);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-family: monospace;
}

.providers-section {
  max-width: none !important;
}

.providers-layout {
  display: flex;
  gap: 24px;
  min-height: 500px;
}

.providers-sidebar {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.providers-search .search-input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 14px;
}

.providers-search .search-input:focus {
  outline: none;
  border-color: var(--accent-color);
}

.providers-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.providers-scroll-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.provider-list-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
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
  width: 32px;
  height: 32px;
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
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border-color);
}

.providers-divider {
  padding: 16px 14px 8px;
  font-size: 12px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Provider Details Panel */
.provider-details-panel {
  flex: 1;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 18px;
  padding: 24px 28px;
  box-shadow: var(--surface-inset-highlight);
}

.provider-header {
  margin-bottom: 20px;
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

.provider-config-form {
  margin-top: 20px;
}

.provider-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
}

.provider-enable-prompt {
  text-align: center;
  padding: 64px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.provider-enable-prompt p {
  color: var(--text-secondary);
  margin-bottom: 32px;
  font-size: 1.1em;
}

.enable-btn {
  padding: 12px 32px;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border-radius: 12px;
  font-weight: 500;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.enable-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(var(--accent-rgb), 0.2);
}

.enable-btn:active {
  transform: translateY(0);
}

.docs-link {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 24px;
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 14px;
  transition: all 0.2s;
  opacity: 0.8;
}

.docs-link:hover {
  color: var(--accent-color);
  opacity: 1;
  text-decoration: none;
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
  box-shadow: var(--surface-shadow-lg);
}

.provider-editor h3 {
  margin-bottom: 24px;
}

.modal-footer {
  margin-top: 32px;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.status-badge {
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
}

.status-badge.active {
  background: color-mix(in srgb, var(--success-color) 18%, transparent);
  color: var(--success-color);
  border-color: color-mix(in srgb, var(--success-color) 40%, transparent);
}

.label-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.fetch-models-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
}

.fetch-models-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--accent-color);
  color: var(--accent-color);
}

.fetch-models-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.animate-spin {
  animation: spin 1s linear infinite;
}

.dynamic-chip {
  background: rgba(var(--accent-rgb, 74, 158, 255), 0.15) !important;
  border-color: var(--accent-color) !important;
  color: var(--accent-color) !important;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

/* Models Selection Styles */
.models-selection-container {
  margin-top: 12px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 14px;
  background: var(--bg-secondary);
  max-height: 400px;
  display: flex;
  flex-direction: column;
}

.models-selection-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 80%, transparent);
}

.models-count {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
}

.models-actions {
  display: flex;
  gap: 8px;
}

.select-all-btn,
.deselect-all-btn {
  padding: 4px 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  border-radius: 999px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.select-all-btn:hover,
.deselect-all-btn:hover {
  background: var(--bg-hover);
  border-color: var(--accent-color);
  color: var(--accent-color);
}

.models-checkbox-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 300px;
}

.model-checkbox-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
}

.model-checkbox-item:hover {
  background: var(--bg-hover);
  border-color: color-mix(in srgb, var(--accent-color) 25%, var(--border-color));
}

.model-checkbox-item input[type='checkbox'] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: var(--accent-color);
  flex-shrink: 0;
}

.model-name {
  font-family: monospace;
  font-size: 13px;
  color: var(--text-primary);
  flex: 1;
}

.model-checkbox-item:has(input:checked) {
  background: color-mix(in srgb, var(--accent-color) 16%, var(--bg-tertiary));
  border-color: var(--accent-color);
}

.model-checkbox-item:has(input:checked) .model-name {
  color: var(--accent-color);
  font-weight: 500;
}
</style>
