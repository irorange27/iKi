<template>
  <div ref="modelSelectorRef" class="relative">
    <button
      class="model-selector-trigger"
      :class="{ 'model-selector-trigger-open': showModelSelector }"
      type="button"
      @click="toggleModelSelector"
    >
      <span class="model-selector-trigger-icon">
        <LobeIcon
          v-if="selectedProvider"
          :name="selectedProviderIconName"
          :size="16"
          :fallback-text="selectedProviderFallbackText"
          class-name="model-selector-provider-icon"
        />
        <span v-else class="model-selector-trigger-initials">
          {{ selectedProviderFallbackText }}
        </span>
      </span>
      <span class="model-selector-trigger-label">
        {{ selectedModel || 'Select Model' }}
      </span>
      <svg
        class="model-selector-trigger-chevron"
        :class="{ 'rotate-180': showModelSelector }"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M19 9l-7 7-7-7"
        />
      </svg>
    </button>

    <div v-if="showModelSelector" class="model-selector-panel">
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
          placeholder="Search models..."
        />
      </div>

      <div class="model-selector-scroll">
        <div
          v-if="availableProviders.length === 0"
          class="selector-empty-state model-selector-empty"
        >
          No providers configured.
        </div>
        <div
          v-else-if="providerModelGroups.length === 0"
          class="selector-empty-state model-selector-empty"
        >
          No enabled provider exposes model metadata.
        </div>
        <div
          v-else-if="filteredProviderGroups.length === 0"
          class="selector-empty-state model-selector-empty"
        >
          No models match "{{ modelSearchQuery.trim() }}".
        </div>
        <section
          v-for="group in filteredProviderGroups"
          :key="group.id"
          class="model-provider-group"
        >
          <header class="model-provider-header selector-section-title">
            <span class="model-provider-icon">
              <LobeIcon
                :name="group.iconName"
                :size="16"
                :fallback-text="group.fallbackText"
                class-name="model-selector-provider-icon"
              />
            </span>
            <div class="model-provider-copy">
              <span class="model-provider-name">{{ group.name }}</span>
              <span class="model-provider-type">{{ group.typeLabel }}</span>
            </div>
          </header>

          <button
            v-for="model in group.models"
            :key="`${group.id}:${model}`"
            class="model-option"
            :class="{
              'model-option-selected': isSelectedProviderModel(group.provider.id, model),
            }"
            type="button"
            @click="selectProviderAndModel(group.provider, model)"
          >
            <div class="model-option-main">
              <span
                class="model-option-check"
                :class="{
                  'model-option-check-selected': isSelectedProviderModel(group.provider.id, model),
                }"
              >
                <svg
                  v-if="isSelectedProviderModel(group.provider.id, model)"
                  class="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2.2"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </span>
              <div class="model-option-copy">
                <span class="model-option-name">{{ model }}</span>
                <span class="model-option-meta">{{ group.name }} · {{ group.typeLabel }}</span>
              </div>
            </div>
            <span class="model-option-side">{{ group.typeLabel }}</span>
          </button>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';

import type { Provider } from '../../shared/types/provider';
import { parseModelList } from '../../shared/utils/provider_models';
import {
  getProviderDisplayName,
  getProviderFallbackText,
} from '../modules/providers/provider_display';
import { getProviderIconName } from '../modules/providers/provider_icons';
import LobeIcon from './Icon/LobeIcon.vue';

type ProviderModelGroup = {
  id: string;
  provider: Provider;
  name: string;
  typeLabel: string;
  iconName: string;
  fallbackText: string;
  models: string[];
  providerSearchText: string;
};

const props = defineProps<{
  availableProviders: Provider[];
  selectedProvider: Provider | null;
  selectedModel: string;
}>();

const emit = defineEmits<{
  (
    event: 'select',
    payload: {
      provider: Provider;
      model: string;
    }
  ): void;
}>();

const modelSelectorRef = ref<HTMLElement | null>(null);
const modelSearchInputRef = ref<HTMLInputElement | null>(null);
const showModelSelector = ref(false);
const modelSearchQuery = ref('');

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
        iconName: getProviderIconName(typeLabel),
        fallbackText: getProviderFallbackText(provider),
        models: parseModelList(provider.models),
        providerSearchText: `${name} ${typeLabel}`.toLowerCase(),
      };
    })
    .filter(group => group.models.length > 0)
);

const filteredProviderGroups = computed<ProviderModelGroup[]>(() => {
  const query = modelSearchQuery.value.trim().toLowerCase();
  if (!query) return providerModelGroups.value;

  return providerModelGroups.value
    .map(group => {
      const matchesProvider = group.providerSearchText.includes(query);
      return {
        ...group,
        models: matchesProvider
          ? group.models
          : group.models.filter(model => model.toLowerCase().includes(query)),
      };
    })
    .filter(group => group.models.length > 0);
});

const selectedProviderIconName = computed(() =>
  props.selectedProvider ? getProviderIconName(props.selectedProvider.type || '') : 'openai'
);

const selectedProviderFallbackText = computed(() =>
  getProviderFallbackText(props.selectedProvider)
);

const closeModelSelector = () => {
  showModelSelector.value = false;
  modelSearchQuery.value = '';
};

const toggleModelSelector = async () => {
  showModelSelector.value = !showModelSelector.value;
  if (!showModelSelector.value) {
    modelSearchQuery.value = '';
    return;
  }

  await nextTick();
  modelSearchInputRef.value?.focus();
  modelSearchInputRef.value?.select();
};

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

<style scoped>
.model-selector-trigger {
  display: inline-flex;
  max-width: min(220px, calc(100vw - 192px));
  height: 40px;
  align-items: center;
  gap: 10px;
  padding: 0 2px 0 6px;
  border: 1px solid transparent;
  background: transparent;
  box-shadow: none;
  color: var(--text-secondary);
}

.model-selector-trigger:hover {
  color: var(--text-primary);
}

.model-selector-trigger-open {
  color: var(--text-primary);
}

.model-selector-trigger-icon {
  display: inline-flex;
  height: 18px;
  width: 18px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 0;
  background: transparent;
  color: currentColor;
}

.model-selector-trigger-initials {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.model-selector-trigger-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 650;
  line-height: 1.2;
}

.model-selector-trigger-chevron {
  height: 16px;
  width: 16px;
  flex-shrink: 0;
  opacity: 0.7;
  transition: transform 0.18s ease;
}

.model-selector-panel {
  position: absolute;
  left: 0;
  bottom: calc(100% + 10px);
  z-index: 60;
  width: min(380px, calc(100vw - 32px));
  overflow: hidden;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
  background: color-mix(in srgb, var(--bg-secondary) 94%, transparent);
  box-shadow: var(--surface-shadow-lg);
  backdrop-filter: blur(18px);
}

.model-selector-search-shell {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
  background: color-mix(in srgb, var(--bg-tertiary) 88%, transparent);
}

.model-selector-search-icon {
  height: 18px;
  width: 18px;
  flex-shrink: 0;
  color: var(--text-muted);
}

.model-selector-search-input {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.4;
  outline: none;
}

.model-selector-search-input::placeholder {
  color: var(--text-muted);
}

.model-selector-scroll {
  max-height: 26rem;
  overflow-y: auto;
  padding: 8px;
}

.model-selector-empty {
  padding-top: 28px;
  padding-bottom: 28px;
}

.model-provider-group {
  padding: 4px 0 10px;
}

.model-provider-group + .model-provider-group {
  margin-top: 4px;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  padding-top: 14px;
}

.model-provider-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 6px;
}

.model-provider-icon {
  display: inline-flex;
  height: 16px;
  width: 16px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
}

.model-provider-copy,
.model-option-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.model-provider-copy {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

.model-provider-name {
  color: inherit;
}

.model-provider-type {
  font-size: inherit;
  font-weight: inherit;
  line-height: inherit;
  letter-spacing: 0.04em;
  text-transform: none;
  color: color-mix(in srgb, var(--text-muted) 92%, var(--text-primary));
}

.model-option {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 4px;
  padding: 12px 14px;
  border: 1px solid transparent;
  border-radius: 14px;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    transform 0.18s ease;
}

.model-option:hover:not(:disabled) {
  background: color-mix(in srgb, var(--bg-hover) 88%, transparent);
  border-color: color-mix(in srgb, var(--border-color) 78%, transparent);
}

.model-option-selected {
  background: rgba(var(--accent-rgb), 0.22);
  border-color: rgba(var(--accent-rgb), 0.34);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--chat-composer-action-foreground) 5%, transparent);
}

.model-option-main {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  align-items: flex-start;
  gap: 12px;
}

.model-option-check {
  display: inline-flex;
  height: 22px;
  width: 22px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--border-color) 88%, transparent);
  background: color-mix(in srgb, var(--text-primary) 2%, transparent);
  color: transparent;
  transition:
    background-color 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease;
}

.model-option-check-selected {
  border-color: rgba(var(--accent-rgb), 0.44);
  background: rgba(var(--accent-rgb), 0.88);
  color: var(--accent-contrast);
}

.model-option-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.3;
  color: inherit;
}

.model-option-meta {
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 1.35;
  color: var(--text-muted);
}

.model-option-side {
  max-width: 88px;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  color: color-mix(in srgb, var(--text-muted) 88%, var(--text-primary));
}

.model-selector-trigger-icon :deep(.lobe-icon),
.model-selector-trigger-icon :deep(.lobe-icon-placeholder),
.model-provider-icon :deep(.lobe-icon),
.model-provider-icon :deep(.lobe-icon-placeholder) {
  height: 16px;
  width: 16px;
}

.model-selector-trigger-icon :deep(.lobe-icon-placeholder),
.model-provider-icon :deep(.lobe-icon-placeholder) {
  border-radius: 6px;
  background: transparent;
  font-size: 9px;
  font-weight: 700;
  color: inherit;
}

.rotate-180 {
  transform: rotate(180deg);
}
</style>
