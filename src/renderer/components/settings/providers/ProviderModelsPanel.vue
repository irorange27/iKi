<template>
  <div class="provider-models-panel" :class="{ 'provider-models-panel-open': props.open }">
    <button
      type="button"
      class="provider-models-toggle"
      :title="t('settings.providers.modelsSummaryTitle')"
      @click="$emit('toggle-open')"
    >
      <div class="provider-models-toggle-main">
        <span class="provider-models-title">{{ t('settings.providers.models') }}</span>
        <span class="provider-models-subtitle">
          {{ t('settings.providers.modelsSubtitle') }}
        </span>
      </div>
      <div class="provider-models-toggle-meta">
        <span class="provider-models-summary">
          {{ t('settings.providers.modelsSelected', { count: props.selectedModels.length }) }}
        </span>
        <ChevronDown :size="16" :class="{ 'models-toggle-open': props.open }" />
      </div>
    </button>

    <div v-if="props.open" class="provider-models-body">
      <div class="provider-models-toolbar">
        <button
          type="button"
          class="fetch-models-btn secondary-btn"
          :title="t('settings.providers.fetchModelsTitle')"
          :disabled="props.isFetchingModels"
          @click="$emit('fetch-models')"
        >
          <RefreshCw :size="14" :class="{ 'animate-spin': props.isFetchingModels }" />
          {{
            props.isFetchingModels
              ? t('settings.providers.fetchingModels')
              : t('settings.providers.fetchModels')
          }}
        </button>
      </div>

      <div class="provider-models-manual">
        <input
          v-model="pendingModelId"
          class="provider-models-inline-input"
          :placeholder="t('settings.providers.modelAddIdPlaceholder')"
          :title="t('settings.providers.modelAddTitle')"
          @keydown.enter.prevent="submitManualModel"
        />
        <input
          v-model="pendingDisplayName"
          class="provider-models-inline-input"
          :placeholder="t('settings.providers.modelAddDisplayNamePlaceholder')"
          :title="t('settings.providers.modelOptions.tooltip')"
          @keydown.enter.prevent="submitManualModel"
        />
        <button
          type="button"
          class="manual-add-btn secondary-btn"
          :title="t('settings.providers.modelAddTitle')"
          :disabled="pendingModelId.trim().length === 0"
          @click="submitManualModel"
        >
          <Plus :size="14" />
          {{ t('settings.providers.modelAdd') }}
        </button>
      </div>

      <label class="provider-models-search">
        <Search :size="16" class="provider-models-search-icon" />
        <input
          v-model="searchQuery"
          class="provider-models-search-input"
          :placeholder="t('settings.providers.modelSearchPlaceholder')"
        />
      </label>

      <div class="provider-models-list-summary" :title="t('settings.providers.modelsSummaryTitle')">
        {{ t('settings.providers.selectionCount', { selected: props.selectedModels.length, total: allModels.length }) }}
      </div>

      <div class="provider-models-list-shell">
        <div v-if="filteredModelRows.length > 0" class="provider-models-list">
          <div
            v-for="model in filteredModelRows"
            :key="model.id"
            class="provider-model-row"
            :class="{
              'provider-model-row-enabled': model.enabled,
              'provider-model-row-configured': model.hasOptions,
            }"
            :title="model.rowTooltip"
          >
            <div class="provider-model-row-copy">
              <span class="provider-model-row-title">{{ model.label }}</span>
              <span v-if="model.secondary" class="provider-model-row-secondary">
                {{ model.secondary }}
              </span>
            </div>

            <div class="provider-model-row-actions">
              <button
                type="button"
                class="model-options-btn"
                :class="{ 'model-options-btn-configured': model.hasOptions }"
                :title="model.optionsTooltip"
                :aria-label="model.optionsAriaLabel"
                @click="$emit('edit-model-options', model.id)"
              >
                <SlidersHorizontal :size="15" />
              </button>

              <label class="model-toggle" :title="model.toggleTooltip">
                <input
                  type="checkbox"
                  :checked="model.enabled"
                  @change="$emit('toggle-model', model.id)"
                />
                <span class="model-toggle-track">
                  <span class="model-toggle-thumb" />
                </span>
              </label>
            </div>
          </div>
        </div>

        <div v-else class="provider-models-empty">
          {{
            searchQuery.trim().length > 0
              ? t('settings.providers.modelsEmptySearch')
              : t('settings.providers.modelsEmpty')
          }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  ChevronDown,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from 'lucide-vue-next';

import type { ProviderModelOptionsMap } from '../../../../shared/types/provider';
import { getProviderModelOptions } from '../../../../shared/utils/provider_models';
import { useI18n } from '../../../i18n';
import { getModelOptionSummary } from '../../../modules/providers/provider_model_options';

const props = defineProps<{
  open: boolean;
  isFetchingModels: boolean;
  availableModels: string[];
  selectedModels: string[];
  fallbackModels: string[];
  modelOptions: ProviderModelOptionsMap;
  hasDynamicModels: boolean;
}>();

const emit = defineEmits<{
  (event: 'toggle-open'): void;
  (event: 'fetch-models'): void;
  (event: 'toggle-model', modelId: string): void;
  (event: 'edit-model-options', modelId: string): void;
  (event: 'add-model', payload: { modelId: string; displayName: string }): void;
}>();

type ModelRow = {
  id: string;
  label: string;
  secondary: string;
  enabled: boolean;
  hasOptions: boolean;
  rowTooltip: string;
  optionsAriaLabel: string;
  optionsTooltip: string;
  toggleTooltip: string;
  searchText: string;
};

const { t } = useI18n();

const searchQuery = ref('');
const pendingModelId = ref('');
const pendingDisplayName = ref('');

const summaryLabels = computed(() => ({
  vision: t('settings.providers.modelOptions.summary.vision'),
  tools: t('settings.providers.modelOptions.summary.tools'),
  reasoning: t('settings.providers.modelOptions.summary.reasoning'),
  structuredOutputs: t('settings.providers.modelOptions.summary.structuredOutputs'),
  contextWindow: (count: string) =>
    t('settings.providers.modelOptions.summary.contextWindow', { count }),
}));

const selectedModelSet = computed(() => new Set(props.selectedModels));

const getSelectedModelOptions = (modelId: string) =>
  getProviderModelOptions(props.modelOptions, modelId);

const allModels = computed(() => {
  const seen = new Set<string>();
  const source = [...props.availableModels, ...props.fallbackModels];

  return source
    .map(model => model.trim())
    .filter(model => {
      if (!model || seen.has(model)) {
        return false;
      }
      seen.add(model);
      return true;
    });
});

const modelRows = computed<ModelRow[]>(() =>
  allModels.value
    .map(modelId => {
      const options = getSelectedModelOptions(modelId);
      const label = options?.displayName || modelId;
      const summary = getModelOptionSummary(options, summaryLabels.value);
      const hasOptions = Boolean(options && Object.keys(options).length > 0);
      const secondary = label !== modelId ? modelId : summary;
      const enabled = selectedModelSet.value.has(modelId);
      const rowTooltip = label === modelId ? summary : [modelId, summary].filter(Boolean).join('\n');
      const optionsAriaLabel = t('settings.providers.modelOptions.editAria', { model: label });
      const optionsTooltip = [
        optionsAriaLabel,
        summary || (hasOptions ? t('settings.providers.modelOptions.tooltip') : ''),
      ]
        .filter(Boolean)
        .join('\n');

      return {
        id: modelId,
        label,
        secondary,
        enabled,
        hasOptions,
        rowTooltip,
        optionsAriaLabel,
        optionsTooltip,
        toggleTooltip: enabled
          ? t('settings.providers.modelToggleDisable', { model: label })
          : t('settings.providers.modelToggleEnable', { model: label }),
        searchText: `${label} ${modelId} ${summary}`.toLowerCase(),
      };
    })
    .sort((left, right) => {
      if (left.enabled !== right.enabled) {
        return left.enabled ? -1 : 1;
      }
      return left.label.localeCompare(right.label, undefined, { sensitivity: 'base' });
    })
);

const filteredModelRows = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) {
    return modelRows.value;
  }

  return modelRows.value.filter(model => model.searchText.includes(query));
});

const submitManualModel = () => {
  const modelId = pendingModelId.value.trim();
  if (!modelId) return;

  emit('add-model', {
    modelId,
    displayName: pendingDisplayName.value.trim(),
  });

  pendingModelId.value = '';
  pendingDisplayName.value = '';
};
</script>

<style scoped src="../settings_shared.css"></style>

<style scoped>
.provider-models-panel {
  border: 1px solid var(--border-color);
  border-radius: 16px;
  background: color-mix(in srgb, var(--bg-secondary) 76%, var(--bg-tertiary));
  overflow: hidden;
}

.provider-models-panel-open {
  box-shadow: var(--surface-inset-highlight);
}

.provider-models-toggle {
  width: 100%;
  border: none;
  background: transparent;
  color: inherit;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 16px 18px;
  cursor: pointer;
}

.provider-models-toggle-main,
.provider-models-toggle-meta {
  display: flex;
  align-items: center;
}

.provider-models-toggle-main {
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
}

.provider-models-toggle-meta {
  gap: 10px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.provider-models-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
}

.provider-models-subtitle {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.45;
  max-width: 460px;
}

.provider-models-summary {
  font-size: 11px;
  font-weight: 600;
}

.models-toggle-open {
  transform: rotate(180deg);
}

.provider-models-body {
  padding: 0 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.provider-models-toolbar {
  display: flex;
  justify-content: flex-end;
}

.fetch-models-btn,
.manual-add-btn {
  min-height: 38px;
  border-radius: 999px;
}

.provider-models-manual {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) auto;
  gap: 10px;
}

.provider-models-inline-input,
.provider-models-search-input {
  width: 100%;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 14px;
  transition:
    border-color 0.2s ease,
    background-color 0.2s ease,
    box-shadow 0.2s ease;
}

.provider-models-inline-input {
  min-height: 40px;
  padding: 10px 12px;
  border-radius: 12px;
}

.provider-models-inline-input::placeholder,
.provider-models-search-input::placeholder {
  color: var(--text-secondary);
}

.provider-models-inline-input:focus,
.provider-models-search-input:focus {
  outline: none;
  border-color: var(--accent-color);
}

.provider-models-search {
  position: relative;
  display: block;
}

.provider-models-search-icon {
  position: absolute;
  top: 50%;
  left: 12px;
  transform: translateY(-50%);
  color: var(--text-secondary);
  pointer-events: none;
}

.provider-models-search-input {
  min-height: 42px;
  border-radius: 14px;
  padding: 11px 14px 11px 40px;
}

.provider-models-list-summary {
  font-size: 12px;
  color: var(--text-secondary);
}

.provider-models-list-shell {
  border: 1px solid var(--border-color);
  border-radius: 16px;
  background: color-mix(in srgb, var(--bg-primary) 90%, transparent);
  overflow: hidden;
}

.provider-models-list {
  max-height: 360px;
  overflow-y: auto;
}

.provider-model-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 78%, transparent);
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
}

.provider-model-row:last-child {
  border-bottom: none;
}

.provider-model-row:hover {
  background: color-mix(in srgb, var(--bg-hover) 86%, transparent);
}

.provider-model-row-enabled {
  background: color-mix(in srgb, var(--accent-color) 10%, var(--bg-primary));
}

.provider-model-row-configured:not(.provider-model-row-enabled) {
  background: color-mix(in srgb, var(--accent-color) 4%, var(--bg-primary));
}

.provider-model-row-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.provider-model-row-title {
  font-family:
    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
  font-size: 13px;
  color: var(--text-primary);
  line-height: 1.35;
  word-break: break-word;
}

.provider-model-row-secondary {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
  word-break: break-word;
}

.provider-model-row-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.model-options-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    color 0.2s ease,
    background-color 0.2s ease;
}

.model-options-btn:hover {
  border-color: color-mix(in srgb, var(--accent-color) 55%, var(--border-color));
  color: var(--text-primary);
  background: color-mix(in srgb, var(--bg-hover) 80%, transparent);
}

.model-options-btn-configured {
  color: var(--accent-color);
  border-color: color-mix(in srgb, var(--accent-color) 45%, var(--border-color));
  background: color-mix(in srgb, var(--accent-color) 10%, transparent);
}

.model-toggle {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
}

.model-toggle input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.model-toggle-track {
  width: 48px;
  height: 28px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-tertiary) 90%, var(--bg-secondary));
  border: 1px solid color-mix(in srgb, var(--border-color) 85%, transparent);
  padding: 2px;
  display: inline-flex;
  align-items: center;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
}

.model-toggle-thumb {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--text-secondary) 40%, var(--bg-primary));
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  transition:
    transform 0.2s ease,
    background-color 0.2s ease;
}

.model-toggle input:checked + .model-toggle-track {
  background: color-mix(in srgb, var(--accent-color) 80%, var(--bg-secondary));
  border-color: color-mix(in srgb, var(--accent-color) 88%, transparent);
}

.model-toggle input:checked + .model-toggle-track .model-toggle-thumb {
  transform: translateX(20px);
  background: var(--accent-contrast);
}

.provider-models-empty {
  padding: 18px 16px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

@media (max-width: 900px) {
  .provider-models-manual {
    grid-template-columns: 1fr;
  }

  .manual-add-btn {
    width: 100%;
  }

  .provider-model-row {
    align-items: flex-start;
  }
}
</style>
