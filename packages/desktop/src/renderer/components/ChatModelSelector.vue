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

import type { Provider } from '@iki/backend/types/provider';
import { parseModelList } from '@iki/backend/utils/provider_models';
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

// The card is right-anchored to the trigger, so its room is whatever sits
// between the viewport's left edge and the trigger (DSH measures the same
// way). Re-measured whenever the layout under it can move: pane switches,
// the autonomous toggle growing an "Auto" pill into the toolbar, resizes.
// Floored so the menu stays usable.
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

<style scoped>
/* Trigger: a quiet chip in the composer's tool row (DSH ModelSelect) —
   ordinary secondary ink at 400, hover wash is the only chrome. The send
   button, not this label, is the loud control. */
.model-selector-trigger {
  display: inline-flex;
  /* Composer-relative width with a floor: at very narrow composers the name
     still reads ("deepseek-f…") instead of collapsing to nothing. */
  max-width: clamp(132px, 45cqw, 220px);
  height: 28px;
  align-items: center;
  gap: 6px;
  padding: 0 6px 0 8px;
  border: none;
  border-radius: var(--control-radius-sm);
  background: transparent;
  box-shadow: none;
  color: var(--text-secondary);
  transition:
    background-color 0.15s,
    color 0.15s;
}

.model-selector-trigger:hover,
.model-selector-trigger-open {
  background: var(--bg-hover);
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
  font-weight: 500;
  letter-spacing: 0.04em;
}

.model-selector-trigger-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
}

.model-selector-trigger-chevron {
  height: 14px;
  width: 14px;
  flex-shrink: 0;
  opacity: 0.8;
  transition: transform 0.15s ease;
}

.model-selector-panel {
  position: absolute;
  /* Anchored to the trigger's right edge: the trigger lives in the toolbar's
     right cluster, so the card grows leftward into the composer and stays
     inside the window at narrow widths. */
  right: 0;
  bottom: calc(100% + 10px);
  z-index: var(--z-menu);
  width: min(380px, calc(100vw - 32px));
  overflow: hidden;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, var(--border-color) 45%, transparent);
  background: color-mix(in srgb, var(--bg-secondary) 94%, transparent);
  box-shadow: var(--surface-shadow-lg);
  backdrop-filter: blur(18px);
}

/* The search sits directly on the card with no fill and no divider. */
.model-selector-search-shell {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px 4px;
}

.model-selector-search-icon {
  height: 16px;
  width: 16px;
  flex-shrink: 0;
  color: var(--text-muted);
}

.model-selector-search-input {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.4;
  outline: none;
}

.model-selector-search-input::placeholder {
  color: var(--text-muted);
}

.model-selector-scroll {
  max-height: 26rem;
  overflow-y: auto;
  padding: 4px 6px 8px;
}

.model-selector-scroll--flush {
  padding-top: 2px;
}

/* Root pane: DSH-style drill-in cells (label left, live value right). */
.model-menu-cells {
  display: flex;
  flex-direction: column;
  padding: 6px;
}

.model-menu-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 34px;
  margin-top: 2px;
  padding: 4px 10px;
  border: none;
  border-radius: var(--control-radius);
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s;
}

.model-menu-cell:hover {
  background: var(--bg-hover);
}

.model-menu-cell-label {
  flex: none;
  font-size: 13px;
  line-height: 18px;
}

.model-menu-cell-value {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
  font-size: 12px;
  line-height: 18px;
  color: var(--text-muted);
}

.model-menu-cell-chevron {
  flex: none;
  height: 12px;
  width: 12px;
  color: var(--text-muted);
}

/* Drilled panes share one header: back button + pane title. */
.model-pane-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 10px 2px;
}

.model-pane-back {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  border: none;
  border-radius: var(--control-radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 6px;
  font-size: 12px;
  transition:
    background-color 0.15s,
    color 0.15s;
}

.model-pane-back svg {
  height: 12px;
  width: 12px;
}

.model-pane-back:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.model-pane-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}

.model-pane-note {
  margin: 0;
  padding: 8px 14px 4px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-muted);
}

.model-pane-note--flush {
  padding-top: 0;
}

/* Quiet scrollbar: the thumb exists only while the pointer is over the list. */
.model-selector-scroll::-webkit-scrollbar {
  width: 6px;
}

.model-selector-scroll::-webkit-scrollbar-thumb {
  background-color: transparent;
  border-radius: 3px;
}

.model-selector-scroll:hover::-webkit-scrollbar-thumb {
  background-color: var(--sidebar-border);
}

.model-selector-empty {
  padding-top: 28px;
  padding-bottom: 28px;
}

.model-provider-group {
  padding: 4px 0 2px;
}

.model-provider-group + .model-provider-group {
  margin-top: 6px;
  padding-top: 6px;
}

/* The header carries provider identity, so model rows stay name-only. */
.model-provider-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px 2px;
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
  color: var(--text-secondary);
}

.model-provider-icon {
  display: inline-flex;
  height: 14px;
  width: 14px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
}

.model-provider-copy {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}

.model-provider-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: inherit;
}

.model-provider-type {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 400;
  color: var(--text-muted);
}

/* Menu rows, not cards: fixed rhythm, hover wash only, and the selection
   marker is the trailing check — no fill (DSH .selected). */
.model-option {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  margin-top: 2px;
  padding: 4px 10px;
  border: none;
  border-radius: var(--control-radius);
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  transition: background-color 0.15s;
}

.model-option:hover {
  background: var(--bg-hover);
}

.model-option-selected {
  background: transparent;
}

.model-option-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 400;
  line-height: 18px;
}

.model-option-check {
  display: inline-flex;
  flex-shrink: 0;
  color: var(--text-primary);
}

.model-option-check svg {
  height: 14px;
  width: 14px;
}

.model-selector-trigger-icon :deep(.lobe-icon),
.model-selector-trigger-icon :deep(.lobe-icon-placeholder),
.model-provider-icon :deep(.lobe-icon),
.model-provider-icon :deep(.lobe-icon-placeholder) {
  height: 14px;
  width: 14px;
}

.model-selector-trigger-icon :deep(.lobe-icon),
.model-selector-trigger-icon :deep(.lobe-icon-placeholder) {
  height: 16px;
  width: 16px;
}

.model-selector-trigger-icon :deep(.lobe-icon-placeholder),
.model-provider-icon :deep(.lobe-icon-placeholder) {
  border-radius: 4px;
  background: transparent;
  font-size: 9px;
  font-weight: 500;
  color: inherit;
}

.rotate-180 {
  transform: rotate(180deg);
}
</style>
