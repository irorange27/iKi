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
            <span class="provider-item-name">{{ bp.name }}</span>
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
              <LobeIcon :name="cp.icon || 'custom'" :size="20" />
            </span>
            <span class="provider-item-name">{{ cp.name }}</span>
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
            <div class="config-group">
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
                class="secondary"
                @click="showConfigForm = false"
              >
                Cancel
              </button>
              <button class="primary save-btn" @click="saveProviderConfig">
                <Save :size="16" />
                <span>
                  {{ selectedProviderConfig ? 'Save Changes' : 'Save & Enable Provider' }}
                </span>
              </button>
            </div>
          </div>

          <div class="provider-enable-prompt" v-else>
            <p>This provider is not configured yet.</p>
            <button class="primary enable-btn" @click="showConfigForm = true">
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

        <div class="config-group">
          <label class="input-label"
            >Name
            <input type="text" v-model="editingProvider.name" placeholder="e.g. My Local LLM" />
          </label>

          <label class="input-label"
            >Type
            <select v-model="editingProvider.type">
              <option value="openai">OpenAI Compatible</option>
              <option value="anthropic">Anthropic</option>
              <option value="google">Google Gemini</option>
              <option value="ollama">Ollama</option>
              <option value="custom">Custom</option>
            </select>
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
          <button class="secondary" @click="showProviderEditor = false">Cancel</button>
          <button class="primary" @click="saveProvider">Save Provider</button>
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
import { BuiltInProvider } from '../../../shared/types/settings';
import { BUILTIN_PROVIDERS } from '../../../shared/constants/ProvidersSettings';

const providers = ref<any[]>([]);
const editingProvider = ref<any>(null);
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

// Icon name mapping for builtin providers
const getProviderIconName = (providerId: string): string => {
  const iconMap: Record<string, string> = {
    openai: 'openai',
    anthropic: 'anthropic',
    google: 'google',
    deepseek: 'deepseek',
    kimi: 'kimi', // Use spark icon for kimi
    ollama: 'ollama', // Use chatglm icon for ollama
    openrouter: 'openrouter', // Use openai icon for openrouter
    azure: 'azure',
  };
  return iconMap[providerId] || providerId;
};

const fetchLatestModels = async () => {
  if (!selectedProviderId.value) return;

  isFetchingModels.value = true;
  try {
    const fetched = await (window as any).electronAPI.chat.getModels(selectedProviderId.value);
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
    console.error('Error fetching models:', error);
  } finally {
    isFetchingModels.value = false;
  }
};

// Get selected models for current provider
const getSelectedModelsForProvider = (): string[] => {
  if (!selectedProviderId.value) return [];
  const config = selectedProviderConfig.value;
  if (config?.models) {
    try {
      return JSON.parse(config.models);
    } catch {
      return [];
    }
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
    try {
      const available = JSON.parse(config.available_models);
      if (available && available.length > 0) return available;
    } catch {}
  }

  // Fallback to built-in provider's default models if configured
  if (config?.models) {
    try {
      const models = JSON.parse(config.models);
      if (models && models.length > 0) return models;
    } catch {}
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
  providers.value = await (window as any).electronAPI.providers.list();
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
    (p: any) => !BUILTIN_PROVIDERS.some(bp => bp.id === p.type)
  );

  return [...custom].sort((a: any, b: any) => {
    const aEnabled = a.enabled === true || a.enabled === 1;
    const bEnabled = b.enabled === true || b.enabled === 1;
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
    const selected = selectedModels.value[custom.id] || JSON.parse(custom.models || '[]');
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
  return config?.enabled === true || config?.enabled === 1;
});

// Check if a built-in provider has been configured
const isProviderConfigured = (providerId: string) => {
  return providers.value.some(p => p.type === providerId);
};

// Check if a provider is enabled
const isProviderEnabled = (providerId: string) => {
  const config = providers.value.find(p => p.type === providerId || p.id === providerId);
  return config?.enabled === true || config?.enabled === 1;
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
      try {
        selectedModels.value[providerId] = JSON.parse(existing.models);
      } catch {
        selectedModels.value[providerId] = [];
      }
    }
    // Load available models if they exist
    if (existing.available_models) {
      try {
        const available = JSON.parse(existing.available_models);
        if (available && available.length > 0) {
          dynamicModels.value[providerId] = available;
        }
      } catch {}
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
  console.log('saveProviderConfig called');
  console.log('selectedProviderId:', selectedProviderId.value);
  console.log('selectedProviderInfo:', selectedProviderInfo.value);
  console.log('providerFormData:', providerFormData.value);

  if (!selectedProviderId.value || !selectedProviderInfo.value) {
    console.log('Early return - missing required data');
    return;
  }

  const existingConfig = selectedProviderConfig.value;
  console.log('existingConfig:', existingConfig);

  try {
    if (existingConfig) {
      // Update existing
      console.log('Updating existing provider:', existingConfig.id);
      const modelsToSave =
        selectedModels.value[selectedProviderId.value!] || getSelectedModelsForProvider();
      const availableToSave =
        dynamicModels.value[selectedProviderId.value!] ||
        (existingConfig.available_models ? JSON.parse(existingConfig.available_models) : []);
      const result = await (window as any).electronAPI.providers.update(existingConfig.id, {
        api_key: providerFormData.value.api_key,
        base_url: providerFormData.value.base_url,
        enabled: true,
        models: JSON.stringify(modelsToSave),
        available_models: JSON.stringify(availableToSave),
      });
      console.log('Update result:', result);
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
      console.log('Adding new provider:', newProvider);
      const result = await (window as any).electronAPI.providers.add(newProvider);
      console.log('Add result:', result);
    }

    showConfigForm.value = false;
    await loadProviders();
    console.log('Providers reloaded, new list:', providers.value);
  } catch (error) {
    console.error('Error saving provider:', error);
  }
};

// Remove provider configuration
const removeProviderConfig = async () => {
  const config = selectedProviderConfig.value;
  if (!config) return;

  if (confirm('Are you sure you want to remove this provider configuration?')) {
    await (window as any).electronAPI.providers.delete(config.id);
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

const editProvider = (provider: any) => {
  editingProvider.value = { ...provider };
  showProviderEditor.value = true;
};

const addNewProvider = () => {
  addCustomProvider();
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
    await (window as any).electronAPI.providers.update(editingProvider.value.id, providerData);
  } else {
    await (window as any).electronAPI.providers.add(providerData);
  }

  showProviderEditor.value = false;
  editingProvider.value = null;
  await loadProviders();
};

const deleteProvider = async (id: string) => {
  if (confirm('Are you sure you want to delete this provider?')) {
    await (window as any).electronAPI.providers.delete(id);
    await loadProviders();
  }
};

const toggleProviderEnabled = async (provider: any) => {
  await (window as any).electronAPI.providers.update(provider.id, {
    enabled: !provider.enabled,
  });
  await loadProviders();
};
onMounted(() => {
  loadProviders();
});
</script>

<style scoped>
.input-label {
  display: block;
  margin-bottom: 16px;
}

.input-label input,
.input-label select {
  width: 100%;
  padding: 8px 12px;
  margin-top: 6px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: var(--font-size);
}

.checkbox-label {
  display: block;
  margin-bottom: 12px;
  cursor: pointer;
}

.checkbox-label input[type='checkbox'] {
  margin-right: 8px;
  accent-color: var(--accent-color);
}

/* 密度面板样式 */
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.add-btn {
  background: var(--accent-color);
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  transition: all 0.2s;
}

.add-btn:hover {
  background: var(--accent-hover);
}

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

.secondary-btn {
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-primary);
}

.secondary-btn:hover {
  background: var(--bg-hover);
  border-color: var(--accent-color);
}

.config-section {
  max-width: 600px;
}

.config-group {
  margin-bottom: 32px;
}

.config-group h3 {
  margin-bottom: 12px;
  font-weight: 600;
}

.danger-btn {
  background: transparent;
  border: 1px solid #ef4444;
  color: #ef4444;
  padding: 10px 20px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.danger-btn:hover {
  background: #ef4444;
  color: white;
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

.providers-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.provider-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: all 0.2s;
}

.provider-card:hover {
  border-color: var(--accent-color);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

/* New Two-Panel Providers Layout */
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
  gap: 4px;
}

.provider-list-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  background: transparent;
}

.provider-list-item:hover {
  background: var(--bg-hover);
}

.provider-list-item.active {
  background: var(--bg-active);
  border-left: 3px solid var(--accent-color);
}

.provider-list-item.configured {
  opacity: 1;
}

.provider-icon {
  font-size: 1.2em;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  /* Unify icon colors in dark mode */
  filter: grayscale(1) brightness(1.5);
  opacity: 0.7;
  transition: all 0.2s ease;
}

.provider-list-item:hover .provider-icon,
.provider-list-item.active .provider-icon {
  filter: grayscale(0) brightness(1);
  opacity: 1;
}

.provider-item-name {
  flex: 1;
  font-weight: 500;
}

.provider-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border-color);
}

.provider-status-dot.active {
  background: #22c55e;
}

/* 密度面板样式 */
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.add-btn {
  background: var(--accent-color);
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  transition: all 0.2s;
}

.add-btn:hover {
  background: var(--accent-hover);
}

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

.secondary-btn {
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-primary);
}

.secondary-btn:hover {
  background: var(--bg-hover);
  border-color: var(--accent-color);
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
  background: var(--bg-secondary);
  border-radius: 16px;
  padding: 24px;
}

.provider-header {
  margin-bottom: 24px;
}

.provider-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.provider-title-row h3 {
  margin: 0;
  font-size: 1.5em;
}

.provider-description {
  color: var(--text-secondary);
  margin: 0;
}

.provider-config-form {
  margin-top: 24px;
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
  box-shadow: 0 4px 12px rgba(var(--accent-rgb, 0, 0, 0), 0.2);
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

.provider-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.icon-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 1.2em;
  padding: 4px;
  border-radius: 6px;
  transition: all 0.2s;
}

.icon-btn:hover {
  background: var(--bg-hover);
}

.icon-btn.delete:hover {
  background: rgba(239, 68, 68, 0.1);
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
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
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
  background: var(--bg-hover);
  color: var(--text-muted);
}

.status-badge.active {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
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
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  padding: 4px 8px;
  border-radius: 6px;
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
  border-radius: 8px;
  padding: 16px;
  background: var(--bg-primary);
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
  border-bottom: 1px solid var(--border-color);
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
  background: transparent;
  color: var(--text-secondary);
  border-radius: 6px;
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
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}

.model-checkbox-item:hover {
  background: var(--bg-hover);
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
  background: var(--bg-active);
}

.model-checkbox-item:has(input:checked) .model-name {
  color: var(--accent-color);
  font-weight: 500;
}
</style>
