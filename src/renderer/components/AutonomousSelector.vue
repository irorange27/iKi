<template>
  <div class="relative" @mouseenter="openPanel" @mouseleave="scheduleClosePanel">
    <button
      class="composer-control-btn composer-selector-trigger ui-text-secondary relative flex h-10 w-10 items-center justify-center rounded-[14px]"
      :class="{ 'ui-text-accent': isActive }"
      :title="t('chat.autonomous.triggerTitle')"
      :aria-label="t('chat.autonomous.triggerTitle')"
      @click="showPanel = !showPanel"
      @mouseenter="openPanel"
      @mouseleave="scheduleClosePanel"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M13 10V3L4 14h7v7l9-11h-7z"
        />
      </svg>
      <span v-if="isActive" class="selector-badge">A</span>
    </button>

    <div
      v-if="showPanel"
      class="selector-panel"
      @mouseenter="openPanel"
      @mouseleave="scheduleClosePanel"
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';

const props = defineProps<{
  active: boolean;
  maxIterations: number;
}>();

const emit = defineEmits<{
  (event: 'update:active', value: boolean): void;
  (event: 'update:maxIterations', value: number): void;
}>();

const showPanel = ref(false);
let closeTimer: ReturnType<typeof setTimeout> | null = null;

const isActive = computed(() => props.active);

const toggleActive = () => {
  emit('update:active', !isActive.value);
};

const openPanel = () => {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  showPanel.value = true;
};

const scheduleClosePanel = () => {
  closeTimer = setTimeout(() => {
    showPanel.value = false;
  }, 200);
};

const t = (_key: string) => {
  // Minimal inline i18n
  const strings: Record<string, string> = {
    'chat.autonomous.triggerTitle': 'Autonomous agent mode',
    'chat.autonomous.title': 'Autonomous Mode',
    'chat.autonomous.description':
      'Let the agent keep working across multiple steps without waiting for your input.',
    'chat.autonomous.enabled': 'Enabled',
    'chat.autonomous.disabled': 'Disabled',
    'chat.autonomous.activeDescription':
      'Agent will self-drive for up to the configured number of iterations.',
    'chat.autonomous.maxIterations': 'Max iterations:',
  };
  return strings[_key] || _key;
};
</script>
