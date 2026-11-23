<template>
  <div class="provider-details-panel provider-inline-editor">
    <div class="provider-header provider-card-header">
      <div class="provider-heading">
        <div class="provider-title-row">
          <h3>
            {{
              editingProvider.id.startsWith('custom_')
                ? t('settings.providers.modal.edit')
                : t('settings.providers.modal.add')
            }}
            {{ t('settings.providers.modal.titleSuffix') }}
          </h3>
        </div>
      </div>

      <button type="button" class="secondary-btn" @click="emit('cancel')">
        {{ t('common.cancel') }}
      </button>
    </div>

    <div class="provider-details-scroll">
      <div class="provider-config-form">
        <div class="provider-config-group provider-form-stack">
          <label class="input-label">
            {{ t('common.name') }}
            <input
              type="text"
              v-model="editingProvider.name"
              :placeholder="t('settings.providers.modal.namePlaceholder')"
            />
          </label>

          <label class="input-label">
            {{ t('common.type') }}
            <SettingsSelect
              :model-value="editingProvider.type"
              :options="providerTypeOptions"
              :aria-label="t('settings.providers.modal.typeAria')"
              @update:model-value="emit('update:type', String($event || ''))"
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
              @update:model-value="emit('update:api-format', String($event || ''))"
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

          <label class="input-label">
            {{ t('settings.providers.apiKey') }}
            <input
              type="password"
              v-model="editingProvider.apiKey"
              :placeholder="t('settings.providers.modal.apiKeyPlaceholder')"
            />
          </label>

          <label class="input-label">
            {{ t('settings.providers.modal.baseUrl') }}
            <input
              type="text"
              v-model="editingProvider.baseUrl"
              :placeholder="t('settings.providers.modal.baseUrlPlaceholder')"
            />
          </label>

          <label class="input-label">
            {{ t('settings.providers.modal.models') }}
            <input
              type="text"
              v-model="editingProvider.models"
              :placeholder="t('settings.providers.modal.modelsPlaceholder')"
            />
          </label>
        </div>
      </div>
    </div>

    <div class="provider-card-actions">
      <button type="button" class="secondary-btn" @click="emit('cancel')">
        {{ t('common.cancel') }}
      </button>
      <button type="button" class="primary-btn" @click="emit('save')">
        {{ t('settings.providers.modal.save') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import SettingsSelect from '../SettingsSelect.vue';
import { useI18n } from '../../../i18n';
import type {
  EditableProvider,
  EditableProviderApiFormat,
  ProviderSelectOption,
} from './provider_settings_shared';

defineProps<{
  editingProvider: EditableProvider;
  providerTypeOptions: ProviderSelectOption[];
  editingProviderApiFormat: EditableProviderApiFormat | null;
}>();

const emit = defineEmits<{
  cancel: [];
  save: [];
  'update:type': [value: string];
  'update:api-format': [value: string];
}>();

const { t } = useI18n();
</script>

<style scoped src="../providers_settings.css"></style>
<style scoped src="../settings_shared.css"></style>
