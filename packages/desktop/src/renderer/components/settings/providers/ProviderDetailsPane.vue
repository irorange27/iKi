<template>
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
              @change="emit('toggle-enabled', ($event.target as HTMLInputElement).checked)"
            />
            <span class="provider-switch-track">
              <span class="provider-switch-thumb"></span>
            </span>
          </label>
        </div>
      </div>

      <div class="provider-details-scroll">
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
                    :aria-label="
                      selectedProviderDraft.showApiKey ? t('a11y.hideApiKey') : t('a11y.showApiKey')
                    "
                    :aria-pressed="selectedProviderDraft.showApiKey"
                    :title="
                      selectedProviderDraft.showApiKey ? t('a11y.hideApiKey') : t('a11y.showApiKey')
                    "
                    @click="emit('toggle-api-key-visibility')"
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
                  :placeholder="selectedProviderInfo.defaultBaseUrl || 'https://api.example.com/v1'"
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
              :has-dynamic-models="hasDynamicModels"
              @toggle-open="emit('toggle-models-panel')"
              @fetch-models="emit('fetch-models')"
              @toggle-model="emit('toggle-model', $event)"
              @edit-model-options="emit('edit-model-options', $event)"
              @add-model="emit('add-model', $event)"
            />
          </div>
        </div>
      </div>

      <div class="provider-card-actions">
        <button v-if="hasPersistedConfig" class="danger-btn" @click="emit('remove-config')">
          {{ t('common.delete') }}
        </button>
        <button class="secondary-btn" @click="emit('reset-draft')" :disabled="!isSelectedProviderDirty">
          {{ t('common.cancel') }}
        </button>
        <button class="primary-btn" @click="emit('save-config')" :disabled="!canSaveSelectedProvider">
          {{ t('common.save') }}
        </button>
      </div>
    </template>

    <div v-else class="no-selection">
      <p>{{ t('settings.providers.noSelection') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { BookOpen, ExternalLink, Eye, EyeOff } from 'lucide-vue-next';

import ProviderModelsPanel from './ProviderModelsPanel.vue';
import { useI18n } from '../../../i18n';
import type { ProviderDraft } from '../../../composables/useProviderDrafts';
import type { BuiltInProvider } from '@iki/backend/types/settings';
import type { ProviderSupportLink } from './provider_settings_shared';

defineProps<{
  selectedProviderInfo: BuiltInProvider | null;
  selectedProviderDraft: ProviderDraft | null;
  selectedProviderSupportLink: ProviderSupportLink | null;
  selectedProviderBaseUrlHelp: string;
  selectedProviderRequiresApiKey: boolean;
  modelsPanelOpen: boolean;
  isFetchingModels: boolean;
  availableModelsList: string[];
  selectedModelsList: string[];
  hasDynamicModels: boolean;
  isSelectedProviderDirty: boolean;
  canSaveSelectedProvider: boolean;
  hasPersistedConfig: boolean;
}>();

const emit = defineEmits<{
  'toggle-enabled': [enabled: boolean];
  'toggle-api-key-visibility': [];
  'toggle-models-panel': [];
  'fetch-models': [];
  'toggle-model': [modelId: string];
  'edit-model-options': [modelId: string];
  'add-model': [payload: { modelId: string; displayName: string }];
  'reset-draft': [];
  'save-config': [];
  'remove-config': [];
}>();

const { t } = useI18n();
</script>

<style scoped src="../providers_settings.css"></style>
<style scoped src="../settings_shared.css"></style>
