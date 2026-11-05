<template>
  <div ref="modelSelectorRef" class="relative">
    <button
      class="model-selector-trigger"
      :class="{ 'model-selector-trigger-open': showModelSelector }"
      type="button"
      :title="triggerTitle"
      :aria-label="triggerTitle"
      @click="toggleModelSelector"
    >
      <span class="model-selector-trigger-icon">
        <LobeIcon
          v-if="selectedProvider"
          v-bind="selectedProviderIconProps"
          :size="14"
          class-name="model-selector-provider-icon"
        />
        <span v-else class="model-selector-trigger-initials">
          {{ selectedProviderFallbackText }}
        </span>
      </span>
      <span class="model-selector-trigger-label">
        {{ selectedModel || t('chat.model.selectModel') }}
      </span>
      <svg
        class="model-selector-trigger-chevron"
        :class="{ 'rotate-180': showModelSelector }"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <div v-if="showModelSelector" class="model-selector-panel" :style="panelStyle">
      <!-- Root pane (DSH ModelSelect): drill-in cells for the run settings that
       do not deserve their own toolbar controls. -->
      <div v-if="pane === 'root'" class="model-menu-cells">
        <button type="button" class="model-menu-cell" @click="openPane('model')">
          <span class="model-menu-cell-label">{{ t('chat.model.menuModel') }}</span>
          <span class="model-menu-cell-value">{{ selectedModel || t('chat.model.selectModel') }}</span>
          <svg
            class="model-menu-cell-chevron"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <button type="button" class="model-menu-cell" @click="openPane('effort')">
          <span class="model-menu-cell-label">{{ t('chat.reasoning.title') }}</span>
          <span class="model-menu-cell-value">{{ reasoningEffortLabel }}</span>
          <svg
            class="model-menu-cell-chevron"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      <template v-else>
        <div class="model-pane-header">
          <button type="button" class="model-pane-back" @click="openPane('root')">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
            {{ t('chat.model.menuBack') }}
          </button>
          <span class="model-pane-title">{{ paneTitle }}</span>
        </div>

        <!-- Model pane: search + grouped provider list (as before). -->
        <template v-if="pane === 'model'">
          <div class="model-selector-search-shell">
            <svg
              class="model-selector-search-icon"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M21 21l-4.35-4.35m1.85-5.15a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              ref="modelSearchInputRef"
              v-model="modelSearchQuery"
              type="text"
              class="model-selector-search-input"
              :aria-label="t('a11y.searchModels')"
              :placeholder="t('chat.model.searchPlaceholder')"
            />
          </div>

          <div class="model-selector-scroll">
            <div
              v-if="availableProviders.length === 0"
              class="selector-empty-state model-selector-empty"
            >
              {{ t('chat.model.noProviders') }}
            </div>
            <div
              v-else-if="providerModelGroups.length === 0"
              class="selector-empty-state model-selector-empty"
            >
              {{ t('chat.model.noProviderMetadata') }}
            </div>
            <div
              v-else-if="filteredProviderGroups.length === 0"
              class="selector-empty-state model-selector-empty"
            >
              {{ t('chat.model.noMatchingModels', { query: modelSearchQuery.trim() }) }}
            </div>
            <section
              v-for="group in filteredProviderGroups"
              :key="group.id"
              class="model-provider-group"
            >
              <header class="model-provider-header">
                <span class="model-provider-icon">
                  <LobeIcon v-bind="group.iconProps" :size="14" class-name="model-selector-provider-icon" />
                </span>
                <div class="model-provider-copy">
                  <span class="model-provider-name">{{ group.name }}</span>
                  <span class="model-provider-type">{{ group.typeLabel }}</span>
                </div>
              </header>

              <!-- A provider saved in settings but with no model enabled yet must
                   stay listed, otherwise it can never be picked from here. -->
              <p
                v-if="group.models.length === 0"
                class="model-provider-empty"
              >
                {{ t('chat.model.noModelsForProvider') }}
              </p>

              <button
                v-for="model in group.models"
                :key="`${group.id}:${model}`"
                class="model-option"
                :class="{
                  'model-option-selected': isSelectedProviderModel(group.provider.id, model),
                }"
                type="button"
                :title="model"
                @click="selectProviderAndModel(group.provider, model)"
              >
                <span class="model-option-name">{{ model }}</span>
                <span
                  v-if="isSelectedProviderModel(group.provider.id, model)"
                  class="model-option-check"
                >
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </span>
              </button>
            </section>
          </div>
        </template>

        <!-- Reasoning-effort pane: radio rows, check marks the live value. -->
        <template v-else-if="pane === 'effort'">
          <p class="model-pane-note">{{ t('chat.reasoning.description') }}</p>
          <div class="model-selector-scroll model-selector-scroll--flush">
            <button
              v-for="option in effortOptions"
              :key="option.value"
              class="model-option"
              :class="{ 'model-option-selected': reasoningEffort === option.value }"
              type="button"
              role="radio"
              :aria-checked="reasoningEffort === option.value"
              @click="selectEffort(option.value)"
            >
              <span class="model-option-name">{{ option.label }}</span>
              <span v-if="reasoningEffort === option.value" class="model-option-check">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </span>
            </button>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import type { Provider } from '@iki/core/types/provider';
import { useI18n } from '../i18n';
import {
  getProviderDisplayName,
  getProviderFallbackText,
} from '../modules/providers/provider_display';
import {
  getProviderIconProps,
  type ProviderIconProps,
} from '../modules/providers/provider_icons';
import LobeIcon from './Icon/LobeIcon.vue';

type ProviderModelGroup = {
  id: string;
  provider: Provider;
  name: string;
  typeLabel: string;
  iconProps: ProviderIconProps;
  models: string[];
  providerSearchText: string;
};

const props = defineProps<{
  availableProviders: Provider[];
  selectedProvider: Provider | null;
  selectedModel: string;
  reasoningEffort?: string;
}>();

const emit = defineEmits<{
  select: [payload: {
      provider: Provider;
      model: string;
    }];
  'update:reasoningEffort': [value: string];
}>();

const { t } = useI18n();
const modelSelectorRef = ref<HTMLElement | null>(null);
const modelSearchInputRef = ref<HTMLInputElement | null>(null);
const showModelSelector = ref(false);
const modelSearchQuery = ref('');

type ModelMenuPane = 'root' | 'model' | 'effort';
const pane = ref<ModelMenuPane>('root');

const openPane = async (next: ModelMenuPane) => {
  pane.value = next;
  if (next === 'model') {
    await nextTick();
    modelSearchInputRef.value?.focus();
    modelSearchInputRef.value?.select();
  }
};

const effortOptions = computed(() => [
  { value: '', label: t('chat.reasoning.default') },
  { value: 'low', label: t('chat.reasoning.low') },
  { value: 'medium', label: t('chat.reasoning.medium') },
  { value: 'high', label: t('chat.reasoning.high') },
]);

const reasoningEffortLabel = computed(() => {
  const effort = props.reasoningEffort ?? '';
  return effortOptions.value.find(option => option.value === effort)?.label ?? t('chat.reasoning.default');
});

const paneTitle = computed(() => {
  if (pane.value === 'model') return t('chat.model.menuModel');
  return t('chat.reasoning.title');
});

const selectEffort = (value: string) => {
  emit('update:reasoningEffort', value);
};

const providerModelGroups = computed<ProviderModelGroup[]>(() =>
  props.availableProviders
    .map(provider => {
      const name = getProviderDisplayName(provider);
      const typeLabel = provider.type?.trim() || 'custom';

      return {
        id: provider.id,
        provider,
        name,
        typeLabel,
        iconProps: getProviderIconProps(provider),
        models: provider.models,
        providerSearchText: `${name} ${typeLabel}`.toLowerCase(),
      };
    })
);

const filteredProviderGroups = computed<ProviderModelGroup[]>(() => {
  const query = modelSearchQuery.value.trim().toLowerCase();
  if (!query) return providerModelGroups.value;

  return providerModelGroups.value
    .map(group => {
      const matchesProvider = group.providerSearchText.includes(query);
      if (matchesProvider) return group;
      return {
        ...group,
        models: group.models.filter(model => model.toLowerCase().includes(query)),
      };
    })
    .filter(
      group =>
        group.models.length > 0 || group.providerSearchText.includes(query)
    );
});

const selectedProviderIconProps = computed<ProviderIconProps | null>(() =>
  props.selectedProvider ? getProviderIconProps(props.selectedProvider) : null
);

const selectedProviderFallbackText = computed(() =>
  getProviderFallbackText(props.selectedProvider)
);

const triggerTitle = computed(() => {
  if (props.selectedProvider && props.selectedModel.trim().length > 0) {
    return `${getProviderDisplayName(props.selectedProvider)} · ${props.selectedModel}`;
  }
  return t('chat.model.trigger.choose');
});

const closeModelSelector = () => {
  showModelSelector.value = false;
  pane.value = 'root';
  modelSearchQuery.value = '';
};

const toggleModelSelector = () => {
  showModelSelector.value = !showModelSelector.value;
  if (!showModelSelector.value) {
    pane.value = 'root';
    modelSearchQuery.value = '';
    panelMaxWidth.value = null;
    return;
  }
  pane.value = 'root';
  refreshPanelBounds();
};

const panelMaxWidth = ref<number | null>(null);
const panelStyle = computed(() =>
  panelMaxWidth.value ? { maxWidth: `${panelMaxWidth.value}px` } : undefined
);

const refreshPanelBounds = () => {
  if (!showModelSelector.value) return;
  const rect = modelSelectorRef.value?.getBoundingClientRect();
  if (rect) {
    panelMaxWidth.value = Math.max(240, Math.min(380, rect.right - 8, window.innerWidth - 24));
  }
};

watch([pane, showModelSelector], () => {
  void nextTick(refreshPanelBounds);
});

const handleWindowResizeForPanel = () => {
  refreshPanelBounds();
};

onMounted(() => {
  window.addEventListener('resize', handleWindowResizeForPanel);
});

onUnmounted(() => {
  window.removeEventListener('resize', handleWindowResizeForPanel);
});

const isSelectedProviderModel = (providerId: string, model: string) =>
  props.selectedProvider?.id === providerId && props.selectedModel === model;

const selectProviderAndModel = (provider: Provider, model: string) => {
  closeModelSelector();
  emit('select', { provider, model });
};

const handleDocumentPointerDown = (event: MouseEvent) => {
  if (!showModelSelector.value) return;
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (modelSelectorRef.value?.contains(target)) return;
  closeModelSelector();
};

const handleDocumentKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || !showModelSelector.value) return;
  closeModelSelector();
};

onMounted(() => {
  document.addEventListener('mousedown', handleDocumentPointerDown);
  document.addEventListener('keydown', handleDocumentKeydown);
});

onUnmounted(() => {
  document.removeEventListener('mousedown', handleDocumentPointerDown);
  document.removeEventListener('keydown', handleDocumentKeydown);
});
</script>

<style scoped src="./chat_model_selector.css"></style>
