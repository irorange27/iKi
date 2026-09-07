<template>
  <PopoverRoot v-model:open="showPanel">
    <PopoverTrigger as-child>
    <button
      class="composer-chip composer-chip--reveal"
      :class="{ 'composer-chip--active': hasSelection }"
      :title="t('chat.reasoning.triggerTitle')"
      :aria-label="t('chat.reasoning.triggerTitle')"
    >
      <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
        />
      </svg>
      <span class="composer-chip-label">{{ reasoningChipLabel }}</span>
    </button>
    </PopoverTrigger>

    <PopoverPortal>
    <PopoverContent
      class="selector-panel"
      side="top"
      align="start"
      :side-offset="8"
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
          :class="{ 'selector-item-selected': option.value === reasoningEffort }"
          role="radio"
          :aria-checked="option.value === reasoningEffort"
          @click="select(option.value)"
        >
          <span class="selector-item-copy">
            <span class="text-xs">{{ option.label }}</span>
          </span>
          <span
            class="selector-check"
            :class="{ 'selector-check-active': option.value === reasoningEffort }"
          >
            <svg
              v-if="option.value === reasoningEffort"
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
    </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';

import { useI18n } from '../i18n';
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui';
import { useThreadSessionStore } from '../store/thread_session';

const threadSession = useThreadSessionStore();
const { currentReasoningEffort: reasoningEffort } = storeToRefs(threadSession);

const { t } = useI18n();

const showPanel = ref(false);

const options = computed(() => [
  { value: '', label: t('chat.reasoning.default') },
  { value: 'low', label: t('chat.reasoning.low') },
  { value: 'medium', label: t('chat.reasoning.medium') },
  { value: 'high', label: t('chat.reasoning.high') },
]);

const hasSelection = computed(() => reasoningEffort.value !== '');

const reasoningChipLabel = computed(() => reasoningEffort.value || t('chat.reasoning.chip'));

const select = (value: string) => {
  void threadSession.setReasoningEffort(value);
};
</script>
