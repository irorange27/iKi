<template>
  <div class="model-options-inline">
    <div class="model-options-inline-header">
      <h4 class="model-options-inline-title">
        {{ t('settings.providers.modelOptions.title', { model: props.modelId }) }}
      </h4>
    </div>

    <div class="model-options-grid">
      <label class="input-label">
        {{ t('settings.providers.modelOptions.displayName') }}
        <input
          type="text"
          v-model="editor.displayName"
          :placeholder="t('settings.providers.modelOptions.displayNamePlaceholder')"
        />
      </label>

      <label class="input-label">
        {{ t('settings.providers.modelOptions.contextWindow') }}
        <input
          type="number"
          min="1"
          step="1"
          v-model="editor.contextWindow"
          :placeholder="t('settings.providers.modelOptions.autoPlaceholder')"
        />
      </label>

      <label class="input-label">
        {{ t('settings.providers.modelOptions.maxInputTokens') }}
        <input
          type="number"
          min="1"
          step="1"
          v-model="editor.maxInputTokens"
          :placeholder="t('settings.providers.modelOptions.autoPlaceholder')"
        />
      </label>

      <label class="input-label">
        {{ t('settings.providers.modelOptions.maxOutputTokens') }}
        <input
          type="number"
          min="1"
          step="1"
          v-model="editor.maxOutputTokens"
          :placeholder="t('settings.providers.modelOptions.autoPlaceholder')"
        />
      </label>

      <label class="input-label">
        {{ t('settings.providers.modelOptions.supportsToolCalls') }}
        <SettingsSelect
          :model-value="editor.supportsToolCalls"
          :options="modelCapabilityOverrideOptions"
          :aria-label="t('settings.providers.modelOptions.supportsToolCalls')"
          @update:model-value="updateModelCapabilityOverride('supportsToolCalls', $event)"
        />
      </label>

      <label class="input-label">
        {{ t('settings.providers.modelOptions.supportsReasoning') }}
        <SettingsSelect
          :model-value="editor.supportsReasoning"
          :options="modelCapabilityOverrideOptions"
          :aria-label="t('settings.providers.modelOptions.supportsReasoning')"
          @update:model-value="updateModelCapabilityOverride('supportsReasoning', $event)"
        />
      </label>

      <label class="input-label">
        {{ t('settings.providers.modelOptions.supportsVision') }}
        <SettingsSelect
          :model-value="editor.supportsVision"
          :options="modelCapabilityOverrideOptions"
          :aria-label="t('settings.providers.modelOptions.supportsVision')"
          @update:model-value="updateModelCapabilityOverride('supportsVision', $event)"
        />
      </label>

      <label class="input-label">
        {{ t('settings.providers.modelOptions.supportsStructuredOutputs') }}
        <SettingsSelect
          :model-value="editor.supportsStructuredOutputs"
          :options="modelCapabilityOverrideOptions"
          :aria-label="t('settings.providers.modelOptions.supportsStructuredOutputs')"
          @update:model-value="
            updateModelCapabilityOverride('supportsStructuredOutputs', $event)
          "
        />
      </label>

      <label class="input-label model-options-json-field">
        {{ t('settings.providers.modelOptions.providerOptions') }}
        <textarea
          v-model="editor.providerOptionsJson"
          :placeholder="t('settings.providers.modelOptions.providerOptionsPlaceholder')"
          rows="5"
        ></textarea>
      </label>

      <p class="provider-field-help model-options-help">
        {{ t('settings.providers.modelOptions.providerOptionsHelp') }}
      </p>
      <p v-if="errorMessage" class="provider-field-help model-options-error">
        {{ errorMessage }}
      </p>
    </div>

    <div class="model-options-inline-actions">
      <button type="button" class="secondary-btn" @click="$emit('cancel')">
        {{ t('common.cancel') }}
      </button>
      <button type="button" class="primary-btn" @click="save">
        {{ t('common.save') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type { ProviderModelOptions } from '@iki/core/types/provider';
import { useI18n } from '../../../i18n';
import {
  buildProviderModelOptions,
  createModelOptionsEditorState,
  type ModelBooleanOverride,
  type ModelOptionsEditorState,
} from '../../../modules/providers/provider_model_options';
import SettingsSelect from '../SettingsSelect.vue';

const props = defineProps<{
  providerId: string;
  modelId: string;
  modelOptions?: ProviderModelOptions | null;
}>();

const emit = defineEmits<{
  cancel: [];
  save: [
    payload: {
      providerId: string;
      modelId: string;
      options: ProviderModelOptions | null;
    },
  ];
}>();

const { t } = useI18n();

const editor = ref<ModelOptionsEditorState>(
  createModelOptionsEditorState(props.providerId, props.modelId, props.modelOptions)
);

watch(
  () => [props.providerId, props.modelId, props.modelOptions] as const,
  ([providerId, modelId, modelOptions]) => {
    editor.value = createModelOptionsEditorState(providerId, modelId, modelOptions);
  }
);

const modelCapabilityOverrideOptions = computed(() => [
  { value: 'default', label: t('settings.providers.modelOptions.capability.default') },
  { value: 'true', label: t('settings.providers.modelOptions.capability.enabled') },
  { value: 'false', label: t('settings.providers.modelOptions.capability.disabled') },
]);

const errorMessage = computed(() => {
  if (!editor.value.errorCode) return '';
  return t(`settings.providers.modelOptions.errors.${editor.value.errorCode}`);
});

const updateModelCapabilityOverride = (
  field: 'supportsToolCalls' | 'supportsReasoning' | 'supportsVision' | 'supportsStructuredOutputs',
  value: string
) => {
  editor.value = {
    ...editor.value,
    [field]: value as ModelBooleanOverride,
    errorCode: undefined,
  };
};

const save = () => {
  const result = buildProviderModelOptions(editor.value);
  if (result.errorCode) {
    editor.value = {
      ...editor.value,
      errorCode: result.errorCode,
    };
    return;
  }

  emit('save', {
    providerId: props.providerId,
    modelId: props.modelId,
    options: Object.keys(result.options).length > 0 ? result.options : null,
  });
};
</script>

<style scoped src="../settings_shared.css"></style>

<style scoped>
.model-options-inline {
  margin: 4px 0 8px;
  padding: 14px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--border-color) 60%, transparent);
  background: color-mix(in srgb, var(--bg-primary) 72%, var(--bg-secondary));
}

.model-options-inline-header {
  margin-bottom: 10px;
}

.model-options-inline-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.model-options-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
}

.model-options-grid .input-label {
  padding: 6px 0;
  border-bottom: none;
}

.model-options-json-field,
.model-options-help,
.model-options-error {
  grid-column: 1 / -1;
}

.model-options-json-field textarea {
  min-height: 110px;
  resize: vertical;
}

.provider-field-help {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.model-options-error {
  color: var(--danger-color);
}

.model-options-inline-actions {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 45%, transparent);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 720px) {
  .model-options-grid {
    grid-template-columns: 1fr;
  }
}
</style>
