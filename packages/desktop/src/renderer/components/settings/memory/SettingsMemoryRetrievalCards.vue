<template>
  <div class="settings-card">
    <div class="card-title">{{ t('settings.memory.retrievalTitle') }}</div>
    <label class="checkbox-label">
      <input
        type="checkbox"
        :checked="config.memory.enabled"
        @change="updateMemory('enabled', ($event.target as HTMLInputElement).checked)"
      />
      {{ t('settings.memory.enable') }}
    </label>
    <p class="card-help">{{ t('settings.memory.retrievalDescription') }}</p>

    <template v-if="config.memory.enabled">
      <div class="slider-field">
        <span>{{ t('settings.memory.maxRetrievedMemories') }}</span>
        <span class="value-badge">{{ config.memory.maxRetrievalCount }}</span>
      </div>
      <input
        type="range"
        min="1"
        max="20"
        :value="config.memory.maxRetrievalCount"
        @input="
          updateMemory('maxRetrievalCount', parseInt(($event.target as HTMLInputElement).value))
        "
      />
      <p class="slider-hint">{{ t('settings.memory.maxRetrievedHint') }}</p>

      <div class="slider-field">
        <span>{{ t('settings.memory.similarityThreshold') }}</span>
        <span class="value-badge">{{ Math.round(config.memory.similarThreshold * 100) }}%</span>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        :value="Math.round(config.memory.similarThreshold * 100)"
        @input="
          updateMemory(
            'similarThreshold',
            parseInt(($event.target as HTMLInputElement).value) / 100
          )
        "
      />
      <div class="slider-legend">
        <span>{{ t('settings.memory.loose') }}</span>
        <span>{{ t('settings.memory.strict') }}</span>
      </div>
      <p class="slider-hint">{{ t('settings.memory.similarityHint') }}</p>
    </template>
  </div>

  <div class="settings-card">
    <div class="card-title">{{ t('settings.memory.summarizationTitle') }}</div>
    <label class="checkbox-label">
      <input
        type="checkbox"
        :checked="config.memory.autoSummarize"
        @change="updateMemory('autoSummarize', ($event.target as HTMLInputElement).checked)"
      />
      {{ t('settings.memory.autoSummarize') }}
    </label>
    <p class="card-help">{{ t('settings.memory.summarizationDescription') }}</p>
  </div>

  <div class="settings-card">
    <div class="card-title">{{ t('settings.memory.embeddingModelTitle') }}</div>
    <p class="card-help">{{ t('settings.memory.embeddingModelDescription') }}</p>

    <label class="input-label">
      <span>{{ t('settings.memory.embeddingModelSelect') }}</span>
      <SettingsSelect
        :model-value="selectedEmbeddingModelOptionValue"
        :options="embeddingModelSelectOptions"
        :aria-label="t('settings.memory.embeddingModelAria')"
        @update:model-value="updateEmbeddingModelSelection"
      />
    </label>

    <p class="slider-hint">{{ t('settings.memory.embeddingModelHint') }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';

import SettingsSelect from '../SettingsSelect.vue';
import { useI18n } from '../../../i18n';
import { useConfigStore } from '../../../store/config';
import type { AppConfig } from '@iki/core/types/config';
import type { Provider } from '@iki/core/types/provider';
import { listProviderEmbeddingModels } from '@iki/core/utils/memory_embedding_models';
import { getProviderDisplayName } from '../../../modules/providers/provider_display';

const emit = defineEmits<{
  (event: 'config-change'): void;
}>();

const props = withDefaults(
  defineProps<{
    providers?: Provider[];
  }>(),
  {
    providers: () => [],
  }
);

const AUTO_DETECT_EMBEDDING_MODEL_VALUE = '';

const { t } = useI18n();
const configStore = useConfigStore();
const { config } = storeToRefs(configStore);

const serializeEmbeddingModelSelection = (selection: AppConfig['memory']['embeddingModel']): string =>
  JSON.stringify([selection.providerId, selection.providerType, selection.model]);

const parseEmbeddingModelSelection = (
  value: string
): AppConfig['memory']['embeddingModel'] | null => {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;

    const [providerId, providerType, model] = parsed;
    if (
      typeof providerId !== 'string' ||
      typeof providerType !== 'string' ||
      typeof model !== 'string'
    ) {
      return null;
    }

    const trimmedProviderId = providerId.trim();
    const trimmedProviderType = providerType.trim();
    const trimmedModel = model.trim();
    if (!trimmedModel || (!trimmedProviderId && !trimmedProviderType)) {
      return null;
    }

    return {
      providerId: trimmedProviderId,
      providerType: trimmedProviderType,
      model: trimmedModel,
    };
  } catch {
    return null;
  }
};

const updateMemory = <K extends keyof AppConfig['memory']>(
  key: K,
  value: AppConfig['memory'][K]
) => {
  config.value.memory[key] = value;
  emit('config-change');
};

const selectedEmbeddingModelOptionValue = computed(() => {
  const selection = config.value.memory.embeddingModel;
  if (!selection.model.trim()) {
    return AUTO_DETECT_EMBEDDING_MODEL_VALUE;
  }

  return serializeEmbeddingModelSelection(selection);
});

const embeddingModelSelectOptions = computed(() => [
  {
    value: AUTO_DETECT_EMBEDDING_MODEL_VALUE,
    label: t('settings.memory.embeddingModelAutoDetect'),
  },
  ...props.providers
    .filter(provider => provider.enabled)
    .map(provider => {
      const embeddingModels = listProviderEmbeddingModels(provider);
      if (embeddingModels.length === 0) return null;

      return {
        label: getProviderDisplayName(provider),
        options: embeddingModels.map(model => ({
          value: serializeEmbeddingModelSelection({
            providerId: provider.id,
            providerType: provider.type,
            model,
          }),
          label: model,
        })),
      };
    })
    .filter((entry): entry is { label: string; options: Array<{ value: string; label: string }> } =>
      Boolean(entry)
    ),
]);

const updateEmbeddingModelSelection = (value: string) => {
  config.value.memory.embeddingModel =
    value === AUTO_DETECT_EMBEDDING_MODEL_VALUE
      ? {
          providerId: '',
          providerType: '',
          model: '',
        }
      : parseEmbeddingModelSelection(value) || config.value.memory.embeddingModel;
  emit('config-change');
};
</script>

<style scoped src="../settings_shared.css"></style>
