<template>
  <section class="config-section providers-section">
    <div class="providers-toolbar">
      <div class="providers-search">
        <input
          type="text"
          v-model="providerSearchQuery"
          :placeholder="t('settings.providers.searchPlaceholder')"
          :aria-label="t('a11y.searchProviders')"
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
      <ProvidersSidebar
        :sidebar-providers="sidebarProviders"
        :selected-provider-id="selectedProviderId"
        :is-provider-configured="isProviderConfigured"
        @select-provider="selectProvider"
      />

      <ProviderEditorPanel
        v-if="showProviderEditor && editingProvider"
        :editing-provider="editingProvider"
        :provider-type-options="providerTypeOptions"
        :editing-provider-api-format="editingProviderApiFormat"
        @cancel="cancelCustomProvider"
        @save="saveProvider"
        @update:type="updateEditingProviderTypeSelection"
        @update:api-format="updateEditingProviderApiFormatSelection"
      />

      <ProviderDetailsPane
        v-else
        :selected-provider-id="selectedProviderId"
        :active-options-model-id="
          modelOptionsEditor?.providerId === selectedProviderId ? modelOptionsEditor.modelId : null
        "
        :selected-provider-info="selectedProviderInfo"
        :selected-provider-draft="selectedProviderDraft"
        :selected-provider-support-link="selectedProviderSupportLink"
        :selected-provider-base-url-help="selectedProviderBaseUrlHelp"
        :selected-provider-requires-api-key="selectedProviderRequiresApiKey"
        :models-panel-open="modelsPanelOpen"
        :is-fetching-models="isFetchingModels"
        :available-models-list="availableModelsList"
        :selected-models-list="selectedModelsList"
        :has-dynamic-models="hasDynamicModels"
        :is-selected-provider-dirty="isSelectedProviderDirty"
        :can-save-selected-provider="canSaveSelectedProvider"
        :has-persisted-config="Boolean(selectedProviderConfig)"
        @toggle-enabled="setSelectedProviderEnabled"
        @toggle-api-key-visibility="toggleSelectedProviderApiKeyVisibility"
        @toggle-models-panel="toggleModelsPanel"
        @fetch-models="fetchLatestModels"
        @toggle-model="toggleModel"
        @edit-model-options="openModelOptionsEditor"
        @cancel-model-options="closeModelOptionsEditor"
        @save-model-options="saveModelOptions"
        @add-model="addModel"
        @reset-draft="resetSelectedProviderDraft"
        @save-config="saveProviderConfig"
        @remove-config="removeProviderConfig"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue';

import ProviderDetailsPane from './providers/ProviderDetailsPane.vue';
import ProviderEditorPanel from './providers/ProviderEditorPanel.vue';
import ProvidersSidebar from './providers/ProvidersSidebar.vue';
import { useProvidersSettings } from '../../composables/useProvidersSettings';

const {
  addCustomProvider,
  addModel,
  availableModelsList,
  cancelCustomProvider,
  canSaveSelectedProvider,
  closeModelOptionsEditor,
  editingProvider,
  editingProviderApiFormat,
  fetchLatestModels,
  flushPendingProviderDraft,
  hasDynamicModels,
  isFetchingModels,
  isProviderConfigured,
  isSelectedProviderDirty,
  modelOptionsEditor,
  modelsPanelOpen,
  openModelOptionsEditor,
  providerSearchQuery,
  providerTypeOptions,
  removeProviderConfig,
  resetSelectedProviderDraft,
  saveModelOptions,
  saveProvider,
  saveProviderConfig,
  selectedModelsList,
  selectedProviderBaseUrlHelp,
  selectedProviderConfig,
  selectedProviderDraft,
  selectedProviderId,
  selectedProviderInfo,
  selectedProviderRequiresApiKey,
  selectedProviderSupportLink,
  selectProvider,
  setSelectedProviderEnabled,
  showProviderEditor,
  sidebarProviders,
  t,
  toggleModel,
  toggleModelsPanel,
  toggleSelectedProviderApiKeyVisibility,
  updateEditingProviderApiFormatSelection,
  updateEditingProviderTypeSelection,
} = useProvidersSettings();

const PROVIDER_DRAFT_FLUSH_EVENT = 'iki:providers:flush-draft';
const PROVIDER_DRAFT_DIRTY_EVENT = 'iki:providers:draft-dirty';

const emitDraftDirty = (dirty: boolean) => {
  window.dispatchEvent(new CustomEvent(PROVIDER_DRAFT_DIRTY_EVENT, { detail: { dirty } }));
};

watch(isSelectedProviderDirty, dirty => {
  emitDraftDirty(dirty);
});

onMounted(() => {
  window.addEventListener(PROVIDER_DRAFT_FLUSH_EVENT, handleFlushRequest);
  emitDraftDirty(isSelectedProviderDirty.value);
});

onBeforeUnmount(() => {
  window.removeEventListener(PROVIDER_DRAFT_FLUSH_EVENT, handleFlushRequest);
  emitDraftDirty(false);
});

const handleFlushRequest = (event: Event) => {
  const detail = (event as CustomEvent<{ resolve?: (saved: boolean) => void }>).detail;
  void (async () => {
    const saved = await flushPendingProviderDraft();
    detail?.resolve?.(saved);
  })();
};

defineExpose({ flushPendingProviderDraft });
</script>

<style scoped src="./providers_settings.css"></style>
<style scoped src="./settings_shared.css"></style>
