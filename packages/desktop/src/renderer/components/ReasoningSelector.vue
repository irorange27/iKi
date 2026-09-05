<template>
  <div class="relative" @mouseenter="openPanel" @mouseleave="scheduleClosePanel">
    <button
      class="composer-control-btn composer-selector-trigger ui-text-secondary relative flex h-10 w-10 items-center justify-center rounded-[14px]"
      :class="{ 'ui-text-accent': hasSelection }"
      :title="t('chat.reasoning.triggerTitle')"
      :aria-label="t('chat.reasoning.triggerTitle')"
      @click="togglePanel"
      @mouseenter="openPanel"
      @mouseleave="scheduleClosePanel"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
        />
      </svg>
      <span v-if="hasSelection" class="selector-badge">R</span>
    </button>

    <div
      v-if="showPanel"
      class="selector-panel"
      @mouseenter="openPanel"
      @mouseleave="scheduleClosePanel"
    >
      <div class="selector-panel-header">
        <div class="flex items-center justify-between">
          <span class="selector-panel-title ui-text-primary">{{ t('chat.reasoning.title') }}</span>
        </div>
        <div class="selector-panel-description ui-text-muted">
          {{ t('chat.reasoning.description') }}
        </div>
      </div>

      <div class="selector-list">
        <button
          v-for="option in options"
          :key="option.value"
          class="selector-item"
          :class="{ 'selector-item-selected': option.value === modelValue }"
          role="radio"
          :aria-checked="option.value === modelValue"
          @click="select(option.value)"
        >
          <span class="selector-item-copy">
            <span class="text-xs">{{ option.label }}</span>
          </span>
          <span
            class="selector-check"
            :class="{ 'selector-check-active': option.value === modelValue }"
          >
            <svg
              v-if="option.value === modelValue"
              class="h-3 w-3 text-white"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fill-rule="evenodd"
                d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                clip-rule="evenodd"
              />
            </svg>
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { useI18n } from '../i18n';
import { useSelectorPanel } from '../composables/useSelectorPanel';

const props = defineProps<{
  modelValue: string;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void;
}>();

const { t } = useI18n();

const { isOpen: showPanel, openPanel, scheduleClosePanel, togglePanel } = useSelectorPanel();

const options = computed(() => [
  { value: '', label: t('chat.reasoning.default') },
  { value: 'low', label: t('chat.reasoning.low') },
  { value: 'medium', label: t('chat.reasoning.medium') },
  { value: 'high', label: t('chat.reasoning.high') },
]);

const hasSelection = computed(() => props.modelValue !== '');

const select = (value: string) => {
  emit('update:modelValue', value);
};
</script>
