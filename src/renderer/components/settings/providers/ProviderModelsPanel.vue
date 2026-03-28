<template>
  <div class="provider-models-panel">
    <button type="button" class="provider-models-toggle" @click="$emit('toggle-open')">
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
      <div class="label-header">
        <span class="provider-field-title">{{ t('settings.providers.availableModels') }}</span>
        <button
          class="fetch-models-btn"
          @click="$emit('fetch-models')"
          :disabled="props.isFetchingModels"
        >
          <RefreshCw :size="14" :class="{ 'animate-spin': props.isFetchingModels }" />
          {{
            props.isFetchingModels
              ? t('settings.providers.fetchingModels')
              : t('settings.providers.fetchModels')
          }}
        </button>
      </div>

      <div v-if="props.availableModels.length > 0" class="models-selection-container">
        <div class="models-selection-header">
          <span class="models-count">{{
            t('settings.providers.selectionCount', {
              selected: props.selectedModels.length,
              total: props.availableModels.length,
            })
          }}</span>
          <div class="models-actions">
            <button class="select-all-btn" @click="$emit('select-all')">
              {{ t('settings.providers.selectAll') }}
            </button>
            <button class="deselect-all-btn" @click="$emit('deselect-all')">
              {{ t('settings.providers.deselectAll') }}
            </button>
          </div>
        </div>
        <div class="models-checkbox-list">
          <div v-for="model in props.availableModels" :key="model" class="model-checkbox-item">
            <label class="model-checkbox-main">
              <input
                type="checkbox"
                :checked="props.selectedModels.includes(model)"
                @change="$emit('toggle-model', model)"
              />
              <span class="model-copy">
                <span class="model-name">{{ getModelLabel(model) }}</span>
                <span v-if="getModelCaption(model)" class="model-caption">
                  {{ getModelCaption(model) }}
                </span>
                <span v-if="getModelOptionSummaryText(model)" class="model-summary">
                  {{ getModelOptionSummaryText(model) }}
                </span>
              </span>
            </label>
            <button
              type="button"
              class="model-options-btn"
              @click="$emit('edit-model-options', model)"
            >
              <SlidersHorizontal :size="14" />
              {{ t('settings.providers.modelOptions.edit') }}
            </button>
          </div>
        </div>
      </div>

      <div v-else class="models-chips">
        <button class="add-model-btn" @click="$emit('add-model')">+</button>
        <span
          v-for="model in props.fallbackModels"
          :key="model"
          class="model-chip"
          :class="{ 'dynamic-chip': props.hasDynamicModels }"
        >
          {{ model }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ChevronDown, RefreshCw, SlidersHorizontal } from 'lucide-vue-next';

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

defineEmits<{
  (event: 'toggle-open'): void;
  (event: 'fetch-models'): void;
  (event: 'toggle-model', modelId: string): void;
  (event: 'select-all'): void;
  (event: 'deselect-all'): void;
  (event: 'edit-model-options', modelId: string): void;
  (event: 'add-model'): void;
}>();

const { t } = useI18n();

const summaryLabels = computed(() => ({
  vision: t('settings.providers.modelOptions.summary.vision'),
  tools: t('settings.providers.modelOptions.summary.tools'),
  reasoning: t('settings.providers.modelOptions.summary.reasoning'),
  structuredOutputs: t('settings.providers.modelOptions.summary.structuredOutputs'),
  contextWindow: (count: string) =>
    t('settings.providers.modelOptions.summary.contextWindow', { count }),
}));

const getSelectedModelOptions = (modelId: string) =>
  getProviderModelOptions(props.modelOptions, modelId);

const getModelLabel = (modelId: string): string =>
  getSelectedModelOptions(modelId)?.displayName || modelId;

const getModelCaption = (modelId: string): string => {
  const label = getModelLabel(modelId);
  return label === modelId ? '' : modelId;
};

const getModelOptionSummaryText = (modelId: string): string =>
  getModelOptionSummary(getSelectedModelOptions(modelId), summaryLabels.value);
</script>

<style scoped src="../settings_shared.css"></style>

<style scoped>
.provider-models-panel {
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: color-mix(in srgb, var(--bg-secondary) 72%, var(--bg-tertiary));
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
  padding: 14px 16px;
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
  gap: 3px;
}

.provider-models-toggle-meta {
  gap: 10px;
  color: var(--text-secondary);
}

.provider-models-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
}

.provider-field-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
}

.provider-models-subtitle {
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.provider-models-summary {
  font-size: 11px;
  font-weight: 600;
}

.provider-models-body {
  padding: 0 16px 16px;
}

.models-toggle-open {
  transform: rotate(180deg);
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

.dynamic-chip {
  background: rgba(var(--accent-rgb, 74, 158, 255), 0.15) !important;
  border-color: var(--accent-color) !important;
  color: var(--accent-color) !important;
}

.model-checkbox-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-primary) 88%, transparent);
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

.model-checkbox-main {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  flex: 1;
  cursor: pointer;
}

.model-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.model-caption,
.model-summary {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
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

.model-options-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.model-options-btn:hover {
  border-color: var(--accent-color);
  color: var(--text-primary);
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 900px) {
  .model-checkbox-item {
    align-items: stretch;
    flex-direction: column;
  }

  .model-options-btn {
    width: 100%;
    justify-content: center;
  }
}
</style>
