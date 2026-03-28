<template>
  <div class="modal-overlay">
    <div class="modal-content provider-editor model-options-editor">
      <div class="provider-editor-header">
        <h3>{{ t('settings.providers.modelOptions.title', { model: props.modelId }) }}</h3>
      </div>

      <div class="provider-editor-scroll">
        <div class="provider-config-group model-options-grid">
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
              rows="8"
            ></textarea>
          </label>

          <p class="provider-field-help model-options-help">
            {{ t('settings.providers.modelOptions.providerOptionsHelp') }}
          </p>
          <p v-if="errorMessage" class="provider-field-help model-options-error">
            {{ errorMessage }}
          </p>
        </div>
      </div>

      <div class="modal-footer provider-editor-footer">
        <button class="secondary-btn" @click="$emit('cancel')">
          {{ t('common.cancel') }}
        </button>
        <button class="primary-btn" @click="save">
          {{ t('common.save') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type { ProviderModelOptions } from '../../../../shared/types/provider';
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
  (event: 'cancel'): void;
  (
    event: 'save',
    payload: {
      providerId: string;
      modelId: string;
      options: ProviderModelOptions | null;
    }
  ): void;
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

.provider-config-group {
  margin-bottom: 32px;
}

.provider-field-help {
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
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

.model-options-editor {
  max-width: 720px;
}

.model-options-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.model-options-json-field,
.model-options-help,
.model-options-error {
  grid-column: 1 / -1;
}

.model-options-json-field textarea {
  min-height: 180px;
  resize: vertical;
}

.model-options-help {
  margin: -8px 0 0;
}

.model-options-error {
  margin: 0;
  color: var(--accent-color);
}

@media (max-width: 900px) {
  .model-options-grid {
    grid-template-columns: 1fr;
  }
}
</style>
