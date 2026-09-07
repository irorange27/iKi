<template>
  <PopoverRoot v-model:open="showPanel">
    <PopoverTrigger as-child>
    <button
      class="composer-chip composer-chip--reveal"
      :class="{ 'composer-chip--active': isActive }"
      :title="t('chat.autonomous.triggerTitle')"
      :aria-label="t('chat.autonomous.triggerTitle')"
    >
      <svg class="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M13 10V3L4 14h7v7l9-11h-7z"
        />
      </svg>
      <span class="composer-chip-label">{{ t('chat.autonomous.chip') }}</span>
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
          <span class="selector-panel-title ui-text-primary">{{ t('chat.autonomous.title') }}</span>
        </div>
        <div class="selector-panel-description ui-text-muted">
          {{ t('chat.autonomous.description') }}
        </div>

        <div class="selector-panel-toolbar">
          <button
            class="selector-mode-btn"
            :class="{ active: isActive }"
            @click="toggleActive"
          >
            {{ isActive ? t('chat.autonomous.enabled') : t('chat.autonomous.disabled') }}
          </button>
        </div>

        <div v-if="isActive" class="ui-text-accent mt-2 text-xs leading-snug">
          {{ t('chat.autonomous.activeDescription') }}
        </div>
      </div>

      <div v-if="isActive" class="selector-list">
        <div class="selector-panel-toolbar px-3 py-2">
          <span class="ui-text-secondary text-xs">{{ t('chat.autonomous.maxIterations') }}</span>
          <div class="selector-toolbar-spacer" />
          <button
            class="selector-action-btn"
            :disabled="maxIterations <= 1"
            @click="maxIterations = Math.max(1, maxIterations - 5)"
          >
            -5
          </button>
          <button
            class="selector-action-btn"
            :disabled="maxIterations <= 1"
            @click="maxIterations = Math.max(1, maxIterations - 1)"
          >
            -1
          </button>
          <span class="ui-text-primary mx-2 min-w-8 text-center text-sm font-semibold">
            {{ maxIterations }}
          </span>
          <button
            class="selector-action-btn"
            :disabled="maxIterations >= 50"
            @click="maxIterations = Math.min(50, maxIterations + 1)"
          >
            +1
          </button>
          <button
            class="selector-action-btn"
            :disabled="maxIterations >= 50"
            @click="maxIterations = Math.min(50, maxIterations + 5)"
          >
            +5
          </button>
        </div>
      </div>
    </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

import { useI18n } from '../i18n';
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui';

const props = defineProps<{
  active: boolean;
  maxIterations: number;
}>();

const emit = defineEmits<{
  (event: 'update:active', value: boolean): void;
  (event: 'update:maxIterations', value: number): void;
}>();

const { t } = useI18n();

const showPanel = ref(false);

const isActive = computed(() => props.active);

const toggleActive = () => {
  emit('update:active', !isActive.value);
};
</script>
