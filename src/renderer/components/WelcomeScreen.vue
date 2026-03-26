<template>
  <div class="flex max-w-md flex-col items-center gap-8 text-center">
    <!-- Avatar -->
    <!-- <div class="h-24 w-24 overflow-hidden rounded-2xl bg-white">
        <img src="/images/image.png" alt="Alma" class="h-full w-full object-cover" />
      </div> -->

    <!-- Title -->
    <h1 class="ui-text-primary font-serif text-5xl font-normal">iKi</h1>

    <!-- Subtitle -->
    <p class="ui-text-secondary">{{ t('chat.welcome.subtitle') }}</p>

    <!-- Buttons -->
    <div class="flex w-full flex-col gap-3">
      <button
        class="w-full rounded-lg px-6 py-3 text-base font-medium text-white transition-colors btn-primary"
        @click="$emit('new-chat')"
      >
        {{ t('chat.newChat') }}
      </button>
      <div class="flex gap-3">
        <button
          class="flex-1 rounded-lg border bg-transparent px-6 py-3 text-white text-base font-small transition-colors btn-secondary"
        >
          {{ t('chat.welcome.configureProvider') }}
        </button>
        <button
          class="flex-1 rounded-lg border bg-transparent px-6 py-3 text-white text-base font-small transition-colors btn-secondary"
          @click="openSettings"
        >
          {{ t('chat.welcome.settings') }}
        </button>
      </div>
    </div>

    <!-- Info Text -->
    <p class="ui-text-muted text-sm">{{ t('chat.welcome.configureHint') }}</p>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../i18n';

defineEmits(['new-chat']);

const electronAPI = window.electronAPI;
const { t } = useI18n();

const openSettings = () => {
  electronAPI?.openSettings?.();
};
</script>

<style scoped>
.btn-primary {
  background-color: var(--accent-color);
}
.btn-primary:hover {
  background-color: var(--accent-hover);
}

.btn-secondary {
  border-color: var(--border-color);
  color: var(--text-secondary);
}
.btn-secondary:hover {
  background-color: var(--bg-hover);
  color: var(--text-primary);
}
</style>
