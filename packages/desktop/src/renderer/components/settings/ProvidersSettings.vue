<template>
  <section class="config-section providers-section">
    <div class="providers-toolbar">
      <div class="providers-search">
        <input
          type="text"
          v-model="providerSearchQuery"
          :placeholder="t('settings.providers.searchPlaceholder')"
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

      <ProviderDetailsPane
        :selected-provider-info="selectedProviderInfo"
        :selected-provider-draft="selectedProviderDraft"
        :selected-provider-support-link="selectedProviderSupportLink"
        :selected-provider-base-url-help="selectedProviderBaseUrlHelp"
        :selected-provider-requires-api-key="selectedProviderRequiresApiKey"
        :is-selected-acp-provider="isSelectedAcpProvider"
        :acp-credential-provider-options="acpCredentialProviderOptions"
        :acp-mcp-server-entries="acpMcpServerEntries"
        :mcp-servers-loading="mcpServersLoading"
        :mcp-servers-error="mcpServersError"
        :acp-auth-methods="acpAuthMethods"
        :is-fetching-acp-auth-methods="isFetchingAcpAuthMethods"
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
        @update-acp-api-provider-id="updateSelectedAcpApiProviderId"
        @update-acp-auth-method-id="updateSelectedAcpAuthMethodId"
        @toggle-acp-mcp-server="toggleSelectedAcpMcpServer($event.serverId, $event.checked)"
        @toggle-models-panel="toggleModelsPanel"
        @fetch-models="fetchLatestModels"
        @fetch-acp-auth-methods="fetchAcpAuthMethods"
        @toggle-model="toggleModel"
        @edit-model-options="openModelOptionsEditor"
        @add-model="addModel"
        @reset-draft="resetSelectedProviderDraft"
        @save-config="saveProviderConfig"
        @remove-config="removeProviderConfig"
      />
    </div>

    <ProviderEditorModal
      v-if="showProviderEditor && editingProvider"
      :editing-provider="editingProvider"
      :provider-type-options="providerTypeOptions"
      :editing-provider-api-format="editingProviderApiFormat"
      @cancel="showProviderEditor = false"
      @save="saveProvider"
      @update:type="updateEditingProviderTypeSelection"
      @update:api-format="updateEditingProviderApiFormatSelection"
    />

    <ProviderModelOptionsModal
      v-if="modelOptionsEditor && selectedProviderDraft"
      :provider-id="modelOptionsEditor.providerId"
      :model-id="modelOptionsEditor.modelId"
      :model-options="selectedProviderDraft.model_options[modelOptionsEditor.modelId] || null"
      @cancel="closeModelOptionsEditor"
      @save="saveModelOptions"
    />
  </section>
</template>

<script setup lang="ts">
import ProviderModelOptionsModal from './providers/ProviderModelOptionsModal.vue';
import ProviderDetailsPane from './providers/ProviderDetailsPane.vue';
import ProviderEditorModal from './providers/ProviderEditorModal.vue';
import ProvidersSidebar from './providers/ProvidersSidebar.vue';
import { useProvidersSettings } from '../../composables/useProvidersSettings';

const {
  acpAuthMethods,
  acpCredentialProviderOptions,
  acpMcpServerEntries,
  addCustomProvider,
  addModel,
  availableModelsList,
  canSaveSelectedProvider,
  closeModelOptionsEditor,
  editingProvider,
  editingProviderApiFormat,
  fetchAcpAuthMethods,
  fetchLatestModels,
  hasDynamicModels,
  isFetchingAcpAuthMethods,
  isFetchingModels,
  isProviderConfigured,
  isSelectedAcpProvider,
  isSelectedProviderDirty,
  mcpServersError,
  mcpServersLoading,
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
  toggleSelectedAcpMcpServer,
  toggleSelectedProviderApiKeyVisibility,
  updateEditingProviderApiFormatSelection,
  updateEditingProviderTypeSelection,
  updateSelectedAcpApiProviderId,
  updateSelectedAcpAuthMethodId,
} = useProvidersSettings();
</script>

<style scoped src="./settings_shared.css"></style>
<style src="./providers_settings.css"></style>
